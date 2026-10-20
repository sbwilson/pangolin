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
import type {
  CsvColumnMapping,
  ParsedStatementRow,
  StatementParser,
} from "../ports/statement-parser.ts";
import type {
  ImportBatchRow,
  ImportBatchStatus,
  ImportRowRow,
  SplitRow,
  TransactionRow,
} from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

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
  readonly transactionIds: readonly Id<"Transaction">[];
}

export interface ImportStatementOptions {
  readonly parser?: StatementParser;
}

function parseCsvLine(line: string, delimiter = ","): string[] {
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
    } else if (char === delimiter && !inQuotes) {
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
  const cleanContent = content.replace(/^\uFEFF/, "");
  if (
    !cleanContent.includes("<OFX>") &&
    !cleanContent.includes("<ofx>") &&
    !cleanContent.includes("OFXHEADER")
  ) {
    throw new Error("Invalid OFX: missing OFX header or root element");
  }

  const rows: ParsedStatementRow[] = [];
  const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let rowNumber = 1;

  for (const match of cleanContent.matchAll(trnRegex)) {
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
  const cleanContent = content.replace(/^\uFEFF/, "");
  const lines = cleanContent
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

function parseBuiltinUbankCsv(content: string): ParsedStatementRow[] {
  const cleanContent = content.replace(/^\uFEFF/, "");
  const lines = cleanContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("CSV statement is empty");

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

    const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(firstCol);
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstCol);
    const ddmmyy = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(firstCol);
    let postedOn: string;
    if (ddmmyyyy?.[1] && ddmmyyyy[2] && ddmmyyyy[3]) {
      postedOn = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
    } else if (ymd?.[1] && ymd[2] && ymd[3]) {
      postedOn = firstCol;
    } else if (ddmmyy?.[1] && ddmmyy[2] && ddmmyy[3]) {
      const yr = Number.parseInt(ddmmyy[3], 10);
      const year = yr >= 70 ? `19${ddmmyy[3]}` : `20${ddmmyy[3]}`;
      postedOn = `${year}-${ddmmyy[2].padStart(2, "0")}-${ddmmyy[1].padStart(2, "0")}`;
    } else {
      throw new Error(`CSV row ${fileLineNumber} has invalid date format: "${firstCol}"`);
    }

    const rawDescription = fields[1]?.trim() ?? "";
    if (!rawDescription) {
      throw new Error(`CSV row ${fileLineNumber} has empty description`);
    }

    const amountStr = fields[2]?.trim() ?? "";
    let amountCents: number;
    try {
      amountCents = toCents(amountStr);
    } catch (err) {
      throw new Error(`CSV row ${fileLineNumber} has invalid amount: "${amountStr}"`, {
        cause: err,
      });
    }

    let balanceCents: number | null = null;
    if (fields.length >= 4 && fields[3]?.trim()) {
      try {
        balanceCents = toCents(fields[3].trim());
      } catch {
        balanceCents = null;
      }
    }

    rows.push({
      rowNumber: fileLineNumber,
      rawLine: line,
      postedOn,
      amountCents,
      rawDescription,
      externalId: null,
      balanceCents,
    });
  }

  if (rows.length === 0) {
    throw new Error("CSV statement contained no valid transaction rows");
  }

  return rows;
}

