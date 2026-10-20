import type {
  CsvColumnMapping,
  DateFormat,
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
  StatementParser,
} from "@pangolin/app";
import { toCents } from "@pangolin/shared";
import { parseCsvLine } from "./commbank-csv.ts";

function parseDateWithFormat(
  dateStr: string,
  format: DateFormat | undefined,
  rowNumber: number,
): string {
  const trimmed = dateStr.trim();

  if (format === "YYYY-MM-DD") {
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(trimmed);
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new Error(`CSV row ${rowNumber} date "${dateStr}" does not match format ${format}`);
    }
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  if (format === "MM/DD/YYYY") {
    const match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(trimmed);
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new Error(`CSV row ${rowNumber} date "${dateStr}" does not match format ${format}`);
    }
    return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }

  if (format === "DD-MM-YYYY" || format === "DD/MM/YYYY") {
    const match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(trimmed);
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new Error(`CSV row ${rowNumber} date "${dateStr}" does not match format ${format}`);
    }
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  // Automatic fallback detection if format not specified:
  // 1. YYYY-MM-DD
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(trimmed);
  if (ymd?.[1] && ymd[2] && ymd[3]) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }
  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(trimmed);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  // 3. DD/MM/YY
  const dmy2 = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2})/.exec(trimmed);
  if (dmy2?.[1] && dmy2[2] && dmy2[3]) {
    const yr = Number.parseInt(dmy2[3], 10);
    const year = yr >= 70 ? `19${dmy2[3]}` : `20${dmy2[3]}`;
    return `${year}-${dmy2[2].padStart(2, "0")}-${dmy2[1].padStart(2, "0")}`;
  }

  throw new Error(`CSV row ${rowNumber} has unrecognised date format: "${dateStr}"`);
}

function resolveColumnIndex(
  col: number | string | undefined,
  headers: string[],
  hasHeader: boolean,
  name: string,
): number | undefined {
  if (col === undefined) return undefined;
  if (typeof col === "number") {
    if (col < 0) {
      throw new Error(`Column mapping for "${name}" cannot be negative (${col})`);
    }
    return col;
  }
  if (!hasHeader) {
    throw new Error(
      `Named column mapping "${col}" for "${name}" requires hasHeader: true in CsvColumnMapping`,
    );
  }
  const needle = col.trim().toLowerCase();
  const index = headers.findIndex((h) => h.trim().toLowerCase() === needle);
  if (index === -1) {
    throw new Error(
      `Column "${col}" for "${name}" not found in CSV header: [${headers.join(", ")}]`,
    );
  }
  return index;
}

export function parseGenericCsv(content: string, mapping: CsvColumnMapping): StatementParseResult {
  if (!content || typeof content !== "string") {
    throw new Error("CSV content is empty or not a string");
  }

  const cleanContent = content.replace(/^\uFEFF/, "");
  const delimiter = mapping.delimiter ?? ",";
  const lines = cleanContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error("CSV content contains no rows");
  }

  // Determine whether header is present. If not specified, default to true if any key is a string.
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
    const firstLine = lines[0];
    if (!firstLine) {
      throw new Error("CSV content is empty");
    }
    headerRow = parseCsvLine(firstLine, delimiter);
    startIndex = 1;
  }

  const dateCol = resolveColumnIndex(mapping.date, headerRow, hasHeader, "date");
  if (dateCol === undefined) {
    throw new Error('CsvColumnMapping must specify a "date" column');
  }

  const descCol = resolveColumnIndex(mapping.description, headerRow, hasHeader, "description");
  if (descCol === undefined) {
    throw new Error('CsvColumnMapping must specify a "description" column');
  }

  const amountCol = resolveColumnIndex(mapping.amount, headerRow, hasHeader, "amount");
  const debitCol = resolveColumnIndex(mapping.debit, headerRow, hasHeader, "debit");
  const creditCol = resolveColumnIndex(mapping.credit, headerRow, hasHeader, "credit");
  const balanceCol = resolveColumnIndex(mapping.balance, headerRow, hasHeader, "balance");
  const extIdCol = resolveColumnIndex(mapping.externalId, headerRow, hasHeader, "externalId");
  const memoCol = resolveColumnIndex(mapping.memo, headerRow, hasHeader, "memo");

  if (amountCol === undefined && debitCol === undefined && creditCol === undefined) {
    throw new Error('CsvColumnMapping must specify either "amount" or "debit"/"credit" columns');
  }

  const rows: ParsedStatementRow[] = [];
  const setAside: SetAsideStatementRow[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const fileLineNumber = i + 1;
    const line = lines[i];
    if (!line) continue;

    try {
      const fields = parseCsvLine(line, delimiter);

      // Validate required columns exist in row
      const maxRequiredCol = Math.max(
        dateCol,
        descCol,
        amountCol ?? -1,
        debitCol ?? -1,
        creditCol ?? -1,
      );
      if (fields.length <= maxRequiredCol) {
        throw new Error(
          `CSV row ${fileLineNumber} has fewer columns (${fields.length}) than required by mapping (${maxRequiredCol + 1})`,
        );
      }

      const dateVal = fields[dateCol]?.trim() ?? "";
      if (!dateVal) {
        throw new Error(`CSV row ${fileLineNumber} has empty date`);
      }
      const postedOn = parseDateWithFormat(dateVal, mapping.dateFormat, fileLineNumber);

      let rawDescription = fields[descCol]?.trim() ?? "";
      if (memoCol !== undefined && fields[memoCol]) {
        const memoVal = fields[memoCol].trim();
        if (memoVal && memoVal !== rawDescription) {
          rawDescription = rawDescription ? `${rawDescription} ${memoVal}` : memoVal;
        }
      }
      if (!rawDescription) {
        throw new Error(`CSV row ${fileLineNumber} has empty description`);
      }

      let amountCents: number;

      if (amountCol !== undefined) {
        const amountStr = fields[amountCol]?.trim() ?? "";
        if (!amountStr) {
          throw new Error(`CSV row ${fileLineNumber} has empty amount`);
        }
        try {
          amountCents = toCents(amountStr);
        } catch (err) {
          throw new Error(`CSV row ${fileLineNumber} has invalid amount "${amountStr}"`, {
            cause: err,
          });
        }
      } else {
        // Debit/Credit columns
        const parseOptionalCents = (
          val: string | undefined,
          colName: "debit" | "credit",
        ): number | null => {
          if (!val) return null;
          const trimmed = val.trim();
          if (trimmed === "") return null;
          try {
            const cents = toCents(trimmed);
            return cents !== 0 ? cents : null;
          } catch (err) {
            throw new Error(
              `CSV row ${fileLineNumber} has invalid ${colName} amount: "${trimmed}"`,
              { cause: err },
            );
          }
        };

        const debitCents =
          debitCol !== undefined ? parseOptionalCents(fields[debitCol], "debit") : null;
        const creditCents =
          creditCol !== undefined ? parseOptionalCents(fields[creditCol], "credit") : null;

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
    } catch (err) {
      setAside.push({
        rowNumber: fileLineNumber,
        rawLine: line,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (rows.length === 0 && setAside.length === 0) {
    throw new Error("Generic CSV statement contained no valid transaction rows");
  }

  return Object.assign([...rows], { rows, setAside });
}

export function createGenericCsvParser(mapping: CsvColumnMapping): StatementParser {
  return {
    format: "generic_csv",
    parse(content: string): StatementParseResult {
      return parseGenericCsv(content, mapping);
    },
  };
}
