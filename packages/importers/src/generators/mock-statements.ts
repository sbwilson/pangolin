/**
 * Statement generators across all v1 formats (AD-15):
 * - CommBank OFX
 * - CommBank CSV
 * - CommBank QIF
 * - ubank CSV
 * - Up CSV
 * - FY2025 multi-bank format
 */

export interface MockTxn {
  /** `YYYY-MM-DD`. */
  readonly postedOn: string;
  /** Signed amount in cents. */
  readonly amountCents: number;
  readonly description: string;
  readonly externalId?: string | null;
  readonly balanceCents?: number | null;
}

export type StatementFormat =
  | "commbank_ofx"
  | "commbank_csv"
  | "commbank_qif"
  | "ubank_csv"
  | "up_csv"
  | "fy2025_multibank_csv";

function centsToDecimal(cents: number): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const formatted = `${dollars}.${remainder.toString().padStart(2, "0")}`;
  return isNegative ? `-${formatted}` : formatted;
}

function toDdmmyyyy(isoDate: string): string {
  const parts = isoDate.split("-");
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function toOfxDate(isoDate: string): string {
  return `${isoDate.replace(/-/g, "")}120000`;
}

export function generateCommBankOfx(
  account: { acctId?: string | undefined },
  txns: readonly MockTxn[],
  options?: { closingBalanceCents?: number | undefined },
): string {
  const acctId = account.acctId ?? "123456789";
  const lastTxn = txns[txns.length - 1];
  const closingBalance =
    options?.closingBalanceCents !== undefined
      ? centsToDecimal(options.closingBalanceCents)
      : lastTxn?.balanceCents !== null && lastTxn?.balanceCents !== undefined
        ? centsToDecimal(lastTxn.balanceCents)
        : "1000.00";

  const stmtTrnBlocks = txns.map((t, idx) => {
    const trnType = t.amountCents >= 0 ? "CREDIT" : "DEBIT";
    const dtPosted = toOfxDate(t.postedOn);
    const trnAmt = centsToDecimal(t.amountCents);
    const fitid =
      t.externalId ?? `${t.postedOn.replace(/-/g, "")}${String(idx + 1).padStart(4, "0")}`;
    return `<STMTTRN>
<TRNTYPE>${trnType}
<DTPOSTED>${dtPosted}
<TRNAMT>${trnAmt}
<FITID>${fitid}
<NAME>${t.description}
</STMTTRN>`;
  });

  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEVERSION:NONE
NEWFILEVERSION:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20261020120000
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>AUD
<BANKACCTFROM>
<BANKID>CommBank
<ACCTID>${acctId}
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240701
<DTEND>20261020
${stmtTrnBlocks.join("\n")}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>${closingBalance}
<DTASOF>20261020
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;
}

export function generateCommBankCsv(
  txns: readonly MockTxn[],
  options?: { includeHeader?: boolean | undefined },
): string {
  const lines: string[] = [];
  if (options?.includeHeader) {
    lines.push("Date,Amount,Description,Balance");
  }
  for (const t of txns) {
    const ddmmyyyy = toDdmmyyyy(t.postedOn);
    const amt = centsToDecimal(t.amountCents);
    const desc = `"${t.description.replace(/"/g, '""')}"`;
    const bal =
      t.balanceCents !== null && t.balanceCents !== undefined
        ? centsToDecimal(t.balanceCents)
        : "0.00";
    lines.push(`${ddmmyyyy},${amt},${desc},${bal}`);
  }
  return lines.join("\n");
}

export function generateCommBankQif(txns: readonly MockTxn[]): string {
  const blocks: string[] = ["!Type:Bank"];
  for (const t of txns) {
    blocks.push(
      `D${toDdmmyyyy(t.postedOn)}\nT${centsToDecimal(t.amountCents)}\nP${t.description}\n^`,
    );
  }
  return blocks.join("\n");
}

export function generateUbankCsv(txns: readonly MockTxn[]): string {
  const lines: string[] = ["Date,Description,Amount,Balance"];
  for (const t of txns) {
    const ddmmyyyy = toDdmmyyyy(t.postedOn);
    const amt = centsToDecimal(t.amountCents);
    const desc = `"${t.description.replace(/"/g, '""')}"`;
    const bal =
      t.balanceCents !== null && t.balanceCents !== undefined
        ? centsToDecimal(t.balanceCents)
        : "0.00";
    lines.push(`${ddmmyyyy},${desc},${amt},${bal}`);
  }
  return lines.join("\n");
}

export function generateUpCsv(txns: readonly MockTxn[]): string {
  const lines: string[] = ["Time,Settled Date,Description,Amount,Status"];
  for (const t of txns) {
    const time = `${t.postedOn}T12:00:00Z`;
    const amt = centsToDecimal(t.amountCents);
    const desc = `"${t.description.replace(/"/g, '""')}"`;
    lines.push(`${time},${t.postedOn},${desc},${amt},SETTLED`);
  }
  return lines.join("\n");
}

export function generateFy2025MultiBankCsv(txns: readonly MockTxn[]): string {
  const lines: string[] = ["Timestamp,Account,Amount,Description,Balance"];
  for (const t of txns) {
    const ts = `${t.postedOn} 12:00:00`;
    const amt = centsToDecimal(t.amountCents);
    const desc = `"${t.description.replace(/"/g, '""')}"`;
    const bal =
      t.balanceCents !== null && t.balanceCents !== undefined
        ? centsToDecimal(t.balanceCents)
        : "0.00";
    lines.push(`${ts},Everyday,${amt},${desc},${bal}`);
  }
  return lines.join("\n");
}

export function generateMockStatement(
  format: StatementFormat,
  txns: readonly MockTxn[],
  options?: {
    acctId?: string | undefined;
    closingBalanceCents?: number | undefined;
    includeHeader?: boolean | undefined;
  },
): string {
  switch (format) {
    case "commbank_ofx":
      return generateCommBankOfx({ acctId: options?.acctId }, txns, {
        closingBalanceCents: options?.closingBalanceCents,
      });
    case "commbank_csv":
      return generateCommBankCsv(txns, { includeHeader: options?.includeHeader });
    case "commbank_qif":
      return generateCommBankQif(txns);
    case "ubank_csv":
      return generateUbankCsv(txns);
    case "up_csv":
      return generateUpCsv(txns);
    case "fy2025_multibank_csv":
      return generateFy2025MultiBankCsv(txns);
    default:
      throw new Error(`Unsupported statement format: ${format}`);
  }
}
