import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createIdGenerator, importStatement, personViewer } from "@pangolin/app";
import { memoryUnitOfWork } from "@pangolin/app/testing/memory-uow";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import {
  generateCommBankCsv,
  generateCommBankOfx,
  generateCommBankQif,
  generateFy2025MultiBankCsv,
  generateMockStatement,
  generateUbankCsv,
  generateUpCsv,
  type MockTxn,
} from "./generators/mock-statements.ts";
import {
  commbankCsvParser,
  commbankOfxParser,
  commbankQifParser,
  createGenericCsvParser,
  fy2025MultiBankCsvParser,
  parseCommBankCsv,
  parseCommBankOfx,
  parseFy2025MultiBankCsv,
  parseGenericCsv,
  parseQif,
  parseUbankCsv,
  parseUpCsv,
  qifParser,
  ubankCsvParser,
  upCsvParser,
} from "./index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures");

describe("CommBank OFX Parser", () => {
  it("parses transactions, balances, and FITIDs from OFX statement", () => {
    const txns: MockTxn[] = [
      {
        postedOn: "2024-09-01",
        amountCents: -4500,
        description: "WOOLWORTHS SYDNEY",
        externalId: "FITID001",
        balanceCents: 100000,
      },
      {
        postedOn: "2024-09-02",
        amountCents: 150000,
        description: "SALARY ACME CORP",
        externalId: "FITID002",
        balanceCents: 250000,
      },
      {
        postedOn: "2024-09-03",
        amountCents: -450,
        description: "CAFE LATTE",
        externalId: "FITID003",
        balanceCents: 249550,
      },
      {
        postedOn: "2024-09-03",
        amountCents: -450,
        description: "CAFE LATTE",
        externalId: "FITID004",
        balanceCents: 249100,
      },
      {
        postedOn: "2024-09-04",
        amountCents: -12000,
        description: "ENERGY AUSTRALIA",
        externalId: "FITID005",
        balanceCents: 237100,
      },
    ];

    const ofxContent = generateCommBankOfx({ acctId: "06200012345678" }, txns, {
      closingBalanceCents: 237100,
    });
    const parsed = parseCommBankOfx(ofxContent);

    expect(parsed.accountId).toBe("06200012345678");
    expect(parsed.closingBalanceCents).toBe(237100);
    expect(parsed.rows).toHaveLength(5);

    expect(parsed.rows[0]).toEqual({
      rowNumber: 1,
      rawLine: expect.stringContaining("<STMTTRN>"),
      postedOn: "2024-09-01",
      amountCents: -4500,
      rawDescription: "WOOLWORTHS SYDNEY",
      externalId: "FITID001",
      balanceCents: null,
    });

    expect(parsed.rows[1]?.amountCents).toBe(150000);
    expect(parsed.rows[1]?.externalId).toBe("FITID002");

    // Identical amounts on same day have distinct FITIDs
    expect(parsed.rows[2]?.postedOn).toBe("2024-09-03");
    expect(parsed.rows[2]?.amountCents).toBe(-450);
    expect(parsed.rows[2]?.externalId).toBe("FITID003");

    expect(parsed.rows[3]?.postedOn).toBe("2024-09-03");
    expect(parsed.rows[3]?.amountCents).toBe(-450);
    expect(parsed.rows[3]?.externalId).toBe("FITID004");
  });

  it("handles XML-style closing tags in OFX", () => {
    const xmlOfx = `<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20240815120000</DTPOSTED>
<TRNAMT>-25.50</TRNAMT>
<FITID>XML001</FITID>
<NAME>BOOKSTORE</NAME>
<MEMO>ONLINE</MEMO>
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

    const parsed = parseCommBankOfx(xmlOfx);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      postedOn: "2024-08-15",
      amountCents: -2550,
      rawDescription: "BOOKSTORE ONLINE",
      externalId: "XML001",
    });
  });

  it("throws on invalid or empty OFX content", () => {
    expect(() => parseCommBankOfx("")).toThrow();
    expect(() => parseCommBankOfx("not an ofx file")).toThrow();
  });
});

describe("CommBank CSV Parser", () => {
  it("parses CommBank CSV statement with header", () => {
    const txns: MockTxn[] = [
      {
        postedOn: "2024-09-10",
        amountCents: -5000,
        description: "GROCERIES",
        balanceCents: 120000,
      },
      {
        postedOn: "2024-09-11",
        amountCents: 30000,
        description: "REFUND",
        balanceCents: 150000,
      },
    ];

    const csvContent = generateCommBankCsv(txns, { includeHeader: true });
    const rows = parseCommBankCsv(csvContent);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowNumber: 2,
      rawLine: '10/09/2024,-50.00,"GROCERIES",1200.00',
      postedOn: "2024-09-10",
      amountCents: -5000,
      rawDescription: "GROCERIES",
      externalId: null,
      balanceCents: 120000,
    });
    expect(rows[1]?.amountCents).toBe(30000);
  });

  it("parses CommBank CSV statement without header", () => {
    const csvContent = '23/08/2024,-45.00,"Woolworths Sydney",1234.56';
    const rows = parseCommBankCsv(csvContent);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      postedOn: "2024-08-23",
      amountCents: -4500,
      rawDescription: "Woolworths Sydney",
      balanceCents: 123456,
    });
  });

  it("handles descriptions containing commas and escaped quotes", () => {
    const csvContent = '23/08/2024,-12.50,"Smith, Jones & ""Co""",500.00';
    const rows = parseCommBankCsv(csvContent);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rawDescription).toBe('Smith, Jones & "Co"');
  });

  it("handles empty CSV and isolates malformed rows into setAside", () => {
    expect(() => parseCommBankCsv("")).toThrow();
    const res = parseCommBankCsv("invalid date,not-an-amount");
    expect(res.rows).toHaveLength(0);
    expect(res.setAside).toHaveLength(1);
    expect(res.setAside[0]?.reason).toMatch(/columns|date/i);
  });
});

describe("ubank CSV Parser", () => {
  it("parses ubank CSV statement format (Date,Description,Amount,Balance)", () => {
    const content = `Date,Description,Amount,Balance
01/09/2024,"WOOLWORTHS SYDNEY",-45.50,1234.50
02/09/2024,"SALARY TRANSFER",2500.00,3734.50`;

    const rows = parseUbankCsv(content);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowNumber: 2,
      rawLine: '01/09/2024,"WOOLWORTHS SYDNEY",-45.50,1234.50',
      postedOn: "2024-09-01",
      amountCents: -4550,
      rawDescription: "WOOLWORTHS SYDNEY",
      externalId: null,
      balanceCents: 123450,
    });
    expect(rows[1]?.amountCents).toBe(250000);
    expect(rows[1]?.balanceCents).toBe(373450);
  });

  it("parses ubank CSV with 2-digit years (DD/MM/YY)", () => {
    const content = `Date,Description,Amount,Balance
15/08/24,"CAFE LATTE",-4.50,500.00`;
    const rows = parseUbankCsv(content);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.postedOn).toBe("2024-08-15");
  });

  it("isolates malformed line or missing columns into setAside", () => {
    const res1 = parseUbankCsv("Date,Description,Amount\n01/09/2024");
    expect(res1.rows).toHaveLength(0);
    expect(res1.setAside).toHaveLength(1);
    expect(res1.setAside[0]?.reason).toMatch(/columns/i);

    const res2 = parseUbankCsv("Date,Description,Amount\nnot-a-date,Desc,50.00");
    expect(res2.rows).toHaveLength(0);
    expect(res2.setAside).toHaveLength(1);
    expect(res2.setAside[0]?.reason).toMatch(/date/i);

    const res3 = parseUbankCsv("Date,Description,Amount\n01/09/2024,,50.00");
    expect(res3.rows).toHaveLength(0);
    expect(res3.setAside).toHaveLength(1);
    expect(res3.setAside[0]?.reason).toMatch(/description/i);
  });
});

describe("Up CSV Parser", () => {
  it("parses settled transactions and skips pending/unsettled rows", () => {
    const content = `Time,Settled Date,Description,Amount,Status
2024-09-01T08:00:00Z,2024-09-01,"COFFEE SHOP",-4.50,SETTLED
2024-09-02T12:00:00Z,,PENDING PURCHASE,-25.00,HELD
2024-09-03T10:00:00Z,2024-09-03,"SALARY UP",1200.00,SETTLED`;

    const rows = parseUpCsv(content);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowNumber: 2,
      rawLine: '2024-09-01T08:00:00Z,2024-09-01,"COFFEE SHOP",-4.50,SETTLED',
      postedOn: "2024-09-01",
      amountCents: -450,
      rawDescription: "COFFEE SHOP",
      externalId: null,
      balanceCents: null,
    });
    expect(rows[1]?.postedOn).toBe("2024-09-03");
    expect(rows[1]?.amountCents).toBe(120000);
  });

  it("throws on empty content and isolates invalid settled date into setAside", () => {
    expect(() => parseUpCsv("")).toThrow();
    const bad = `Time,Settled Date,Description,Amount,Status
2024-09-01T08:00:00Z,invalid-date,"Desc",-10.00,SETTLED`;
    const res = parseUpCsv(bad);
    expect(res.rows).toHaveLength(0);
    expect(res.setAside).toHaveLength(1);
    expect(res.setAside[0]?.reason).toMatch(/date/i);
  });
});

describe("QIF Parser", () => {
  it("parses standard QIF format with D, T, P, M, N fields", () => {
    const content = `!Type:Bank
D01/09/2024
T-35.00
PRESTAURANT
MTable 5
N1001
^
D02/09/2024
T1200.00
PSALARY
N1002
^`;

    const rows = parseQif(content);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowNumber: 1,
      rawLine: expect.stringContaining("D01/09/2024"),
      postedOn: "2024-09-01",
      amountCents: -3500,
      rawDescription: "RESTAURANT Table 5",
      externalId: "1001",
      balanceCents: null,
    });
    expect(rows[1]?.postedOn).toBe("2024-09-02");
    expect(rows[1]?.amountCents).toBe(120000);
    expect(rows[1]?.externalId).toBe("1002");
  });

  it("handles QIF 2-digit years and comma-separated amounts", () => {
    const content = `!Type:Bank
D15/08'24
T-1,234.56
PTAX PAYMENT
^`;
    const rows = parseQif(content);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.postedOn).toBe("2024-08-15");
    expect(rows[0]?.amountCents).toBe(-123456);
  });

  it("handles empty QIF records delimited by ^ without error", () => {
    const content = `!Type:Bank
^
D01/09/2024
T-10.00
PVALID
^
^`;
    const rows = parseQif(content);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rawDescription).toBe("VALID");
  });

  it("throws on missing !Type header and isolates missing date/amount into setAside", () => {
    expect(() => parseQif("D01/09/2024\nT-10.00\n^")).toThrow();
    const res = parseQif("!Type:Bank\nT-10.00\n^");
    expect(res.rows).toHaveLength(0);
    expect(res.setAside).toHaveLength(1);
    expect(res.setAside[0]?.reason).toMatch(/date/i);

    const res2 = parseQif("!Type:Bank\nPOnly Payee No Date Or Amount\n^");
    expect(res2.rows).toHaveLength(0);
    expect(res2.setAside).toHaveLength(1);
    expect(res2.setAside[0]?.reason).toMatch(/date/i);
  });
});

describe("FY2025 MultiBank CSV Parser", () => {
  it("parses Timestamp,Account,Amount,Description,Balance", () => {
    const content = `Timestamp,Account,Amount,Description,Balance
2024-09-01 12:00:00,Everyday,-45.00,"WOOLWORTHS",1000.00
2024-09-02 09:30:00,Everyday,1500.00,"SALARY",2500.00`;

    const rows = parseFy2025MultiBankCsv(content);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowNumber: 2,
      rawLine: '2024-09-01 12:00:00,Everyday,-45.00,"WOOLWORTHS",1000.00',
      postedOn: "2024-09-01",
      amountCents: -4500,
      rawDescription: "WOOLWORTHS",
      externalId: null,
      balanceCents: 100000,
    });
    expect(rows[1]?.postedOn).toBe("2024-09-02");
    expect(rows[1]?.amountCents).toBe(150000);
    expect(rows[1]?.balanceCents).toBe(250000);
  });

  it("isolates invalid timestamp or amount into setAside", () => {
    const bad = `Timestamp,Account,Amount,Description,Balance
bad-timestamp,Everyday,-45.00,"WOOLWORTHS",1000.00`;
    const res = parseFy2025MultiBankCsv(bad);
    expect(res.rows).toHaveLength(0);
    expect(res.setAside).toHaveLength(1);
    expect(res.setAside[0]?.reason).toMatch(/timestamp/i);
  });
});

describe("Generic CSV Parser", () => {
  it("parses CSV with signed amount and header names", () => {
    const content = `Transaction Date,Merchant,Total,Closing Balance,Ref
01/09/2024,"Store A",-55.00,945.00,TX001
02/09/2024,"Deposit B",200.00,1145.00,TX002`;

    const rows = parseGenericCsv(content, {
      date: "Transaction Date",
      dateFormat: "DD/MM/YYYY",
      description: "Merchant",
      amount: "Total",
      balance: "Closing Balance",
      externalId: "Ref",
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.postedOn).toBe("2024-09-01");
    expect(rows[0]?.amountCents).toBe(-5500);
    expect(rows[0]?.rawDescription).toBe("Store A");
    expect(rows[0]?.balanceCents).toBe(94500);
    expect(rows[0]?.externalId).toBe("TX001");
  });

  it("parses CSV with separate Debit and Credit columns handling zero or empty inactive columns", () => {
    const content = `Date,Description,Debit,Credit
2024-09-01,Payment,50.00,0.00
2024-09-02,Salary,0.00,1500.00
2024-09-03,Other,25.00,`;

    const rows = parseGenericCsv(content, {
      date: "Date",
      dateFormat: "YYYY-MM-DD",
      description: "Description",
      debit: "Debit",
      credit: "Credit",
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]?.amountCents).toBe(-5000);
    expect(rows[1]?.amountCents).toBe(150000);
    expect(rows[2]?.amountCents).toBe(-2500);
  });

  it("parses date with MM/DD/YYYY format correctly", () => {
    const content = `Date,Description,Amount
09/01/2024,US Date Format,-50.00`;

    const rows = parseGenericCsv(content, {
      date: "Date",
      dateFormat: "MM/DD/YYYY",
      description: "Description",
      amount: "Amount",
    });

    expect(rows[0]?.postedOn).toBe("2024-09-01");
  });

  it("concatenates description and memo columns", () => {
    const content = `Date,Description,Memo,Amount
2024-09-01,Groceries,Weekly shopping,-85.00`;

    const rows = parseGenericCsv(content, {
      date: "Date",
      description: "Description",
      memo: "Memo",
      amount: "Amount",
    });

    expect(rows[0]?.rawDescription).toBe("Groceries Weekly shopping");
  });

  it("strips leading UTF-8 BOM character from CSV and QIF", () => {
    const bomCsv = `\uFEFFDate,Description,Amount\n01/09/2024,BOM Test,-10.00`;
    const rows = parseGenericCsv(bomCsv, {
      date: "Date",
      description: "Description",
      amount: "Amount",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rawDescription).toBe("BOM Test");

    const bomQif = `\uFEFF!Type:Bank\nD01/09/2024\nT-10.00\nPBOM QIF\n^`;
    const qifRows = parseQif(bomQif);
    expect(qifRows).toHaveLength(1);
    expect(qifRows[0]?.rawDescription).toBe("BOM QIF");
  });

  it("supports inverted sign convention", () => {
    const content = `Date,Description,Amount
2024-09-01,Groceries,50.00
2024-09-02,Salary,-1500.00`;

    const rows = parseGenericCsv(content, {
      date: "Date",
      description: "Description",
      amount: "Amount",
      signConvention: "inverted",
    });

    expect(rows[0]?.amountCents).toBe(-5000);
    expect(rows[1]?.amountCents).toBe(150000);
  });

  it("supports column indexes and custom delimiter without header", () => {
    const content = `01-09-2024;Groceries;-25.00;1000.00;EXT123
02-09-2024;Salary;500.00;1500.00;EXT124`;

    const rows = parseGenericCsv(content, {
      date: 0,
      dateFormat: "DD-MM-YYYY",
      description: 1,
      amount: 2,
      balance: 3,
      externalId: 4,
      hasHeader: false,
      delimiter: ";",
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.postedOn).toBe("2024-09-01");
    expect(rows[0]?.amountCents).toBe(-2500);
    expect(rows[0]?.externalId).toBe("EXT123");
  });

  it("isolates rows when both debit and credit or neither are present in debit/credit mode", () => {
    const both = `Date,Description,Debit,Credit\n2024-09-01,Desc,50.00,50.00`;
    const resBoth = parseGenericCsv(both, {
      date: "Date",
      description: "Description",
      debit: "Debit",
      credit: "Credit",
    });
    expect(resBoth.rows).toHaveLength(0);
    expect(resBoth.setAside).toHaveLength(1);
    expect(resBoth.setAside[0]?.reason).toMatch(/both/i);

    const neither = `Date,Description,Debit,Credit\n2024-09-01,Desc,,`;
    const resNeither = parseGenericCsv(neither, {
      date: "Date",
      description: "Description",
      debit: "Debit",
      credit: "Credit",
    });
    expect(resNeither.rows).toHaveLength(0);
    expect(resNeither.setAside).toHaveLength(1);
    expect(resNeither.setAside[0]?.reason).toMatch(/neither/i);

    const malformedDebit = `Date,Description,Debit,Credit\n2024-09-01,Desc,invalid-debit,50.00`;
    const resMalformedDebit = parseGenericCsv(malformedDebit, {
      date: "Date",
      description: "Description",
      debit: "Debit",
      credit: "Credit",
    });
    expect(resMalformedDebit.rows).toHaveLength(0);
    expect(resMalformedDebit.setAside).toHaveLength(1);
    expect(resMalformedDebit.setAside[0]?.reason).toMatch(/invalid debit amount/i);
  });
});

describe("Committed Anonymised Fixtures", () => {
  it("parses commbank.ofx fixture file", () => {
    const content = readFileSync(join(fixturesDir, "commbank.ofx"), "utf8");
    const parsed = parseCommBankOfx(content);
    expect(parsed.rows.length).toBeGreaterThanOrEqual(4);
    expect(parsed.accountId).toBe("06200012345678");
    expect(parsed.closingBalanceCents).toBe(237550);
  });

  it("parses commbank.csv fixture file", () => {
    const content = readFileSync(join(fixturesDir, "commbank.csv"), "utf8");
    const rows = parseCommBankCsv(content);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.postedOn).toBe("2024-09-01");
    expect(rows[0]?.amountCents).toBe(-4500);
  });

  it("parses commbank.qif fixture file", () => {
    const content = readFileSync(join(fixturesDir, "commbank.qif"), "utf8");
    const rows = parseQif(content);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.postedOn).toBe("2024-09-01");
    expect(rows[0]?.externalId).toBe("1001");
  });

  it("parses ubank.csv fixture file", () => {
    const content = readFileSync(join(fixturesDir, "ubank.csv"), "utf8");
    const rows = parseUbankCsv(content);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.postedOn).toBe("2024-09-01");
    expect(rows[0]?.amountCents).toBe(-4500);
  });

  it("parses up.csv fixture file", () => {
    const content = readFileSync(join(fixturesDir, "up.csv"), "utf8");
    const rows = parseUpCsv(content);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.postedOn).toBe("2024-09-01");
    expect(rows[0]?.amountCents).toBe(-4500);
  });

  it("parses fy2025-multibank.csv fixture file", () => {
    const content = readFileSync(join(fixturesDir, "fy2025-multibank.csv"), "utf8");
    const rows = parseFy2025MultiBankCsv(content);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.postedOn).toBe("2024-09-01");
    expect(rows[0]?.amountCents).toBe(-4500);
  });

  it("parses generic.csv fixture file", () => {
    const content = readFileSync(join(fixturesDir, "generic.csv"), "utf8");
    const rows = parseGenericCsv(content, {
      date: "TxDate",
      description: "Merchant",
      debit: "Debit",
      credit: "Credit",
      balance: "Balance",
      externalId: "Reference",
    });
    expect(rows).toHaveLength(4);
    expect(rows[0]?.postedOn).toBe("2024-09-01");
    expect(rows[0]?.amountCents).toBe(-4500);
    expect(rows[0]?.externalId).toBe("REF-001");
  });
});

describe("Mock Statement Generators", () => {
  const sampleTxns: MockTxn[] = [
    {
      postedOn: "2024-09-01",
      amountCents: -3500,
      description: "RESTAURANT",
      balanceCents: 100000,
    },
    {
      postedOn: "2024-09-02",
      amountCents: 200000,
      description: "PAYMENT RECEIVED",
      balanceCents: 300000,
    },
  ];

  it("generates CommBank QIF", () => {
    const qif = generateCommBankQif(sampleTxns);
    expect(qif).toContain("!Type:Bank");
    expect(qif).toContain("D01/09/2024");
    expect(qif).toContain("T-35.00");
    expect(qif).toContain("PRESTAURANT");
    expect(qif).toContain("^");
  });

  it("generates ubank CSV", () => {
    const csv = generateUbankCsv(sampleTxns);
    expect(csv).toContain("Date,Description,Amount,Balance");
    expect(csv).toContain("01/09/2024");
    expect(csv).toContain('"RESTAURANT"');
    expect(csv).toContain("-35.00");
  });

  it("generates Up CSV", () => {
    const csv = generateUpCsv(sampleTxns);
    expect(csv).toContain("Time,Settled Date,Description,Amount,Status");
    expect(csv).toContain("2024-09-01T12:00:00Z");
    expect(csv).toContain("2024-09-01");
    expect(csv).toContain("SETTLED");
  });

  it("generates FY2025 MultiBank CSV", () => {
    const csv = generateFy2025MultiBankCsv(sampleTxns);
    expect(csv).toContain("Timestamp,Account,Amount,Description,Balance");
    expect(csv).toContain("2024-09-01 12:00:00");
    expect(csv).toContain("Everyday");
    expect(csv).toContain("-35.00");
  });

  it("dispatcher generateMockStatement supports all formats", () => {
    expect(generateMockStatement("commbank_ofx", sampleTxns)).toContain("<OFX>");
    expect(generateMockStatement("commbank_csv", sampleTxns)).toContain("01/09/2024");
    expect(generateMockStatement("commbank_qif", sampleTxns)).toContain("!Type:Bank");
    expect(generateMockStatement("ubank_csv", sampleTxns)).toContain("Date,Description");
    expect(generateMockStatement("up_csv", sampleTxns)).toContain("SETTLED");
    expect(generateMockStatement("fy2025_multibank_csv", sampleTxns)).toContain("Everyday");
  });
});

describe("importers integrated with importStatement", () => {
  const now = Temporal.Instant.from("2026-10-20T12:00:00Z");

  function setup() {
    let ms = 1792400000000;
    const newId = createIdGenerator({
      now: () => ++ms,
      random: () => 0.5,
    });
    const uow = memoryUnitOfWork();

    const alexPersonId = newId<"Person">();
    const alexViewer = personViewer(alexPersonId, now);
    const accountId = newId<"Account">();

    uow.state.people.push({
      id: alexPersonId,
      userId: "user-alex",
      displayName: "Alex",
      colour: "#ff0000",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    });

    uow.state.accounts.push({
      id: accountId,
      name: "Checking",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: "2024-01-01",
      closedOn: null,
      isSavings: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    });

    const ctx = {
      viewer: alexViewer,
      clock: {
        now: () => now,
        today: () => Temporal.PlainDate.from("2026-10-20"),
      },
      newId,
      uow,
    };

    return { ctx, accountId, uow };
  }

  it("imports via commbankOfxParser adapter", () => {
    const { ctx, accountId, uow } = setup();

    const ofxContent = generateCommBankOfx(
      { acctId: "06200012345678" },
      [
        {
          postedOn: "2024-09-01",
          amountCents: -5000,
          description: "TARGET AUSTRALIA",
          externalId: "OFX-FIT-001",
          balanceCents: 100000,
        },
      ],
      { closingBalanceCents: 100000 },
    );

    const res = importStatement(
      ctx,
      {
        accountId,
        format: "commbank_ofx",
        content: ofxContent,
      },
      { parser: commbankOfxParser },
    );

    expect(res.rowCount).toBe(1);
    expect(res.newCount).toBe(1);
    expect(res.dupCount).toBe(0);
    expect(uow.state.transactions).toHaveLength(1);
    expect(uow.state.transactions[0]?.externalId).toBe("OFX-FIT-001");
  });

  it("imports via commbankCsvParser adapter", () => {
    const { ctx, accountId, uow } = setup();

    const csvContent = generateCommBankCsv(
      [
        {
          postedOn: "2024-09-01",
          amountCents: -1250,
          description: "OFFICEWORKS",
          balanceCents: 50000,
        },
      ],
      { includeHeader: true },
    );

    const res = importStatement(
      ctx,
      {
        accountId,
        format: "commbank_csv",
        content: csvContent,
      },
      { parser: commbankCsvParser },
    );

    expect(res.rowCount).toBe(1);
    expect(res.newCount).toBe(1);
    expect(res.dupCount).toBe(0);
    expect(uow.state.transactions).toHaveLength(1);
    expect(uow.state.transactions[0]?.amountCents).toBe(-1250);
  });

  it("imports via ubankCsvParser adapter", () => {
    const { ctx, accountId, uow } = setup();
    const csvContent = generateUbankCsv([
      {
        postedOn: "2024-09-01",
        amountCents: -3500,
        description: "UBANK DINER",
        balanceCents: 100000,
      },
    ]);

    const res = importStatement(
      ctx,
      {
        accountId,
        format: "ubank_csv",
        content: csvContent,
      },
      { parser: ubankCsvParser },
    );

    expect(res.rowCount).toBe(1);
    expect(res.newCount).toBe(1);
    expect(uow.state.transactions).toHaveLength(1);
    expect(uow.state.transactions[0]?.amountCents).toBe(-3500);
  });

  it("imports via upCsvParser adapter", () => {
    const { ctx, accountId, uow } = setup();
    const csvContent = generateUpCsv([
      {
        postedOn: "2024-09-01",
        amountCents: -850,
        description: "UP BURGER",
      },
    ]);

    const res = importStatement(
      ctx,
      {
        accountId,
        format: "up_csv",
        content: csvContent,
      },
      { parser: upCsvParser },
    );

    expect(res.rowCount).toBe(1);
    expect(res.newCount).toBe(1);
    expect(uow.state.transactions).toHaveLength(1);
    expect(uow.state.transactions[0]?.amountCents).toBe(-850);
  });

  it("imports via commbankQifParser / qifParser adapter", () => {
    const { ctx, accountId, uow } = setup();
    const qifContent = generateCommBankQif([
      {
        postedOn: "2024-09-01",
        amountCents: -6000,
        description: "QIF FUEL",
      },
    ]);

    expect(qifParser.format).toBe("qif");
    expect(commbankQifParser.format).toBe("commbank_qif");

    const res = importStatement(
      ctx,
      {
        accountId,
        format: "commbank_qif",
        content: qifContent,
      },
      { parser: commbankQifParser },
    );

    expect(res.rowCount).toBe(1);
    expect(res.newCount).toBe(1);
    expect(uow.state.transactions).toHaveLength(1);
    expect(uow.state.transactions[0]?.amountCents).toBe(-6000);
  });

  it("imports via qifParser adapter with format qif", () => {
    const { ctx, accountId, uow } = setup();
    const qifContent = generateCommBankQif([
      {
        postedOn: "2024-09-01",
        amountCents: -7500,
        description: "QIF REPAIRS",
      },
    ]);

    const res = importStatement(
      ctx,
      {
        accountId,
        format: "qif",
        content: qifContent,
      },
      { parser: qifParser },
    );

    expect(res.rowCount).toBe(1);
    expect(res.newCount).toBe(1);
    expect(uow.state.transactions).toHaveLength(1);
    expect(uow.state.transactions[0]?.amountCents).toBe(-7500);
  });

  it("imports via fy2025MultiBankCsvParser adapter", () => {
    const { ctx, accountId, uow } = setup();
    const csvContent = generateFy2025MultiBankCsv([
      {
        postedOn: "2024-09-01",
        amountCents: 450000,
        description: "FY2025 SALARY",
        balanceCents: 500000,
      },
    ]);

    const res = importStatement(
      ctx,
      {
        accountId,
        format: "fy2025_multibank_csv",
        content: csvContent,
      },
      { parser: fy2025MultiBankCsvParser },
    );

    expect(res.rowCount).toBe(1);
    expect(res.newCount).toBe(1);
    expect(uow.state.transactions).toHaveLength(1);
    expect(uow.state.transactions[0]?.amountCents).toBe(450000);
  });

  it("imports via createGenericCsvParser adapter", () => {
    const { ctx, accountId, uow } = setup();
    const csvContent = `Date,Merchant,Amount
01/09/2024,Generic Merchant,-15.00`;

    const genericParser = createGenericCsvParser({
      date: "Date",
      description: "Merchant",
      amount: "Amount",
    });

    const res = importStatement(
      ctx,
      {
        accountId,
        format: "generic_csv",
        content: csvContent,
      },
      { parser: genericParser },
    );

    expect(res.rowCount).toBe(1);
    expect(res.newCount).toBe(1);
    expect(uow.state.transactions).toHaveLength(1);
    expect(uow.state.transactions[0]?.amountCents).toBe(-1500);
  });

  describe("Partial Parsing across Statement Formats", () => {
    it("isolates invalid CSV rows in CommBank CSV while parsing valid rows", () => {
      const content = `Date,Amount,Description,Balance
01/09/2024,-10.00,Coffee,100.00
bad-date,-20.00,Lunch,80.00
03/09/2024,not-an-amount,Dinner,60.00
04/09/2024,50.00,Refund,110.00`;

      const result = parseCommBankCsv(content);
      expect(result.rows).toHaveLength(2);
      expect(result.setAside).toHaveLength(2);
      expect(result.rows[0]?.postedOn).toBe("2024-09-01");
      expect(result.rows[1]?.postedOn).toBe("2024-09-04");
      expect(result.setAside[0]?.rowNumber).toBe(3);
      expect(result.setAside[0]?.reason).toMatch(/date/i);
      expect(result.setAside[1]?.rowNumber).toBe(4);
      expect(result.setAside[1]?.reason).toMatch(/amount/i);
    });

    it("isolates invalid STMTTRN in CommBank OFX while parsing valid transactions", () => {
      const ofxContent = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240901120000
<TRNAMT>-25.00
<FITID>VALID1
<NAME>Supermarket
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<TRNAMT>-10.00
<FITID>BAD1
<NAME>Missing Date
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240902120000
<TRNAMT>100.00
<FITID>VALID2
<NAME>Salary
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

      const result = parseCommBankOfx(ofxContent);
      expect(result.rows).toHaveLength(2);
      expect(result.setAside).toHaveLength(1);
      expect(result.rows[0]?.externalId).toBe("VALID1");
      expect(result.rows[1]?.externalId).toBe("VALID2");
      expect(result.setAside[0]?.rowNumber).toBe(2);
      expect(result.setAside[0]?.reason).toMatch(/DTPOSTED/i);
    });

    it("isolates invalid QIF records while parsing valid records", () => {
      const qifContent = `!Type:Bank
D01/09/2024
T-15.00
PCoffee
^
D02/09/2024
Tbad-amount
PLunch
^
D03/09/2024
T50.00
PRefund
^`;

      const result = parseQif(qifContent);
      expect(result.rows).toHaveLength(2);
      expect(result.setAside).toHaveLength(1);
      expect(result.rows[0]?.rawDescription).toBe("Coffee");
      expect(result.rows[1]?.rawDescription).toBe("Refund");
      expect(result.setAside[0]?.rowNumber).toBe(2);
      expect(result.setAside[0]?.reason).toMatch(/amount/i);
    });
  });
});
