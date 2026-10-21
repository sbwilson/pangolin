import { toCents } from "@pangolin/shared";
import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
} from "../../ports/statement-parser.ts";
import { parseCsvLine } from "./shared.ts";

export function parseBuiltinUbankCsv(content: string): StatementParseResult {
  const cleanContent = content.replace(/^\uFEFF/, "");
  const lines = cleanContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("CSV statement is empty");
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
