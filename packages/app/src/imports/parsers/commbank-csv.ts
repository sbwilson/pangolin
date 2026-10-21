import { toCents } from "@pangolin/shared";
import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
} from "../../ports/statement-parser.ts";
import { parseCsvLine } from "./shared.ts";

export function parseBuiltinCommBankCsv(content: string): StatementParseResult {
  const cleanContent = content.replace(/^\uFEFF/, "");
  const lines = cleanContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error("CSV statement is empty");
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

      // The fourth column is the running balance; one that does not parse is left out.
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

  return { rows, setAside };
}
