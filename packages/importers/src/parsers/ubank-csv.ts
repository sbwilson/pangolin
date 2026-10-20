import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
  StatementParser,
} from "@pangolin/app";
import { toCents } from "@pangolin/shared";
import { parseCsvLine } from "./commbank-csv.ts";

function parseDateToIso(dateStr: string, rowNumber: number): string {
  const trimmed = dateStr.trim();
  // Check DD/MM/YYYY or D/M/YYYY
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (ddmmyyyy?.[1] && ddmmyyyy[2] && ddmmyyyy[3]) {
    const day = ddmmyyyy[1].padStart(2, "0");
    const month = ddmmyyyy[2].padStart(2, "0");
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }
  // Check YYYY-MM-DD
  const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (yyyymmdd?.[1] && yyyymmdd[2] && yyyymmdd[3]) {
    return trimmed;
  }
  // Check DD/MM/YY
  const ddmmyy = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(trimmed);
  if (ddmmyy?.[1] && ddmmyy[2] && ddmmyy[3]) {
    const day = ddmmyy[1].padStart(2, "0");
    const month = ddmmyy[2].padStart(2, "0");
    const yearNum = Number.parseInt(ddmmyy[3], 10);
    const year = yearNum >= 70 ? `19${ddmmyy[3]}` : `20${ddmmyy[3]}`;
    return `${year}-${month}-${day}`;
  }
  throw new Error(`CSV row ${rowNumber} has invalid date format: "${dateStr}"`);
}

/**
 * Parses ubank CSV statement format:
 * Columns: Date (DD/MM/YYYY), Description, Amount (signed decimal), Balance (decimal)
 */
export function parseUbankCsv(content: string): StatementParseResult {
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
  if (!lines.some((l) => parseCsvLine(l).length >= 2)) {
    throw new Error("Unrecognised CSV format");
  }

  const rows: ParsedStatementRow[] = [];
  const setAside: SetAsideStatementRow[] = [];
  let fileLineNumber = 0;

  for (const line of lines) {
    fileLineNumber += 1;
    const fields = parseCsvLine(line);

    const firstCol = fields[0]?.trim() ?? "";
    if (firstCol.toLowerCase() === "date" || firstCol.toLowerCase() === '"date"') {
      continue;
    }

    try {
      if (fields.length < 3) {
        throw new Error(`CSV row ${fileLineNumber} has fewer than 3 columns: "${line}"`);
      }

      const postedOn = parseDateToIso(firstCol, fileLineNumber);

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
    } catch (err) {
      setAside.push({
        rowNumber: fileLineNumber,
        rawLine: line,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (rows.length === 0 && setAside.length === 0) {
    throw new Error("CSV statement contained no valid transaction rows");
  }

  return Object.assign([...rows], { rows, setAside });
}

export const ubankCsvParser: StatementParser = {
  format: "ubank_csv",
  parse(content: string): StatementParseResult {
    return parseUbankCsv(content);
  },
};
