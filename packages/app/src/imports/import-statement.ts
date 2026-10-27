import {
  computeFingerprint,
  FINGERPRINT_VERSION,
  normaliseCommBankDescription,
  type ReconcileResult,
  reconcileStatement,
  sha256Hex,
  shiftDay,
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
import { transactionEntityRef } from "../ledger/needs-review.ts";
import { privateOwner } from "../ledger/split-targets.ts";
import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
  StatementParser,
} from "../ports/statement-parser.ts";
import type {
  BalanceSnapshotRow,
  ImportBatchRow,
  ImportBatchStatus,
  ImportRowRow,
  SplitRow,
  TransactionRow,
} from "../ports/unit-of-work.ts";
import { defineReviewKind, raiseReviewItem } from "../system/review-items.ts";
import { write } from "../write.ts";
import {
  dayKey,
  hasProbableDuplicate,
  matchTransfersForBatch,
  raiseProbableDuplicate,
} from "./match-transfers.ts";
import { parseBuiltinCommBankCsv } from "./parsers/commbank-csv.ts";
import { parseBuiltinCommBankOfx } from "./parsers/commbank-ofx.ts";
import { parseBuiltinFy2025MultiBankCsv } from "./parsers/fy2025-multibank-csv.ts";
import { parseBuiltinGenericCsv } from "./parsers/generic-csv.ts";
import { parseBuiltinQif } from "./parsers/qif.ts";
import { parseBuiltinUbankCsv } from "./parsers/ubank-csv.ts";
import { parseBuiltinUpCsv } from "./parsers/up-csv.ts";
import { IMPORT_SET_ASIDE_REVIEW } from "./set-aside.ts";

/**
 * A committed batch whose printed running balances do not chain (pipeline step 7). Account scope;
 * entity `import_batch:<id>`. Raised for information: importing never fails over a gap.
 */
export const IMPORT_BALANCE_GAP_REVIEW = defineReviewKind({
  kind: "import.balance_gap",
  module: "imports",
  scope: "account",
});

export const csvColumnMappingSchema = z
  .object({
    date: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    dateFormat: z.enum(["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY", "DD-MM-YYYY"]).optional(),
    description: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    amount: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
    debit: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
    credit: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
    balance: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
    externalId: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
    memo: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
    signConvention: z.enum(["normal", "inverted"]).optional(),
    hasHeader: z.boolean().optional(),
    delimiter: z.string().length(1, "Delimiter must be a single character").optional(),
  })
  .strict();

export const importStatementInput = z
  .object({
    accountId: idInput,
    format: z.enum([
      "commbank_ofx",
      "commbank_csv",
      "commbank_qif",
      "qif",
      "ubank_csv",
      "up_csv",
      "fy2025_multibank_csv",
      "generic_csv",
    ]),
    content: z.string().min(1, "Statement content cannot be empty"),
    csvMapping: csvColumnMappingSchema.optional(),
  })
  .strict();

export type ImportStatementInput = z.input<typeof importStatementInput>;

export interface ImportStatementResult {
  readonly batchId: Id<"ImportBatch">;
  readonly status: ImportBatchStatus;
  readonly rowCount: number;
  readonly newCount: number;
  readonly dupCount: number;
  readonly setAsideCount: number;
  readonly transactionIds: readonly Id<"Transaction">[];
}

export interface ImportStatementOptions {
  readonly parser?: StatementParser;
}

/**
 * Imports a bank statement file (CommBank OFX, CSV, QIF, ubank, Up, FY2025, or generic CSV) into an account.
 * Stages batch and rows in `import_batch` and `import_row`, deduplicates rows against
 * ledger (accounting for occurrence counts among same-day identical transactions and external IDs),
 * and commits new transactions and full splits idempotently (AD-1, AD-12, AD-20).
 */