function parseBuiltinUpCsv(content: string): ParsedStatementRow[] {
  const cleanContent = content.replace(/^\uFEFF/, "");
  const lines = cleanContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("CSV statement is empty");

  const rows: ParsedStatementRow[] = [];
  let fileLineNumber = 0;

  for (const line of lines) {
    fileLineNumber += 1;
    const fields = parseCsvLine(line);
    const firstCol = fields[0]?.trim() ?? "";
    if (firstCol.toLowerCase() === "time" || firstCol.toLowerCase() === '"time"') {
      continue;
    }
    if (fields.length < 4) {
      throw new Error(`Up CSV row ${fileLineNumber} has fewer than 4 columns`);
    }

    const settledDateRaw = fields[1]?.trim() ?? "";
    const status = fields[4]?.trim().toUpperCase();
    if (!settledDateRaw || (status !== undefined && status !== "" && status !== "SETTLED")) {
      continue;
    }

    let postedOn: string;
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(settledDateRaw);
    if (ymd?.[1] && ymd[2] && ymd[3]) {
      postedOn = settledDateRaw;
    } else {
      const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(settledDateRaw);
      if (dmy?.[1] && dmy[2] && dmy[3]) {
        postedOn = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
      } else {
        throw new Error(
          `Up CSV row ${fileLineNumber} has invalid settled date: "${settledDateRaw}"`,
        );
      }
    }

    const rawDescription = fields[2]?.trim() ?? "";
    if (!rawDescription) {
      throw new Error(`Up CSV row ${fileLineNumber} has empty description`);
    }

    let amountCents: number;
    try {
      amountCents = toCents(fields[3]?.trim() ?? "");
    } catch (err) {
      throw new Error(`Up CSV row ${fileLineNumber} has invalid amount: "${fields[3]}"`, {
        cause: err,
      });
    }

    rows.push({
      rowNumber: fileLineNumber,
      rawLine: line,
      postedOn,
      amountCents,
      rawDescription,
      externalId: null,
      balanceCents: null,
    });
  }

  if (rows.length === 0) {
    throw new Error("Up CSV statement contained no valid transaction rows");
  }

  return rows;
}

function parseBuiltinQif(content: string): ParsedStatementRow[] {
  const cleanContent = content.replace(/^\uFEFF/, "");
  const trimmed = cleanContent.trim();
  if (!trimmed.includes("!Type:")) {
    throw new Error("Invalid QIF: missing !Type header");
  }

  const lines = cleanContent.split(/\r?\n/);
  const rows: ParsedStatementRow[] = [];

  let currentBlockLines: string[] = [];
  let recordIndex = 0;
  let dateRaw: string | null = null;
  let amountRaw: string | null = null;
  let payeeRaw: string | null = null;
  let memoRaw: string | null = null;
  let numberRaw: string | null = null;

  const commitRecord = () => {
    if (!dateRaw && !amountRaw) {
      currentBlockLines = [];
      payeeRaw = null;
      memoRaw = null;
      numberRaw = null;
      return;
    }
    recordIndex += 1;
    if (!dateRaw) throw new Error(`QIF record ${recordIndex} missing date`);
    if (!amountRaw) throw new Error(`QIF record ${recordIndex} missing amount`);

    const trimmedDate = dateRaw.trim();
    let postedOn: string;
    const dmy = /^(\d{1,2})[/'-](\d{1,2})[/'-](\d{2,4})$/.exec(trimmedDate);
    const ymd = /^(\d{4})[/'-](\d{1,2})[/'-](\d{1,2})$/.exec(trimmedDate);
    if (dmy?.[1] && dmy[2] && dmy[3]) {
      const yr =
        dmy[3].length === 2
          ? Number.parseInt(dmy[3], 10) >= 70
            ? `19${dmy[3]}`
            : `20${dmy[3]}`
          : dmy[3];
      postedOn = `${yr}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    } else if (ymd?.[1] && ymd[2] && ymd[3]) {
      postedOn = `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
    } else {
      throw new Error(`QIF record ${recordIndex} has invalid date: "${dateRaw}"`);
    }

    let amountCents: number;
    try {
      amountCents = toCents(amountRaw.replace(/,/g, ""));
    } catch (err) {
      throw new Error(`QIF record ${recordIndex} has invalid amount: "${amountRaw}"`, {
        cause: err,
      });
    }

    const payee = payeeRaw?.trim() ?? "";
    const memo = memoRaw?.trim() ?? "";
    let rawDescription = payee;
    if (memo && memo !== payee) {
      rawDescription = payee ? `${payee} ${memo}` : memo;
    }
    if (!rawDescription) rawDescription = "Transaction";

    rows.push({
      rowNumber: recordIndex,
      rawLine: currentBlockLines.join("\n"),
      postedOn,
      amountCents,
      rawDescription,
      externalId: numberRaw?.trim() || null,
      balanceCents: null,
    });

    currentBlockLines = [];
    dateRaw = null;
    amountRaw = null;
    payeeRaw = null;
    memoRaw = null;
    numberRaw = null;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("!")) continue;
    if (trimmedLine === "^") {
      if (!dateRaw && !amountRaw) {
        currentBlockLines = [];
        payeeRaw = null;
        memoRaw = null;
        numberRaw = null;
        continue;
      }
      currentBlockLines.push(line);
      commitRecord();
    } else {
      currentBlockLines.push(line);
      const code = trimmedLine[0];
      const rest = trimmedLine.slice(1);
      if (code === "D") dateRaw = rest;
      else if (code === "T" || code === "U") {
        if (!amountRaw) amountRaw = rest;
      } else if (code === "P") payeeRaw = rest;
      else if (code === "M") memoRaw = rest;
      else if (code === "N") numberRaw = rest;
    }
  }

  if (currentBlockLines.length > 0) {
    commitRecord();
  }

  if (rows.length === 0) {
    throw new Error("QIF statement contained no transaction rows");
  }

  return rows;
}

