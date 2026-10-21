import { toCents } from "@pangolin/shared";
import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
} from "../../ports/statement-parser.ts";
import { parseCsvLine } from "./shared.ts";

export function parseBuiltinFy2025MultiBankCsv(content: string): StatementParseResult {
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
    if (firstCol.toLowerCase() === "timestamp" || firstCol.toLowerCase() === '"timestamp"') {
      continue;
    }

    try {
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