export function importStatement(
  ctx: UseCaseContext,
  input: ImportStatementInput,
  options?: ImportStatementOptions,
): ImportStatementResult {
  const parsed = parseInput(importStatementInput, input);

  // 1. Parse statement rows before opening the transaction (AD-2)
  let parseResult: StatementParseResult;
  try {
    let rawResult: StatementParseResult | readonly ParsedStatementRow[];
    if (options?.parser) {
      rawResult = options.parser.parse(parsed.content);
    } else if (parsed.format === "commbank_ofx") {
      rawResult = parseBuiltinCommBankOfx(parsed.content);
    } else if (parsed.format === "commbank_csv") {
      rawResult = parseBuiltinCommBankCsv(parsed.content);
    } else if (parsed.format === "commbank_qif" || parsed.format === "qif") {
      rawResult = parseBuiltinQif(parsed.content);
    } else if (parsed.format === "ubank_csv") {
      rawResult = parseBuiltinUbankCsv(parsed.content);
    } else if (parsed.format === "up_csv") {
      rawResult = parseBuiltinUpCsv(parsed.content);
    } else if (parsed.format === "fy2025_multibank_csv") {
      rawResult = parseBuiltinFy2025MultiBankCsv(parsed.content);
    } else if (parsed.format === "generic_csv") {
      if (!parsed.csvMapping) {
        throw new Error("Generic CSV format requires csvMapping configuration");
      }
      rawResult = parseBuiltinGenericCsv(parsed.content, parsed.csvMapping);
    } else {
      throw new Error(`Unsupported format: ${parsed.format}`);
    }

    if (Array.isArray(rawResult)) {
      parseResult = {
        rows: rawResult,
        setAside:
          "setAside" in rawResult && Array.isArray((rawResult as { setAside?: unknown }).setAside)
            ? (rawResult as { setAside: readonly SetAsideStatementRow[] }).setAside
            : [],
      };
    } else {
      const rawObj = rawResult as Partial<StatementParseResult> | undefined;
      parseResult = {
        rows: rawObj?.rows ?? [],
        setAside: rawObj?.setAside ?? [],
      };
    }
  } catch (err) {
    throw new AppError(
      "Validation",
      `Failed to parse statement: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const fileRows = parseResult?.rows ?? [];
  const fileSetAside = parseResult?.setAside ?? [];

  // 2. Compute file SHA-256
  const fileSha256 = sha256Hex(parsed.content);

  // 3. Open write transaction
  return write(ctx, (tx, audit) => {
    const account = tx.accounts.findVisible(ctx.viewer, parsed.accountId);
    if (account === undefined) {
      throw new AppError("NotFound", "Account not found");
    }

    // Check if identical file was already imported for this account (idempotent re-import)
    const existingBatch = tx.importBatches.findByAccountAndFileSha(
      ctx.viewer,
      account.id,
      fileSha256,
    );
    if (existingBatch !== undefined && existingBatch.status !== "failed") {
      return {
        batchId: existingBatch.id,
        status: existingBatch.status,
        rowCount: existingBatch.rowCount,
        newCount: 0,
        dupCount: existingBatch.rowCount,
        setAsideCount: 0,
        transactionIds: [],
      };
    }

    // A person's import never commits a row dated after the account closed (the closed-account
    // lock, as `requireOpenOn`); such rows are set aside so the person fixes or discards them in
    // Needs review. The system viewer is exempt.
    const closedOn = ctx.viewer.kind === "system" ? null : account.closedOn;
    const isLocked = (r: ParsedStatementRow) => closedOn !== null && r.postedOn > closedOn;
    const parsedRows = fileRows.filter((r) => !isLocked(r));
    const setAsideRows: readonly SetAsideStatementRow[] = [
      ...fileSetAside,
      ...fileRows.filter(isLocked).map((r) => ({
        rowNumber: r.rowNumber,
        rawLine: r.rawLine,
        reason: `Dated after this account closed on ${closedOn}`,
      })),
    ];

    const at = formatInstant(ctx.clock.now());
    const batchId = ctx.newId<"ImportBatch">();
    const totalRowCount = parsedRows.length + setAsideRows.length;

    // Stage batch
    const batchRow: ImportBatchRow = {
      id: batchId,
      accountId: account.id,
      source: parsed.format,
      fileSha256,
      rowCount: totalRowCount,
      newCount: 0,
      dupCount: 0,
      status: "staged",
      importedByPersonId: ctx.viewer.kind === "person" ? ctx.viewer.personId : null,
      undoneAt: null,
      reconcileStatus: null,
      reconcileGapCents: null,
      openingBalanceCents: null,
      closingBalanceCents: null,
      firstPostedOn: null,
      lastPostedOn: null,
      createdAt: at,
      updatedAt: at,
    };
    tx.importBatches.insert(batchRow);

    // Stage rows
    const stagedRows: ImportRowRow[] = parsedRows.map((r) => ({
      id: ctx.newId<"ImportRow">(),
      batchId,
      rowNumber: r.rowNumber,
      rawLine: r.rawLine,
      status: "staged",
      reason: null,
      proposal: null,
      pdfPage: null,
      createdAt: at,
      updatedAt: at,
    }));

    const stagedSetAsideRows: ImportRowRow[] = setAsideRows.map((sa) => ({
      id: ctx.newId<"ImportRow">(),
      batchId,
      rowNumber: sa.rowNumber,
      rawLine: sa.rawLine,
      status: "set_aside",
      reason: sa.reason,
      proposal: null,
      pdfPage: null,
      createdAt: at,
      updatedAt: at,
    }));

    const allStagedRows = [...stagedRows, ...stagedSetAsideRows].sort(
      (a, b) => a.rowNumber - b.rowNumber,
    );
    tx.importRows.insertMany(allStagedRows);

    if (setAsideRows.length > 0) {
      raiseReviewItem(tx, audit, ctx, {
        kind: IMPORT_SET_ASIDE_REVIEW,
        entityRef: `import_batch:${batchId}`,
        dedupeKey: `import.set_aside:${batchId}`,
        accountId: account.id,
      });
    }

    // Determine beneficiary for splits in this account
    const owner = privateOwner(tx, ctx.viewer, account.id);
    const beneficiary = owner !== null ? owner : "shared";

    // Query existing ledger transactions (including soft-deleted) for deduplication
    const uniqueDates = Array.from(new Set(parsedRows.map((r) => r.postedOn)));
    const existingInDates = tx.transactions.listForDedupe(account.id, uniqueDates);

    const existingExternalIds = new Set<string>();
    const existingFingerprints = new Set<string>();
    // Occurrence = index of an identical line within this file; never seeded from the ledger, so a
    // file that overlaps an earlier one matches it line for line.
    const occurrenceMap = new Map<string, number>();

    for (const t of existingInDates) {
      if (t.externalId) existingExternalIds.add(t.externalId);
      existingFingerprints.add(t.fingerprint);
    }

    // Existing rows an exact duplicate in this file accounts for are not probable duplicates.
    const fileDayKeys = new Set(
      parsedRows.map((r) =>
        dayKey(r.postedOn, r.amountCents, normaliseCommBankDescription(r.rawDescription)),
      ),
    );
    const committed: { id: Id<"Transaction">; postedOn: string; amountCents: number }[] = [];

    let newCount = 0;
    let dupCount = 0;
    const transactionIds: Id<"Transaction">[] = [];
    const classificationContext = loadClassificationContext(tx, ctx.viewer, account.id);

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const stagedRow = stagedRows[i];
      if (!row || !stagedRow) continue;

      const normalisedDescription = normaliseCommBankDescription(row.rawDescription);
      const dayKey = `${row.postedOn}\n${row.amountCents}\n${normalisedDescription}`;
      const occurrence = occurrenceMap.get(dayKey) ?? 0;
      occurrenceMap.set(dayKey, occurrence + 1);

      const fingerprint = computeFingerprint({
        accountId: account.id,
        postedOn: row.postedOn,
        amountCents: row.amountCents,
        normalisedDescription,
        occurrence,
      });

      // Deduplication check:
      // 1. External ID matches existing ledger transaction
      // 2. Fingerprint matches existing ledger transaction
      let isDuplicate = false;
      if (row.externalId) {
        if (
          existingExternalIds.has(row.externalId) ||
          tx.transactions.findByExternalId(account.id, row.externalId) !== undefined
        ) {
          isDuplicate = true;
        }
      }
      if (!isDuplicate) {
        if (
          existingFingerprints.has(fingerprint) ||
          tx.transactions.findByFingerprint(account.id, fingerprint) !== undefined
        ) {
          isDuplicate = true;
        }
      }

      if (isDuplicate) {
        dupCount += 1;
        tx.importRows.updateStatus(stagedRow.id, "discarded", at, "duplicate");
        continue;
      }

      // New transaction: commit to ledger
      newCount += 1;
      existingFingerprints.add(fingerprint);
      if (row.externalId) existingExternalIds.add(row.externalId);

      const txnId = ctx.newId<"Transaction">();
      transactionIds.push(txnId);
      const probableDuplicate = hasProbableDuplicate(
        tx,
        account.id,
        {
          postedOn: row.postedOn,
          amountCents: row.amountCents,
          description: row.rawDescription,
          externalId: row.externalId ?? null,
        },
        fileDayKeys,
      );

      const { payeeId, categoryId, categorySource, unclassified } = classifyTransaction(
        {
          accountId: account.id,
          rawDescription: row.rawDescription,
          amountCents: row.amountCents,
        },
        classificationContext,
      );

      const txnRow: TransactionRow = {
        id: txnId,
        accountId: account.id,
        postedOn: row.postedOn,
        amountCents: row.amountCents,
        descriptionRaw: row.rawDescription,
        payeeId,
        status: "posted",
        externalId: row.externalId,
        fingerprint,
        fingerprintVersion: FINGERPRINT_VERSION,
        importId: batchId,
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
        amountCents: row.amountCents,
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
      if (probableDuplicate)
        raiseProbableDuplicate(tx, audit, ctx, { id: txnId, accountId: account.id });
      committed.push({ id: txnId, postedOn: row.postedOn, amountCents: row.amountCents });
      tx.importRows.updateStatus(stagedRow.id, "committed", at);

      audit({
        entity: "transaction",
        entityId: txnId,
        accountId: account.id,
        action: "create",
        before: null,
        after: { ...txnRow, splits: [splitRow] },
      });
    }

    matchTransfersForBatch(
      tx,
      audit,
      ctx,
      committed.map((c) => ({ ...c, accountId: account.id })),
    );

    // Reconcile the file's printed balances (step 7); a gap is flagged, never blocking.
    // Rows set aside mid-file make their neighbours look adjacent, so a file with any cannot be
    // verified; the set-aside review item already flags it.
    const reconcile: ReconcileResult =
      setAsideRows.length > 0
        ? { status: "unavailable", gapCents: 0, openingCents: null, closingCents: null }
        : reconcileStatement(parsedRows);
    let firstPostedOn: string | null = null;
    let lastPostedOn: string | null = null;
    for (const r of parsedRows) {
      if (firstPostedOn === null || r.postedOn < firstPostedOn) firstPostedOn = r.postedOn;
      if (lastPostedOn === null || r.postedOn > lastPostedOn) lastPostedOn = r.postedOn;
    }
    if (reconcile.status === "gap") {
      raiseReviewItem(tx, audit, ctx, {
        kind: IMPORT_BALANCE_GAP_REVIEW,
        entityRef: `import_batch:${batchId}`,
        dedupeKey: `import.balance_gap:${batchId}`,
        accountId: account.id,
      });
    }

    // Update batch status and counts
    tx.importBatches.updateCountsAndStatus(
      batchId,
      {
        rowCount: totalRowCount,
        newCount,
        dupCount,
        status: "committed",
        reconcileStatus: reconcile.status,
        reconcileGapCents: reconcile.gapCents,
        openingBalanceCents: reconcile.openingCents,
        closingBalanceCents: reconcile.closingCents,
        firstPostedOn,
        lastPostedOn,
      },
      at,
    );

    // The statement's own opening balance, when this file starts the account's history: the
    // snapshot is the balance at the end of the day before the first row.
    if (
      reconcile.status === "ok" &&
      reconcile.openingCents !== null &&
      firstPostedOn !== null &&
      !tx.transactions.hasLiveBefore(account.id, firstPostedOn, batchId)
    ) {
      const asOf = shiftDay(firstPostedOn, -1);
      const earlier = tx.balanceSnapshots
        .listVisible(ctx.viewer, account.id)
        .some((s) => s.asOf <= asOf);
      if (!earlier) {
        const snapshot: BalanceSnapshotRow = {
          id: ctx.newId<"BalanceSnapshot">(),
          accountId: account.id,
          asOf,
          balanceCents: reconcile.openingCents,
          source: "statement",
          importBatchId: batchId,
          createdAt: at,
          updatedAt: at,
        };
        tx.balanceSnapshots.insert(snapshot);
        audit({
          entity: "balance_snapshot",
          entityId: snapshot.id,
          accountId: account.id,
          action: "create",
          before: null,
          after: snapshot,
        });
      }
    }

    audit({
      entity: "import_batch",
      entityId: batchId,
      accountId: account.id,
      action: "create",
      before: null,
      after: {
        ...batchRow,
        rowCount: totalRowCount,
        newCount,
        dupCount,
        status: "committed",
        reconcileStatus: reconcile.status,
        reconcileGapCents: reconcile.gapCents,
        openingBalanceCents: reconcile.openingCents,
        closingBalanceCents: reconcile.closingCents,
        firstPostedOn,
        lastPostedOn,
      },
    });

    syncClosingBalance(tx, audit, ctx, account.id);

    return {
      batchId,
      status: "committed",
      rowCount: totalRowCount,
      newCount,
      dupCount,
      setAsideCount: setAsideRows.length,
      transactionIds,
    };
  });
}
