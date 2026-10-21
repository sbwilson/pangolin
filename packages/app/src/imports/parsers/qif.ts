import { toCents } from "@pangolin/shared";
import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
} from "../../ports/statement-parser.ts";

export function parseBuiltinQif(content: string): StatementParseResult {
  const cleanContent = content.replace(/^\uFEFF/, "");
  const trimmed = cleanContent.trim();
  if (!trimmed.includes("!Type:")) {
    throw new Error("Invalid QIF: missing !Type header");
  }

  const lines = cleanContent.split(/\r?\n/);
  const rows: ParsedStatementRow[] = [];
  const setAside: SetAsideStatementRow[] = [];

  let currentBlockLines: string[] = [];
  let recordIndex = 0;
  let dateRaw: string | null = null;
  let amountRaw: string | null = null;
  let payeeRaw: string | null = null;
  let memoRaw: string | null = null;
  let numberRaw: string | null = null;

  const commitRecord = () => {
    if (currentBlockLines.length === 0) {
      dateRaw = null;
      amountRaw = null;
      payeeRaw = null;
      memoRaw = null;
      numberRaw = null;
      return;
    }
    recordIndex += 1;

    try {
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
    } catch (err) {
      setAside.push({
        rowNumber: recordIndex,
        rawLine: currentBlockLines.join("\n"),
        reason: err instanceof Error ? err.message : String(err),
      });
    }

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
      if (currentBlockLines.length === 0) {
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

  if (rows.length === 0 && setAside.length === 0) {
    throw new Error("QIF statement contained no transaction rows");
  }

  return { rows, setAside };
}
