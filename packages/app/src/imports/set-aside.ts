import {
  computeFingerprint,
  FINGERPRINT_VERSION,
  normaliseCommBankDescription,
} from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { syncClosingBalance } from "../accounts/closing-balance.ts";
import {
  classifyTransaction,
  loadClassificationContext,
} from "../classify/classify-transaction.ts";
import { CLASSIFY_UNCLASSIFIED_REVIEW } from "../classify/rules.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import { requireOpenOn } from "../ledger/closed-lock.ts";
import { descriptionField, postedOnField } from "../ledger/fields.ts";
import { transactionEntityRef } from "../ledger/needs-review.ts";
import { privateOwner } from "../ledger/split-targets.ts";
import type { LlmProvider, StructuredResponse } from "../ports/llm-provider.ts";
import type {
  ImportRowRow,
  LlmProviderRow,
  SplitRow,
  TransactionRow,
} from "../ports/unit-of-work.ts";
import { defineReviewKind, raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import { write } from "../write.ts";
import {
  hasProbableDuplicate,
  matchTransfersForBatch,
  raiseProbableDuplicate,
} from "./match-transfers.ts";
import {
  buildRowInterpretRequest,
  type RowInterpretOutput,
  type RowInterpretProposal,
  type RowInterpretRequestItem,
  rowInterpretProposalSchema,
} from "./row-interpret-request.ts";

/** An import batch contains set-aside rows needing review. Account scope; entity `import_batch:<id>`. */
export const IMPORT_SET_ASIDE_REVIEW = defineReviewKind({
  kind: "import.set_aside",
  module: "imports",
  scope: "account",
});

export const listSetAsideRowsInput = z
  .object({
    batchId: idInput,
  })
  .strict();

export type ListSetAsideRowsInput = z.input<typeof listSetAsideRowsInput>;

/**
 * Lists all `set_aside` rows for an import batch visible to the viewer (AD-3).
 * Throws `NotFound` if the batch does not exist or the account is not visible to the viewer.
 */
export function listSetAsideRowsForBatch(
  ctx: UseCaseContext,
  input: ListSetAsideRowsInput | string,
): ImportRowRow[] {
  const parsed = parseInput(
    listSetAsideRowsInput,
    typeof input === "string" ? { batchId: input } : input,
  );

  return ctx.uow.read((repos) => {
    const batch = repos.importBatches.find(ctx.viewer, parsed.batchId);
    if (batch === undefined) {
      throw new AppError("NotFound", "Import batch not found");
    }
    const rows = repos.importRows.listForBatch(ctx.viewer, parsed.batchId);
    return rows.filter((r) => r.status === "set_aside");
  });
}

export const fixSetAsideRowInput = z
  .object({
    rowId: idInput.optional(),
    id: idInput.optional(),
    postedOn: postedOnField,
    amountCents: z.int(),
    description: descriptionField,
    externalId: z.string().trim().min(1).nullish(),
  })
  .strict()
  .refine((data) => data.rowId !== undefined || data.id !== undefined, {
    message: "rowId is required",
  });

export type FixSetAsideRowInput = z.input<typeof fixSetAsideRowInput>;

export interface FixSetAsideRowResult {
  readonly transactionId: Id<"Transaction">;
}

/**
 * Commits a corrected transaction to the ledger through the same import batch (`importId: batchId`),
 * updates the `import_row` status to `"committed"`, increments `batch.new_count`,
 * and automatically resolves the `import.set_aside` review item when all rows in the batch have reached terminal status.
 */
export function fixSetAsideRow(
  ctx: UseCaseContext,
  input: FixSetAsideRowInput,
): FixSetAsideRowResult {
  const parsed = parseInput(fixSetAsideRowInput, input);
  const rowId = parsed.rowId ?? parsed.id;
  if (rowId === undefined) {
    throw new AppError("Validation", "rowId is required");
  }

  return write(ctx, (tx, audit) => {
    const row = tx.importRows.find(ctx.viewer, rowId);
    if (row === undefined) {
      throw new AppError("NotFound", "Import row not found");
    }
    if (row.status !== "set_aside") {
      throw new AppError(
        "Validation",
        `Cannot fix row with status "${row.status}" (expected "set_aside")`,
      );
    }

    const batch = tx.importBatches.find(ctx.viewer, row.batchId);
    if (batch === undefined) {
      throw new AppError("NotFound", "Import batch not found");
    }

    const account = tx.accounts.findVisible(ctx.viewer, batch.accountId);
    if (account === undefined) {
      throw new AppError("NotFound", "Account not found");
    }

    if (parsed.externalId) {
      const existing = tx.transactions.findByExternalId(account.id, parsed.externalId);
      if (existing !== undefined) {
        throw new AppError(
          "Conflict",
          "Transaction with externalId already exists in this account",
        );
      }
    }

    requireOpenOn(ctx, tx, account, parsed.postedOn);

    const owner = privateOwner(tx, ctx.viewer, account.id);
    const beneficiary = owner !== null ? owner : "shared";

    const at = formatInstant(ctx.clock.now());
    const txnId = ctx.newId<"Transaction">();

    const normalisedDescription = normaliseCommBankDescription(parsed.description);
    const existingInDates = tx.transactions.listForDedupe(account.id, [parsed.postedOn]);
    let occurrence = 0;
    for (const t of existingInDates) {
      const normDesc = normaliseCommBankDescription(t.descriptionRaw);
      if (
        t.postedOn === parsed.postedOn &&
        t.amountCents === parsed.amountCents &&
        normDesc === normalisedDescription
      ) {
        occurrence += 1;
      }
    }

    const fingerprint = computeFingerprint({
      accountId: account.id,
      postedOn: parsed.postedOn,
      amountCents: parsed.amountCents,
      normalisedDescription,
      occurrence,
    });

    const classificationContext = loadClassificationContext(tx, ctx.viewer, account.id);
    const { payeeId, categoryId, categorySource, unclassified } = classifyTransaction(
      {
        accountId: account.id,
        rawDescription: parsed.description,
        amountCents: parsed.amountCents,
      },
      classificationContext,
    );

    const txnRow: TransactionRow = {
      id: txnId,
      accountId: account.id,
      postedOn: parsed.postedOn,
      amountCents: parsed.amountCents,
      descriptionRaw: parsed.description,
      payeeId,
      status: "posted",
      externalId: parsed.externalId ?? null,
      fingerprint,
      fingerprintVersion: FINGERPRINT_VERSION,
      importId: batch.id,
      performedBy: null,
      transferGroupId: null,
      needsReview: unclassified,
      isHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      notes: null,
      createdAt: at,
      updatedAt: at,
    };

    const splitRow: SplitRow = {
      id: ctx.newId<"Split">(),
      transactionId: txnId,
      amountCents: parsed.amountCents,
      categoryId,
      activityId: null,
      beneficiary,
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: at,
      updatedAt: at,
    };

    const probableDuplicate = hasProbableDuplicate(
      tx,
      account.id,
      {
        postedOn: parsed.postedOn,
        amountCents: parsed.amountCents,
        description: parsed.description,
        externalId: parsed.externalId ?? null,
      },
      new Set(),
    );
    tx.transactions.insert(txnRow, [splitRow]);
    if (probableDuplicate)
      raiseProbableDuplicate(tx, audit, ctx, { id: txnId, accountId: account.id });
    if (unclassified) {
      raiseReviewItem(tx, audit, ctx, {
        kind: CLASSIFY_UNCLASSIFIED_REVIEW,
        entityRef: transactionEntityRef(txnId),
        dedupeKey: `classify.unclassified:${txnId}`,
        accountId: account.id,
      });
    }
    audit({
      entity: "transaction",
      entityId: txnId,
      accountId: account.id,
      action: "create",
      before: null,
      after: { ...txnRow, splits: [splitRow] },
    });

    matchTransfersForBatch(tx, audit, ctx, [
      {
        id: txnId,
        accountId: account.id,
        postedOn: parsed.postedOn,
        amountCents: parsed.amountCents,
      },
    ]);

    tx.importRows.updateStatus(row.id, "committed", at, null);
    audit({
      entity: "import_row",
      entityId: row.id,
      accountId: account.id,
      action: "update",
      before: row,
      after: {
        ...row,
        status: "committed",
        reason: null,
        updatedAt: at,
      },
    });

    const updatedNewCount = batch.newCount + 1;
    tx.importBatches.updateCountsAndStatus(
      batch.id,
      {
        newCount: updatedNewCount,
        status: batch.status,
      },
      at,
    );
    audit({
      entity: "import_batch",
      entityId: batch.id,
      accountId: account.id,
      action: "update",
      before: batch,
      after: {
        ...batch,
        newCount: updatedNewCount,
        updatedAt: at,
      },
    });

    // Check if all set_aside rows in the batch have reached terminal status
    const batchRows = tx.importRows.listForBatch(ctx.viewer, batch.id);
    const remainingSetAside = batchRows.filter((r) => r.id !== row.id && r.status === "set_aside");
    if (remainingSetAside.length === 0) {
      resolveReviewItem(tx, audit, ctx, {
        dedupeKey: `import.set_aside:${batch.id}`,
        resolution: "all rows resolved",
      });
    }

    syncClosingBalance(tx, audit, ctx, account.id);

    return { transactionId: txnId };
  });
}

export const discardSetAsideRowInput = z
  .object({
    rowId: idInput.optional(),
    id: idInput.optional(),
    reason: z.string().trim().min(1).nullish(),
  })
  .strict()
  .refine((data) => data.rowId !== undefined || data.id !== undefined, {
    message: "rowId is required",
  });

export type DiscardSetAsideRowInput = z.input<typeof discardSetAsideRowInput>;

export interface DiscardSetAsideRowResult {
  readonly rowId: Id<"ImportRow">;
}

/**
 * Discards a set-aside row by updating its status to `"discarded"` with an optional reason,
 * without creating a ledger transaction. Automatically resolves the `import.set_aside` review item
 * when all rows in the batch have reached terminal status.
 */
export function discardSetAsideRow(
  ctx: UseCaseContext,
  input: DiscardSetAsideRowInput,
): DiscardSetAsideRowResult {
  const parsed = parseInput(discardSetAsideRowInput, input);
  const rowId = parsed.rowId ?? parsed.id;
  if (rowId === undefined) {
    throw new AppError("Validation", "rowId is required");
  }

  return write(ctx, (tx, audit) => {
    const row = tx.importRows.find(ctx.viewer, rowId);
    if (row === undefined) {
      throw new AppError("NotFound", "Import row not found");
    }
    if (row.status !== "set_aside") {
      throw new AppError(
        "Validation",
        `Cannot discard row with status "${row.status}" (expected "set_aside")`,
      );
    }

    const batch = tx.importBatches.find(ctx.viewer, row.batchId);
    if (batch === undefined) {
      throw new AppError("NotFound", "Import batch not found");
    }

    const account = tx.accounts.findVisible(ctx.viewer, batch.accountId);
    if (account === undefined) {
      throw new AppError("NotFound", "Account not found");
    }

    const at = formatInstant(ctx.clock.now());
    const reason = parsed.reason ?? row.reason;
    tx.importRows.updateStatus(row.id, "discarded", at, reason);
    audit({
      entity: "import_row",
      entityId: row.id,
      accountId: account.id,
      action: "update",
      before: row,
      after: {
        ...row,
        status: "discarded",
        reason,
        updatedAt: at,
      },
    });

    // Check if all set_aside rows in the batch have reached terminal status
    const batchRows = tx.importRows.listForBatch(ctx.viewer, batch.id);
    const remainingSetAside = batchRows.filter((r) => r.id !== row.id && r.status === "set_aside");
    if (remainingSetAside.length === 0) {
      resolveReviewItem(tx, audit, ctx, {
        dedupeKey: `import.set_aside:${batch.id}`,
        resolution: "all rows resolved",
      });
    }

    return { rowId: row.id };
  });
}

export const interpretSetAsideRowsInput = z
  .object({
    batchId: idInput,
    rowIds: z.array(idInput).optional(),
  })
  .strict();

export type InterpretSetAsideRowsInput = z.input<typeof interpretSetAsideRowsInput>;

export interface InterpretSetAsideRowsContext extends UseCaseContext {
  readonly provider?: LlmProvider | undefined;
  readonly providerIsLocal?: boolean | undefined;
  readonly providerCloudRows?: boolean | undefined;
  readonly providerModel?: string | undefined;
  readonly resolveProvider?: ((row: LlmProviderRow) => LlmProvider) | undefined;
  readonly authSecret?: string | undefined;
  readonly decryptApiKey?: ((ciphertext: string, secret: string) => string) | undefined;
  readonly createProvider?: ((row: LlmProviderRow, apiKey?: string) => LlmProvider) | undefined;
}

export interface InterpretSetAsideRowsResult {
  readonly interpretedCount: number;
  readonly proposals: readonly {
    readonly rowId: string;
    readonly proposal: RowInterpretProposal;
  }[];
}

/**
 * Interprets set-aside statement rows using an LLM provider (AD-6).
 *
 * Privacy rules:
 * - Local by default. Non-local / cloud providers require explicit `cloud_rows` opt-in.
 * - Cloud providers are strictly forbidden from receiving rows from private accounts.
 *
 * Stored proposals are validated and saved in `import_row.proposal` awaiting explicit user confirmation.
 */
export async function interpretSetAsideRows(
  ctx: InterpretSetAsideRowsContext,
  input: InterpretSetAsideRowsInput,
): Promise<InterpretSetAsideRowsResult> {
  const parsed = parseInput(interpretSetAsideRowsInput, input);

  // 1. Read batch, account, and candidate set-aside rows
  const { account, rows, providerRow } = ctx.uow.read((repos) => {
    const b = repos.importBatches.find(ctx.viewer, parsed.batchId);
    if (b === undefined) {
      throw new AppError("NotFound", "Import batch not found");
    }
    const a = repos.accounts.findVisible(ctx.viewer, b.accountId);
    if (a === undefined) {
      throw new AppError("NotFound", "Account not found");
    }
    let r = repos.importRows
      .listForBatch(ctx.viewer, b.id)
      .filter((row) => row.status === "set_aside");
    if (parsed.rowIds && parsed.rowIds.length > 0) {
      const allowed = new Set(parsed.rowIds);
      r = r.filter((row) => allowed.has(row.id));
    }
    const p = repos.llmProviders.findForPurpose("row_interpret");
    return { batch: b, account: a, rows: r, providerRow: p };
  });

  if (rows.length === 0) {
    return { interpretedCount: 0, proposals: [] };
  }

  // 2. Resolve LLM provider and determine locality / privacy settings (AD-6)
  let provider: LlmProvider;
  let isLocal: boolean;
  let cloudRows: boolean;
  let model: string | undefined;

  if (ctx.provider) {
    provider = ctx.provider;
    isLocal = ctx.providerIsLocal ?? providerRow?.isLocal ?? false;
    cloudRows = ctx.providerCloudRows ?? providerRow?.cloudRows ?? false;
    model = ctx.providerModel ?? providerRow?.model;
  } else if (providerRow) {
    isLocal = providerRow.isLocal;
    cloudRows = providerRow.cloudRows;
    model = providerRow.model;
    if (ctx.resolveProvider) {
      provider = ctx.resolveProvider(providerRow);
    } else if (ctx.createProvider) {
      let apiKey: string | undefined;
      if (providerRow.apiKeyCiphertext) {
        if (!ctx.decryptApiKey || !ctx.authSecret) {
          throw new AppError("Validation", "Cannot decrypt API key");
        }
        try {
          apiKey = ctx.decryptApiKey(providerRow.apiKeyCiphertext, ctx.authSecret);
        } catch (err) {
          throw new AppError("Validation", "Cannot decrypt API key", { cause: err });
        }
      }
      provider = ctx.createProvider(providerRow, apiKey);
    } else {
      throw new AppError("Validation", "Provider adapter factory not configured");
    }
  } else {
    throw new AppError("Validation", "No LLM provider configured for row interpretation");
  }

  // 3. AD-6 Privacy sanitiser checks
  if (!isLocal) {
    if (!cloudRows) {
      throw new AppError(
        "PermissionDenied",
        "Cloud provider not permitted for row interpretation without cloud_rows opt-in",
      );
    }
    if (account.isPrivate) {
      throw new AppError(
        "PermissionDenied",
        "Cannot send private account rows to a cloud LLM provider",
      );
    }
  }

  // 4. Build prompt
  const items: RowInterpretRequestItem[] = rows.map((r, idx) => ({
    index: idx,
    rowId: r.id,
    rawLine: r.rawLine,
    reason: r.reason,
    isPrivate: account.isPrivate,
  }));

  const structuredPrompt = buildRowInterpretRequest({
    items,
    isLocal,
    cloudRows,
    model,
  });

  // 5. Outbound async LLM call (outside write transaction per AD-2)
  let response: StructuredResponse<RowInterpretOutput>;
  try {
    response = await provider.generateStructured(structuredPrompt);
  } catch (err) {
    throw new AppError(
      "Validation",
      `LLM row interpretation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 6. Write transaction: persist proposals to import_row.proposal
  return write(ctx, (tx, audit) => {
    const at = formatInstant(ctx.clock.now());
    const validProposals: { rowId: string; proposal: RowInterpretProposal }[] = [];
    const seenRowIds = new Set<string>();

    for (const proposal of response.data.proposals) {
      let targetRow: ImportRowRow | undefined;
      if (proposal.rowId) {
        targetRow = rows.find((r) => r.id === proposal.rowId);
      }
      if (!targetRow && proposal.index !== undefined) {
        targetRow = rows[proposal.index];
      }
      if (!targetRow && rows.length === 1) {
        targetRow = rows[0];
      }
      if (!targetRow) continue;

      if (seenRowIds.has(targetRow.id)) continue;

      const current = tx.importRows.find(ctx.viewer, targetRow.id);
      if (!current || current.status !== "set_aside") continue;

      const parsedProp = rowInterpretProposalSchema.safeParse(proposal);
      if (!parsedProp.success) continue;

      seenRowIds.add(targetRow.id);

      const propData = parsedProp.data;
      const proposalJson = JSON.stringify({
        postedOn: propData.postedOn,
        amountCents: propData.amountCents,
        description: propData.description,
        ...(propData.confidence !== undefined ? { confidence: propData.confidence } : {}),
        ...(propData.explanation !== undefined ? { explanation: propData.explanation } : {}),
      });

      tx.importRows.updateProposal(current.id, proposalJson, at);
      audit({
        entity: "import_row",
        entityId: current.id,
        accountId: account.id,
        action: "update",
        before: current,
        after: {
          ...current,
          proposal: proposalJson,
          updatedAt: at,
        },
      });

      validProposals.push({
        rowId: current.id,
        proposal: propData,
      });
    }

    return {
      interpretedCount: validProposals.length,
      proposals: validProposals,
    };
  });
}

export const confirmSetAsideProposalInput = z
  .object({
    rowId: idInput.optional(),
    id: idInput.optional(),
  })
  .strict()
  .refine((data) => data.rowId !== undefined || data.id !== undefined, {
    message: "rowId is required",
  });

export type ConfirmSetAsideProposalInput = z.input<typeof confirmSetAsideProposalInput>;

/**
 * Confirms an AI proposal on a set-aside row and commits it to the ledger
 * via `fixSetAsideRow`.
 */
export function confirmSetAsideProposal(
  ctx: UseCaseContext,
  input: ConfirmSetAsideProposalInput,
): FixSetAsideRowResult {
  const parsed = parseInput(confirmSetAsideProposalInput, input);
  const rowId = parsed.rowId ?? parsed.id;
  if (!rowId) {
    throw new AppError("Validation", "rowId is required");
  }

  const row = ctx.uow.read((repos) => repos.importRows.find(ctx.viewer, rowId));
  if (row === undefined) {
    throw new AppError("NotFound", "Import row not found");
  }
  if (row.status !== "set_aside") {
    throw new AppError(
      "Validation",
      `Cannot confirm proposal for row with status "${row.status}" (expected "set_aside")`,
    );
  }
  if (!row.proposal) {
    throw new AppError("Validation", "Row has no proposal to confirm");
  }

  let proposal: RowInterpretProposal;
  try {
    proposal = rowInterpretProposalSchema.parse(JSON.parse(row.proposal));
  } catch {
    throw new AppError("Validation", "Row has invalid proposal");
  }

  return fixSetAsideRow(ctx, {
    rowId: row.id,
    postedOn: proposal.postedOn,
    amountCents: proposal.amountCents,
    description: proposal.description,
  });
}
