import type { ParsedStatementRow, StatementParser } from "@pangolin/app";
import { toCents } from "@pangolin/shared";
import { parseCsvLine } from "./commbank-csv.ts";

function parseSettledDate(dateStr: string, rowNumber: number): string {
  const trimmed = dateStr.trim();
  // Check YYYY-MM-DD
  const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (yyyymmdd?.[1] && yyyymmdd[2] && yyyymmdd[3]) {
    return trimmed;
  }
  // Check DD/MM/YYYY
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (ddmmyyyy?.[1] && ddmmyyyy[2] && ddmmyyyy[3]) {
    const day = ddmmyyyy[1].padStart(2, "0");
    const month = ddmmyyyy[2].padStart(2, "0");
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }
  throw new Error(`Up CSV row ${rowNumber} has invalid settled date format: "${dateStr}"`);
}

/**
 * Parses Up CSV statement format:
 * Columns: Time, Settled Date, Description, Amount, Status
 * Only settled transactions are imported; pending/unsettled rows are skipped.
 */
export function parseUpCsv(content: string): readonly ParsedStatementRow[] {
  if (!content || typeof content !== "string") {
    throw new Error("CSV content is empty or not a string");
  }

  const cleanContent = content.replace(/^\uFEFF/, "");
  const lines = cleanContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error("CSV content contains no rows");
  }

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
      throw new Error(`Up CSV row ${fileLineNumber} has fewer than 4 columns: "${line}"`);
    }

    const settledDateRaw = fields[1]?.trim() ?? "";
    const status = fields[4]?.trim().toUpperCase();

    // Skip non-settled / pending transactions or transactions with no settled date
    if (!settledDateRaw || (status !== undefined && status !== "" && status !== "SETTLED")) {
      continue;
    }

    const postedOn = parseSettledDate(settledDateRaw, fileLineNumber);

    const rawDescription = fields[2]?.trim() ?? "";
    if (!rawDescription) {
      throw new Error(`Up CSV row ${fileLineNumber} has empty description`);
    }

    const amountStr = fields[3]?.trim() ?? "";
    let amountCents: number;
    try {
      amountCents = toCents(amountStr);
    } catch (err) {
      throw new Error(`Up CSV row ${fileLineNumber} has invalid amount: "${amountStr}"`, {
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

export const upCsvParser: StatementParser = {
  format: "up_csv",
  parse(content: string): readonly ParsedStatementRow[] {
    return parseUpCsv(content);
  },
};
