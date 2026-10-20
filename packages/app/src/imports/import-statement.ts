import {
  computeFingerprint,
  FINGERPRINT_VERSION,
  normaliseCommBankDescription,
  sha256Hex,
} from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import { toCents } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { syncClosingBalance } from "../accounts/closing-balance.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import { privateOwner } from "../ledger/split-targets.ts";
import type { ParsedStatementRow, StatementParser } from "../ports/statement-parser.ts";
import type {
  ImportBatchRow,
  ImportBatchStatus,
  ImportRowRow,
  SplitRow,
  TransactionRow,
} from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

export const importStatementInput = z
  .object({
    accountId: idInput,
    format: z.enum(["commbank_ofx", "commbank_csv"]),
    content: z.string().min(1, "Statement content cannot be empty"),
  })
  .strict();

export type ImportStatementInput = z.input<typeof importStatementInput>;

export interface ImportStatementResult {
  readonly batchId: Id<"ImportBatch">;
  readonly status: ImportBatchStatus;
  readonly rowCount: number;
  readonly newCount: number;
  readonly dupCount: number;
  readonly transactionIds: readonly Id<"Transaction">[];
}

export interface ImportStatementOptions {
  readonly parser?: StatementParser;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function extractTag(block: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}>([^<\\r\\n]+)(?:<\\/${tag}>)?`, "i");
  const match = regex.exec(block);
  return match ? match[1]?.trim() : undefined;
}

function parseBuiltinCommBankOfx(content: string): ParsedStatementRow[] {
  if (!content.includes("<OFX>") && !content.includes("<ofx>") && !content.includes("OFXHEADER")) {
    throw new Error("Invalid OFX: missing OFX header or root element");
  }

  const rows: ParsedStatementRow[] = [];
  const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let rowNumber = 1;

  for (const match of content.matchAll(trnRegex)) {
    const block = match[1] ?? "";
    const rawLine = match[0].trim();

    const dtPostedRaw = extractTag(block, "DTPOSTED");
    if (!dtPostedRaw) {
      throw new Error(`STMTTRN row ${rowNumber} missing DTPOSTED`);
    }

    const dateMatch = /^(\d{4})(\d{2})(\d{2})/.exec(dtPostedRaw);
    if (!dateMatch?.[1] || !dateMatch[2] || !dateMatch[3]) {
      throw new Error(`STMTTRN row ${rowNumber} has invalid DTPOSTED: ${dtPostedRaw}`);
    }
    const postedOn = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

    const trnamtRaw = extractTag(block, "TRNAMT");
    if (!trnamtRaw) {
      throw new Error(`STMTTRN row ${rowNumber} missing TRNAMT`);
    }
    const amountCents = toCents(trnamtRaw);

    const fitid = extractTag(block, "FITID") ?? null;
    const name = extractTag(block, "NAME") ?? "";
    const memo = extractTag(block, "MEMO") ?? "";

    let rawDescription = name;
    if (memo && memo !== name) {
      rawDescription = name ? `${name} ${memo}` : memo;
    }

    rows.push({
      rowNumber,
      rawLine,
      postedOn,
      amountCents,
      rawDescription,
      externalId: fitid,
    });

    rowNumber += 1;
  }

  if (rows.length === 0) {
    throw new Error("OFX statement contained no transaction rows");
  }

  return rows;
}

function parseBuiltinCommBankCsv(content: string): ParsedStatementRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error("CSV statement is empty");
  }

  const rows: ParsedStatementRow[] = [];
  let fileLineNumber = 0;

  for (const line of lines) {
    fileLineNumber += 1;
    const fields = parseCsvLine(line);

    const firstCol = fields[0]?.trim() ?? "";
    if (firstCol.toLowerCase() === "date" || firstCol.toLowerCase() === '"date"') {
      continue;
    }

    if (fields.length < 3) {
      throw new Error(`CSV row ${fileLineNumber} has fewer than 3 columns`);
    }

    const dateMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(firstCol);
    if (!dateMatch?.[1] || !dateMatch[2] || !dateMatch[3]) {
      throw new Error(`CSV row ${fileLineNumber} has invalid date format: "${firstCol}"`);
    }

    const day = dateMatch[1].padStart(2, "0");
    const month = dateMatch[2].padStart(2, "0");
    const year = dateMatch[3];
    const postedOn = `${year}-${month}-${day}`;

    const amountStr = fields[1]?.trim() ?? "";
    let amountCents: number;
    try {
      amountCents = toCents(amountStr);
    } catch (err) {
      throw new Error(`CSV row ${fileLineNumber} has invalid amount: "${amountStr}"`, {
        cause: err,
      });
    }

    const rawDescription = fields[2]?.trim() ?? "";

    rows.push({
      rowNumber: fileLineNumber,
      rawLine: line,
      postedOn,
      amountCents,
      rawDescription,
      externalId: null,
    });
  }

  if (rows.length === 0) {
    throw new Error("CSV statement contained no valid transaction rows");
  }

  return rows;
}

/**
 * Imports a bank statement file (CommBank OFX or CSV) into an account.
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
  let parsedRows: readonly ParsedStatementRow[];
  try {
    if (options?.parser) {
      parsedRows = options.parser.parse(parsed.content);
    } else if (parsed.format === "commbank_ofx") {
      parsedRows = parseBuiltinCommBankOfx(parsed.content);
    } else if (parsed.format === "commbank_csv") {
      parsedRows = parseBuiltinCommBankCsv(parsed.content);
    } else {
      throw new Error(`Unsupported format: ${parsed.format}`);
    }
  } catch (err) {
    throw new AppError(
      "Validation",
      `Failed to parse statement: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

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
        transactionIds: [],
      };
    }

    const at = formatInstant(ctx.clock.now());
    const batchId = ctx.newId<"ImportBatch">();

    // Stage batch
    const batchRow: ImportBatchRow = {
      id: batchId,
      accountId: account.id,
      source: parsed.format,
      fileSha256,
      rowCount: parsedRows.length,
      newCount: 0,
      dupCount: 0,
      status: "staged",
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
      pdfPage: null,
      createdAt: at,
      updatedAt: at,
    }));
    tx.importRows.insertMany(stagedRows);

    // Determine beneficiary for splits in this account
    const owner = privateOwner(tx, ctx.viewer, account.id);
    const beneficiary = owner !== null ? owner : "shared";

    // Query existing ledger transactions (including soft-deleted) for deduplication
    const uniqueDates = Array.from(new Set(parsedRows.map((r) => r.postedOn)));
    const existingInDates = tx.transactions.listForDedupe(account.id, uniqueDates);

    const existingExternalIds = new Set<string>();
    const existingFingerprints = new Set<string>();
    // Track occurrences among same-day identical transactions, seeded from existing transactions
    const occurrenceMap = new Map<string, number>();

    for (const t of existingInDates) {
      if (t.externalId) existingExternalIds.add(t.externalId);
      existingFingerprints.add(t.fingerprint);
      const normDesc = normaliseCommBankDescription(t.descriptionRaw);
      const dayKey = `${t.postedOn}\n${t.amountCents}\n${normDesc}`;
      occurrenceMap.set(dayKey, (occurrenceMap.get(dayKey) ?? 0) + 1);
    }

    let newCount = 0;
    let dupCount = 0;
    const transactionIds: Id<"Transaction">[] = [];

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

      const txnRow: TransactionRow = {
        id: txnId,
        accountId: account.id,
        postedOn: row.postedOn,
        amountCents: row.amountCents,
        descriptionRaw: row.rawDescription,
        payeeId: null,
        status: "posted",
        externalId: row.externalId,
        fingerprint,
        fingerprintVersion: FINGERPRINT_VERSION,
        importId: batchId,
        performedBy: null,
        transferGroupId: null,
        needsReview: false,
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
        categoryId: null,
        activityId: null,
        beneficiary,
        propertyId: null,
        taxCategoryId: null,
        deductibleBp: null,
        memo: null,
        categorySource: null,
        activitySource: null,
        taxCategorySource: null,
        beneficiarySource: null,
        deductibleBpSource: null,
        createdAt: at,
        updatedAt: at,
      };

      tx.transactions.insert(txnRow, [splitRow]);
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

    // Update batch status and counts
    tx.importBatches.updateCountsAndStatus(
      batchId,
      {
        rowCount: parsedRows.length,
        newCount,
        dupCount,
        status: "committed",
      },
      at,
    );

    audit({
      entity: "import_batch",
      entityId: batchId,
      accountId: account.id,
      action: "create",
      before: null,
      after: {
        ...batchRow,
        rowCount: parsedRows.length,
        newCount,
        dupCount,
        status: "committed",
      },
    });

    syncClosingBalance(tx, audit, ctx, account.id);

    return {
      batchId,
      status: "committed",
      rowCount: parsedRows.length,
      newCount,
      dupCount,
      transactionIds,
    };
  });
}
