import type { ParsedStatementRow, StatementParser } from "@pangolin/app";
import { toCents } from "@pangolin/shared";

/**
 * Splits an RFC-4180 CSV line into fields, handling quotes and escaped quotes.
 */
export function parseCsvLine(line: string): string[] {
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

/**
 * Parses CommBank CSV statement format:
 * Columns: Date (DD/MM/YYYY), Amount (signed decimal), Description, Balance (decimal)
 */
export function parseCommBankCsv(content: string): readonly ParsedStatementRow[] {
  if (!content || typeof content !== "string") {
    throw new Error("CSV content is empty or not a string");
  }

  const lines = content
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
    // Check if this is a header row
    if (firstCol.toLowerCase() === "date" || firstCol.toLowerCase() === '"date"') {
      continue;
    }

    if (fields.length < 3) {
      throw new Error(`CSV row ${fileLineNumber} has fewer than 3 columns: "${line}"`);
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

export const commbankCsvParser: StatementParser = {
  format: "commbank_csv",
  parse(content: string): readonly ParsedStatementRow[] {
    return parseCommBankCsv(content);
  },
};