function parseBuiltinFy2025MultiBankCsv(content: string): ParsedStatementRow[] {
  const cleanContent = content.replace(/^\uFEFF/, "");
  const lines = cleanContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("CSV statement is empty");

  const rows: ParsedStatementRow[] = [];
  let fileLineNumber = 0;

  for (const line of lines) {
    fileLineNumber += 1;
    const fields = parseCsvLine(line);
    const firstCol = fields[0]?.trim() ?? "";
    if (firstCol.toLowerCase() === "timestamp" || firstCol.toLowerCase() === '"timestamp"') {
      continue;
    }
    if (fields.length < 4) {
      throw new Error(`CSV row ${fileLineNumber} has fewer than 4 columns`);
    }

    let postedOn: string;
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(firstCol);
    if (ymd?.[1] && ymd[2] && ymd[3]) {
      postedOn = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    } else {
      const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(firstCol);
      if (dmy?.[1] && dmy[2] && dmy[3]) {
        postedOn = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
      } else {
        throw new Error(`CSV row ${fileLineNumber} has invalid timestamp: "${firstCol}"`);
      }
    }

    let amountCents: number;
    try {
      amountCents = toCents(fields[2]?.trim() ?? "");
    } catch (err) {
      throw new Error(`CSV row ${fileLineNumber} has invalid amount: "${fields[2]}"`, {
        cause: err,
      });
    }

    const rawDescription = fields[3]?.trim() ?? "";
    if (!rawDescription) {
      throw new Error(`CSV row ${fileLineNumber} has empty description`);
    }

    let balanceCents: number | null = null;
    if (fields.length >= 5 && fields[4]?.trim()) {
      try {
        balanceCents = toCents(fields[4].trim());
      } catch {
        balanceCents = null;
      }
    }

    rows.push({
      rowNumber: fileLineNumber,
      rawLine: line,
      postedOn,
      amountCents,
      rawDescription,
      externalId: null,
      balanceCents,
    });
  }

  if (rows.length === 0) {
    throw new Error("CSV statement contained no valid transaction rows");
  }

  return rows;
}

