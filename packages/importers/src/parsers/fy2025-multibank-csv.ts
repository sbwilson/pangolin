import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
  StatementParser,
} from "@pangolin/app";
import { toCents } from "@pangolin/shared";
import { parseCsvLine } from "./commbank-csv.ts";

function parseTimestampToIsoDate(timestampStr: string, rowNumber: number): string {
  const trimmed = timestampStr.trim();
  // Check if starts with YYYY-MM-DD (e.g. 2024-09-01 12:00:00 or 2024-09-01T12:00:00Z)
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (ymd?.[1] && ymd[2] && ymd[3]) {
    return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  }
  // Check if starts with DD/MM/YYYY
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(trimmed);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }
  throw new Error(`CSV row ${rowNumber} has invalid timestamp format: "${timestampStr}"`);
}

/**
 * Parses FY2025 multi-bank CSV statement format:
 * Columns: Timestamp, Account, Amount, Description, Balance
 */
export function parseFy2025MultiBankCsv(content: string): StatementParseResult {
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
  const setAside: SetAsideStatementRow[] = [];
  let fileLineNumber = 0;

  for (const line of lines) {
    fileLineNumber += 1;
    const fields = parseCsvLine(line);

    const firstCol = fields[0]?.trim() ?? "";
    if (firstCol.toLowerCase() === "timestamp" || firstCol.toLowerCase() === '"timestamp"') {
      continue;
    }

    try {
      if (fields.length < 4) {
        throw new Error(`CSV row ${fileLineNumber} has fewer than 4 columns: "${line}"`);
      }

      const postedOn = parseTimestampToIsoDate(firstCol, fileLineNumber);

      const amountStr = fields[2]?.trim() ?? "";
      let amountCents: number;
      try {
        amountCents = toCents(amountStr);
      } catch (err) {
        throw new Error(`CSV row ${fileLineNumber} has invalid amount: "${amountStr}"`, {
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
    } catch (err) {
      setAside.push({
        rowNumber: fileLineNumber,
        rawLine: line,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (rows.length === 0 && setAside.length === 0) {
    throw new Error("FY2025 multi-bank CSV statement contained no valid transaction rows");
  }

  return Object.assign([...rows], { rows, setAside });
}

export const fy2025MultiBankCsvParser: StatementParser = {
  format: "fy2025_multibank_csv",
  parse(content: string): StatementParseResult {
    return parseFy2025MultiBankCsv(content);
  },
};
