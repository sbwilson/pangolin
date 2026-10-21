import { toCents } from "@pangolin/shared";
import type {
  ParsedStatementRow,
  SetAsideStatementRow,
  StatementParseResult,
} from "../../ports/statement-parser.ts";
import { extractTag } from "./shared.ts";

export function parseBuiltinCommBankOfx(content: string): StatementParseResult {
  const cleanContent = content.replace(/^\uFEFF/, "");
  if (
    !cleanContent.includes("<OFX>") &&
    !cleanContent.includes("<ofx>") &&
    !cleanContent.includes("OFXHEADER")
  ) {
    throw new Error("Invalid OFX: missing OFX header or root element");
  }

  const rows: ParsedStatementRow[] = [];
  const setAside: SetAsideStatementRow[] = [];
  const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let rowNumber = 1;

  for (const match of cleanContent.matchAll(trnRegex)) {
    const block = match[1] ?? "";
    const rawLine = match[0].trim();

    try {
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
      });
    } catch (err) {
      setAside.push({
        rowNumber,
        rawLine,
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    rowNumber += 1;
  }

  if (rows.length === 0 && setAside.length === 0) {
    throw new Error("OFX statement contained no transaction rows");
  }

  return { rows, setAside };
}
