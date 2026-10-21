import { toCents } from "@pangolin/shared";
import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
} from "../../ports/statement-parser.ts";
import { parseCsvLine } from "./shared.ts";

export function parseBuiltinUpCsv(content: string): StatementParseResult {
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
    if (firstCol.toLowerCase() === "time" || firstCol.toLowerCase() === '"time"') {
      continue;
    }

    try {
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
    } catch (err) {
      setAside.push({
        rowNumber: fileLineNumber,
        rawLine: line,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (rows.length === 0 && setAside.length === 0) {
    throw new Error("Up CSV statement contained no valid transaction rows");
  }

  return { rows, setAside };
}
