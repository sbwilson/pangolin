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

/** One generated monthly statement: its month (`YYYY-MM`), rows with running balances, and CSV. */
export interface MonthlyStatement {
  readonly month: string;
  readonly txns: readonly MockTxn[];
  /** CommBank CSV text (`Date,Amount,Description,Balance`), oldest row first. */
  readonly csv: string;
}

/**
 * Twelve contiguous monthly statements with a running balance that carries from one month to the
 * next, for testing the M1 gate on generated data. Each month has a pay on the 1st, a rent
 * payment on the 2nd and a shop on the 15th and the last day, so the files abut with no day
 * between them. Amounts and descriptions are synthetic.
 */
export function generateTwelveMonthStatements(options?: {
  /** First month, `YYYY-MM`. Defaults to `2024-07` (the start of FY2025). */
  readonly startMonth?: string | undefined;
  /** Balance before the first row, in cents. */
  readonly openingBalanceCents?: number | undefined;
}): MonthlyStatement[] {
  const [startYear, startMonth] = (options?.startMonth ?? "2024-07").split("-").map(Number) as [
    number,
    number,
  ];
  let balance = options?.openingBalanceCents ?? 100_000;
  const statements: MonthlyStatement[] = [];
  for (let i = 0; i < 12; i++) {
    const index = startMonth - 1 + i;
    const year = startYear + Math.floor(index / 12);
    const mm = String((index % 12) + 1).padStart(2, "0");
    const lastDay = new Date(Date.UTC(year, (index % 12) + 1, 0)).getUTCDate();
    const day = (d: number) => `${year}-${mm}-${String(d).padStart(2, "0")}`;
    const plan: readonly [number, number, string][] = [
      [1, 450_000, "SALARY ACME PTY LTD"],
      [2, -180_000, "RENT PAYMENT"],
      [15, -(12_345 + i * 100), "WOOLWORTHS 1234 SYDNEY"],
      [lastDay, -(6_789 + i * 50), "COLES 5678 SYDNEY"],
    ];
    const txns: MockTxn[] = plan.map(([d, amountCents, description]) => {
      balance += amountCents;
      return { postedOn: day(d), amountCents, description, balanceCents: balance };
    });
    statements.push({ month: `${year}-${mm}`, txns, csv: generateCommBankCsv(txns) });
  }
  return statements;
}

export interface MockPdfStatementRow {
  readonly postedOn: string;
  readonly description: string;
  readonly amountCents: number;
  readonly runningBalanceCents?: number | null;
  readonly pageNumber?: number;
}

export interface GenerateMockPdfStatementOptions {
  readonly bankName?: string;
  readonly accountNumberLast4?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly openingBalanceCents?: number;
  readonly closingBalanceCents?: number;
  readonly rows?: readonly MockPdfStatementRow[];
  readonly scannedWithoutText?: boolean;
}

function formatPdfCurrency(cents: number): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const formatted = `${dollars}.${remainder.toString().padStart(2, "0")}`;
  return isNegative ? `-$${formatted}` : `$${formatted}`;
}

/**
 * Generates a valid synthetic PDF binary buffer with text streams and verifiable totals (AD-6, AD-15).
 * Supports multi-page statements and simulated scanned statements lacking extractable text.
 */
export function generateMockPdfStatement(options?: GenerateMockPdfStatementOptions): Buffer {
  const bankName = options?.bankName ?? "Commonwealth Bank";
  const accountNumberLast4 = options?.accountNumberLast4 ?? "1234";
  const openingBalanceCents = options?.openingBalanceCents ?? 100_000;
  const rows: readonly MockPdfStatementRow[] = options?.rows ?? [
    {
      postedOn: "2024-09-02",
      description: "SALARY PAYMENT",
      amountCents: 5_000,
      runningBalanceCents: openingBalanceCents + 5_000,
      pageNumber: 1,
    },
    {
      postedOn: "2024-09-05",
      description: "COFFEE SHOP",
      amountCents: -2_000,
      runningBalanceCents: openingBalanceCents + 3_000,
      pageNumber: 1,
    },
  ];

  const sumAmounts = rows.reduce((acc, r) => acc + r.amountCents, 0);
  const closingBalanceCents =
    options?.closingBalanceCents !== undefined
      ? options.closingBalanceCents
      : openingBalanceCents + sumAmounts;

  const dates = rows.map((r) => r.postedOn).sort();
  const startDate = options?.startDate ?? dates[0] ?? "2024-09-01";
  const endDate = options?.endDate ?? dates[dates.length - 1] ?? "2024-09-30";

  // Group rows by page
  const pageMap = new Map<number, MockPdfStatementRow[]>();
  for (const row of rows) {
    const pageNum = row.pageNumber ?? 1;
    const existing = pageMap.get(pageNum);
    if (existing) {
      existing.push(row);
    } else {
      pageMap.set(pageNum, [row]);
    }
  }

  const pageNumbers = Array.from(pageMap.keys()).sort((a, b) => a - b);
  if (pageNumbers.length === 0) {
    pageNumbers.push(1);
    pageMap.set(1, []);
  }

  const totalPages = pageNumbers.length;

  const pageTexts: string[][] = pageNumbers.map((pageNum) => {
    if (options?.scannedWithoutText) {
      return [];
    }
    const pageRows = pageMap.get(pageNum) ?? [];
    const lines: string[] = [
      `${bankName} Statement`,
      `Account Number: **** **** **** ${accountNumberLast4}`,
      `Statement Period: ${startDate} to ${endDate}`,
      `Opening Balance: ${formatPdfCurrency(openingBalanceCents)}`,
      `Closing Balance: ${formatPdfCurrency(closingBalanceCents)}`,
      `Page ${pageNum} of ${totalPages}`,
      "Transactions:",
      "Date | Description | Amount | Balance",
    ];

    for (const r of pageRows) {
      const balStr =
        r.runningBalanceCents !== null && r.runningBalanceCents !== undefined
          ? ` Balance: ${formatPdfCurrency(r.runningBalanceCents)}`
          : "";
      lines.push(`${r.postedOn} ${r.description} ${formatPdfCurrency(r.amountCents)}${balStr}`);
    }

    return lines;
  });

  // Construct PDF structure
  const objects: { id: number; body: string }[] = [];
  let currentId = 1;
  const catalogId = currentId++;
  const pagesId = currentId++;
  const fontId = currentId++;

  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (let i = 0; i < totalPages; i++) {
    pageIds.push(currentId++);
    contentIds.push(currentId++);
  }

  objects.push({ id: catalogId, body: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` });
  objects.push({
    id: pagesId,
    body: `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${totalPages} >>`,
  });
  objects.push({ id: fontId, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" });

  for (let i = 0; i < totalPages; i++) {
    const pId = pageIds[i]!;
    const cId = contentIds[i]!;
    objects.push({
      id: pId,
      body: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cId} 0 R >>`,
    });

    const lines = pageTexts[i]!;
    let stream = "";
    if (lines.length > 0) {
      stream = "BT\n/F1 10 Tf\n50 740 Td\n";
      for (const rawLine of lines) {
        const line = rawLine.replace(/[()\\\r\n]/g, " ");
        stream += `(${line}) Tj\n0 -16 Td\n`;
      }
      stream += "ET\n";
    } else {
      // Scanned page: graphical stroke/fill without text
      stream = "10 10 100 100 re f\n";
    }

    objects.push({
      id: cId,
      body: `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    });
  }

  objects.sort((a, b) => a.id - b.id);
  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets[obj.id] = Buffer.byteLength(output);
    output += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(output);
}
