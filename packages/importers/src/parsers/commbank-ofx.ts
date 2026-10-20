import type { ParsedStatementRow, StatementParser } from "@pangolin/app";
import { toCents } from "@pangolin/shared";

function extractTag(block: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}>([^<\\r\\n]+)(?:<\\/${tag}>)?`, "i");
  const match = regex.exec(block);
  return match ? match[1]?.trim() : undefined;
}

export interface CommBankOfxResult {
  readonly accountId?: string | undefined;
  readonly closingBalanceCents?: number | undefined;
  readonly rows: readonly ParsedStatementRow[];
}

/**
 * Parses a CommBank OFX 1.02/2.x statement into structured transaction records.
 */
export function parseCommBankOfx(content: string): CommBankOfxResult {
  if (!content || typeof content !== "string") {
    throw new Error("OFX content is empty or not a string");
  }

  const cleanContent = content.replace(/^\uFEFF/, "");

  // Verify it contains basic OFX tags
  if (
    !cleanContent.includes("<OFX>") &&
    !cleanContent.includes("<ofx>") &&
    !cleanContent.includes("OFXHEADER")
  ) {
    throw new Error("Invalid OFX: missing OFX header or root element");
  }

  const acctId = extractTag(cleanContent, "ACCTID");

  const ledgerBalMatch = /<LEDGERBAL>([\s\S]*?)<\/LEDGERBAL>/i.exec(cleanContent);
  let closingBalanceCents: number | undefined;
  if (ledgerBalMatch?.[1]) {
    const balAmtStr = extractTag(ledgerBalMatch[1], "BALAMT");
    if (balAmtStr !== undefined) {
      closingBalanceCents = toCents(balAmtStr);
    }
  }

  const rows: ParsedStatementRow[] = [];
  const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let rowNumber = 1;

  for (const match of cleanContent.matchAll(trnRegex)) {
    const block = match[1] ?? "";
    const rawLine = match[0].trim();

    const dtPostedRaw = extractTag(block, "DTPOSTED");
    if (!dtPostedRaw) {
      throw new Error(`STMTTRN row ${rowNumber} missing DTPOSTED`);
    }

    const dateMatch = /^(\d{4})(\d{2})(\d{2})/.exec(dtPostedRaw);
    if (!dateMatch?.[1] || !dateMatch[2] || !dateMatch[3]) {
      throw new Error(`STMTTRN row ${rowNumber} has invalid DTPOSTED: ${dtPostedRaw}`);
    }
    const postedOn = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

    const trnamtRaw = extractTag(block, "TRNAMT");
    if (!trnamtRaw) {
      throw new Error(`STMTTRN row ${rowNumber} missing TRNAMT`);
    }
    const amountCents = toCents(trnamtRaw);

    const fitid = extractTag(block, "FITID") ?? null;
    const name = extractTag(block, "NAME") ?? "";
    const memo = extractTag(block, "MEMO") ?? "";

    let rawDescription = name;
    if (memo && memo !== name) {
      rawDescription = name ? `${name} ${memo}` : memo;
    }

    rows.push({
      rowNumber,
      rawLine,
      postedOn,
      amountCents,
      rawDescription,
      externalId: fitid,
      balanceCents: null,
    });

    rowNumber += 1;
  }

  if (rows.length === 0) {
    throw new Error("No transactions found in OFX statement");
  }

  return {
    accountId: acctId,
    closingBalanceCents,
    rows,
  };
}

export const commbankOfxParser: StatementParser = {
  format: "commbank_ofx",
  parse(content: string): readonly ParsedStatementRow[] {
    return parseCommBankOfx(content).rows;
  },
};
