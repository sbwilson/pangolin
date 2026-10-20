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
import type { ImportRowRow, SplitRow, TransactionRow } from "../ports/unit-of-work.ts";
import { defineReviewKind, raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import { write } from "../write.ts";

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

    tx.transactions.insert(txnRow, [splitRow]);
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
