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
import { commbankCsvParser, parseCommBankCsv } from "./parsers/commbank-csv.ts";
import { commbankOfxParser, parseCommBankOfx } from "./parsers/commbank-ofx.ts";

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
      {
        postedOn: "2024-09-12",
        amountCents: -450,
        description: "COFFEE",
        balanceCents: 149550,
      },
      {
        postedOn: "2024-09-12",
        amountCents: -450,
        description: "COFFEE",
        balanceCents: 149100,
      },
    ];

    const csvContent = generateCommBankCsv(txns, { includeHeader: true });
    const rows = parseCommBankCsv(csvContent);

    expect(rows).toHaveLength(4);
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
    expect(rows[2]?.amountCents).toBe(-450);
    expect(rows[3]?.amountCents).toBe(-450);
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

  it("throws on empty or malformed CSV content", () => {
    expect(() => parseCommBankCsv("")).toThrow();
    expect(() => parseCommBankCsv("invalid date,not-an-amount")).toThrow();
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
      kind: "transaction",
      isPrivate: false,
      currency: "AUD",
      archived: false,
      institutionId: null,
      accountNumber: null,
      bsb: null,
      openingBalanceCents: 0,
      openingDate: "2024-01-01",
      createdAt: now.toString(),
      updatedAt: now.toString(),
    });

    const ctx = {
      viewer: alexViewer,
      clock: { now: () => new Date(now.epochMilliseconds), today: () => "2026-10-20" },
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
});