function parseBuiltinGenericCsv(content: string, mapping: CsvColumnMapping): ParsedStatementRow[] {
  const cleanContent = content.replace(/^\uFEFF/, "");
  const delimiter = mapping.delimiter ?? ",";
  const lines = cleanContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("CSV content contains no rows");

  const hasStringKey =
    typeof mapping.date === "string" ||
    typeof mapping.description === "string" ||
    typeof mapping.amount === "string" ||
    typeof mapping.debit === "string" ||
    typeof mapping.credit === "string" ||
    typeof mapping.balance === "string" ||
    typeof mapping.externalId === "string" ||
    typeof mapping.memo === "string";

  const hasHeader = mapping.hasHeader ?? Boolean(hasStringKey);
  let headerRow: string[] = [];
  let startIndex = 0;

  if (hasHeader) {
    headerRow = parseCsvLine(lines[0] ?? "", delimiter);
    startIndex = 1;
  }

  const resolveCol = (col: number | string | undefined, name: string): number | undefined => {
    if (col === undefined) return undefined;
    if (typeof col === "number") return col;
    if (!hasHeader) throw new Error(`Named column "${col}" for "${name}" requires hasHeader: true`);
    const idx = headerRow.findIndex((h) => h.trim().toLowerCase() === col.trim().toLowerCase());
    if (idx === -1) throw new Error(`Column "${col}" for "${name}" not found in CSV header`);
    return idx;
  };

  const dateCol = resolveCol(mapping.date, "date");
  if (dateCol === undefined) throw new Error('CsvColumnMapping must specify a "date" column');
  const descCol = resolveCol(mapping.description, "description");
  if (descCol === undefined)
    throw new Error('CsvColumnMapping must specify a "description" column');
  const amountCol = resolveCol(mapping.amount, "amount");
  const debitCol = resolveCol(mapping.debit, "debit");
  const creditCol = resolveCol(mapping.credit, "credit");
  const balanceCol = resolveCol(mapping.balance, "balance");
  const extIdCol = resolveCol(mapping.externalId, "externalId");
  const memoCol = resolveCol(mapping.memo, "memo");

  if (amountCol === undefined && debitCol === undefined && creditCol === undefined) {
    throw new Error('CsvColumnMapping must specify either "amount" or "debit"/"credit" columns');
  }

  const rows: ParsedStatementRow[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const fileLineNumber = i + 1;
    const line = lines[i];
    if (!line) continue;

    const fields = parseCsvLine(line, delimiter);
    const maxCol = Math.max(dateCol, descCol, amountCol ?? -1, debitCol ?? -1, creditCol ?? -1);
    if (fields.length <= maxCol) {
      throw new Error(`CSV row ${fileLineNumber} has fewer columns than required by mapping`);
    }

    const dateVal = fields[dateCol]?.trim() ?? "";
    if (!dateVal) throw new Error(`CSV row ${fileLineNumber} has empty date`);

    let postedOn: string;
    if (mapping.dateFormat === "YYYY-MM-DD") {
      const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(dateVal);
      if (!match?.[1] || !match[2] || !match[3])
        throw new Error(`CSV row ${fileLineNumber} invalid date`);
      postedOn = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    } else if (mapping.dateFormat === "MM/DD/YYYY") {
      const match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(dateVal);
      if (!match?.[1] || !match[2] || !match[3])
        throw new Error(`CSV row ${fileLineNumber} invalid date`);
      postedOn = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    } else {
      const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(dateVal);
      const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(dateVal);
      if (dmy?.[1] && dmy[2] && dmy[3]) {
        const yr =
          dmy[3].length === 2
            ? Number.parseInt(dmy[3], 10) >= 70
              ? `19${dmy[3]}`
              : `20${dmy[3]}`
            : dmy[3];
        postedOn = `${yr}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
      } else if (ymd?.[1] && ymd[2] && ymd[3]) {
        postedOn = `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
      } else {
        throw new Error(`CSV row ${fileLineNumber} has unrecognised date format: "${dateVal}"`);
      }
    }

    let rawDescription = fields[descCol]?.trim() ?? "";
    if (memoCol !== undefined && fields[memoCol]) {
      const memoVal = fields[memoCol].trim();
      if (memoVal && memoVal !== rawDescription) {
        rawDescription = rawDescription ? `${rawDescription} ${memoVal}` : memoVal;
      }
    }
    if (!rawDescription) throw new Error(`CSV row ${fileLineNumber} has empty description`);

    let amountCents: number;
    if (amountCol !== undefined) {
      const amountStr = fields[amountCol]?.trim() ?? "";
      if (!amountStr) throw new Error(`CSV row ${fileLineNumber} has empty amount`);
      try {
        amountCents = toCents(amountStr);
      } catch (err) {
        throw new Error(`CSV row ${fileLineNumber} has invalid amount: "${amountStr}"`, {
          cause: err,
        });
      }
    } else {
      const parseOptionalCents = (val: string | undefined): number | null => {
        if (!val) return null;
        const trimmed = val.trim();
        if (trimmed === "") return null;
        try {
          const cents = toCents(trimmed);
          return cents !== 0 ? cents : null;
        } catch {
          return null;
        }
      };

      const debitCents = debitCol !== undefined ? parseOptionalCents(fields[debitCol]) : null;
      const creditCents = creditCol !== undefined ? parseOptionalCents(fields[creditCol]) : null;

      if (debitCents !== null && creditCents !== null) {
        const dVal = debitCol !== undefined ? fields[debitCol] : "";
        const cVal = creditCol !== undefined ? fields[creditCol] : "";
        throw new Error(
          `CSV row ${fileLineNumber} has both debit and credit amounts: debit="${dVal}", credit="${cVal}"`,
        );
      }
      if (debitCents === null && creditCents === null) {
        throw new Error(`CSV row ${fileLineNumber} has neither debit nor credit amount`);
      }

      if (debitCents !== null) {
        amountCents = -debitCents;
      } else if (creditCents !== null) {
        amountCents = creditCents;
      } else {
        throw new Error(`CSV row ${fileLineNumber} has neither debit nor credit amount`);
      }
    }

    if (mapping.signConvention === "inverted") {
      amountCents = -amountCents;
    }

    let balanceCents: number | null = null;
    if (balanceCol !== undefined && fields[balanceCol]?.trim()) {
      try {
        balanceCents = toCents(fields[balanceCol].trim());
      } catch {
        balanceCents = null;
      }
    }

    let externalId: string | null = null;
    if (extIdCol !== undefined && fields[extIdCol]?.trim()) {
      externalId = fields[extIdCol].trim();
    }

    rows.push({
      rowNumber: fileLineNumber,
      rawLine: line,
      postedOn,
      amountCents,
      rawDescription,
      externalId,
      balanceCents,
    });
  }

  if (rows.length === 0) {
    throw new Error("Generic CSV statement contained no valid transaction rows");
  }

  return rows;
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
  let parsedRows: readonly ParsedStatementRow[];
  try {
    if (options?.parser) {
      parsedRows = options.parser.parse(parsed.content);
    } else if (parsed.format === "commbank_ofx") {
      parsedRows = parseBuiltinCommBankOfx(parsed.content);
    } else if (parsed.format === "commbank_csv") {
      parsedRows = parseBuiltinCommBankCsv(parsed.content);
    } else if (parsed.format === "commbank_qif" || parsed.format === "qif") {
      parsedRows = parseBuiltinQif(parsed.content);
    } else if (parsed.format === "ubank_csv") {
      parsedRows = parseBuiltinUbankCsv(parsed.content);
    } else if (parsed.format === "up_csv") {
      parsedRows = parseBuiltinUpCsv(parsed.content);
    } else if (parsed.format === "fy2025_multibank_csv") {
      parsedRows = parseBuiltinFy2025MultiBankCsv(parsed.content);
    } else if (parsed.format === "generic_csv") {
      if (!parsed.csvMapping) {
        throw new Error("Generic CSV format requires csvMapping configuration");
      }
      parsedRows = parseBuiltinGenericCsv(parsed.content, parsed.csvMapping);
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
