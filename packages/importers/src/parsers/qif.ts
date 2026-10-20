import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
  StatementParser,
} from "@pangolin/app";
import { toCents } from "@pangolin/shared";

function parseQifDate(dateStr: string, recordIndex: number): string {
  const trimmed = dateStr.trim();
  // Match DD/MM/YYYY, DD-MM-YYYY, DD/MM'YYYY
  const dmy4 = /^(\d{1,2})[/'-](\d{1,2})[/'-](\d{4})$/.exec(trimmed);
  if (dmy4?.[1] && dmy4[2] && dmy4[3]) {
    const day = dmy4[1].padStart(2, "0");
    const month = dmy4[2].padStart(2, "0");
    const year = dmy4[3];
    return `${year}-${month}-${day}`;
  }
  // Match YYYY-MM-DD
  const ymd4 = /^(\d{4})[/'-](\d{1,2})[/'-](\d{1,2})$/.exec(trimmed);
  if (ymd4?.[1] && ymd4[2] && ymd4[3]) {
    const year = ymd4[1];
    const month = ymd4[2].padStart(2, "0");
    const day = ymd4[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  // Match DD/MM'YY or DD/MM/YY
  const dmy2 = /^(\d{1,2})[/'-](\d{1,2})[/'-](\d{2})$/.exec(trimmed);
  if (dmy2?.[1] && dmy2[2] && dmy2[3]) {
    const day = dmy2[1].padStart(2, "0");
    const month = dmy2[2].padStart(2, "0");
    const yr = Number.parseInt(dmy2[3], 10);
    const year = yr >= 70 ? `19${dmy2[3]}` : `20${dmy2[3]}`;
    return `${year}-${month}-${day}`;
  }
  throw new Error(`QIF record ${recordIndex} has invalid date format: "${dateStr}"`);
}

/**
 * Parses standard QIF statement files (!Type:Bank).
 * Extracts date (D), amount (T), payee (P), memo (M), and reference number (N as externalId).
 */
export function parseQif(content: string): StatementParseResult {
  if (!content || typeof content !== "string") {
    throw new Error("QIF content is empty or not a string");
  }

  const cleanContent = content.replace(/^\uFEFF/, "");
  const trimmed = cleanContent.trim();
  if (!trimmed.startsWith("!Type:") && !trimmed.includes("!Type:")) {
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

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Header line, e.g. !Type:Bank
    if (trimmedLine.startsWith("!")) {
      continue;
    }

    if (trimmedLine === "^") {
      if (currentBlockLines.length === 0) {
        payeeRaw = null;
        memoRaw = null;
        numberRaw = null;
        continue;
      }

      // End of record
      recordIndex += 1;
      currentBlockLines.push(line);

      try {
        if (!dateRaw) {
          throw new Error(`QIF record ${recordIndex} is missing date (D) field`);
        }
        if (!amountRaw) {
          throw new Error(`QIF record ${recordIndex} is missing amount (T) field`);
        }

        const postedOn = parseQifDate(dateRaw, recordIndex);

        // Clean amount: strip commas
        const cleanAmt = amountRaw.replace(/,/g, "");
        let amountCents: number;
        try {
          amountCents = toCents(cleanAmt);
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
        if (!rawDescription) {
          rawDescription = "Transaction";
        }

        const externalId = numberRaw?.trim() || null;

        rows.push({
          rowNumber: recordIndex,
          rawLine: currentBlockLines.join("\n"),
          postedOn,
          amountCents,
          rawDescription,
          externalId,
          balanceCents: null,
        });
      } catch (err) {
        setAside.push({
          rowNumber: recordIndex,
          rawLine: currentBlockLines.join("\n"),
          reason: err instanceof Error ? err.message : String(err),
        });
      }

      // Reset for next record
      currentBlockLines = [];
      dateRaw = null;
      amountRaw = null;
      payeeRaw = null;
      memoRaw = null;
      numberRaw = null;
    } else {
      currentBlockLines.push(line);
      const code = trimmedLine[0];
      const rest = trimmedLine.slice(1);

      switch (code) {
        case "D":
          dateRaw = rest;
          break;
        case "T":
        case "U": // Some QIF files have U for higher precision or identical amount
          if (!amountRaw) amountRaw = rest;
          break;
        case "P":
          payeeRaw = rest;
          break;
        case "M":
          memoRaw = rest;
          break;
        case "N":
          numberRaw = rest;
          break;
      }
    }
  }

  // Handle trailing record if not terminated by ^
  if (currentBlockLines.length > 0) {
    recordIndex += 1;
    try {
      if (!dateRaw) {
        throw new Error(`QIF record ${recordIndex} is missing date (D) field`);
      }
      if (!amountRaw) {
        throw new Error(`QIF record ${recordIndex} is missing amount (T) field`);
      }
      const postedOn = parseQifDate(dateRaw, recordIndex);
      const cleanAmt = amountRaw.replace(/,/g, "");
      let amountCents: number;
      try {
        amountCents = toCents(cleanAmt);
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
      if (!rawDescription) {
        rawDescription = "Transaction";
      }

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
  }

  if (rows.length === 0 && setAside.length === 0) {
    throw new Error("QIF statement contained no transaction records");
  }

  return Object.assign([...rows], { rows, setAside });
}

export const qifParser: StatementParser = {
  format: "qif",
  parse(content: string): StatementParseResult {
    return parseQif(content);
  },
};

export const commbankQifParser: StatementParser = {
  format: "commbank_qif",
  parse(content: string): StatementParseResult {
    return parseQif(content);
  },
};
