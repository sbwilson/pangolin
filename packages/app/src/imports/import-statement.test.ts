import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeFingerprint } from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import { importStatement } from "./import-statement.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../../importers/fixtures");

const now = Temporal.Instant.from("2026-10-20T12:00:00.000Z");
const clock = manualClock("2026-10-20T12:00:00.000Z");

function setup() {
  let ms = 1792400000000;
  const newId = createIdGenerator({
    now: () => ++ms,
    random: () => 0.5,
  });
  const uow = memoryUnitOfWork();

  const alexPersonId = newId<"Person">();
  const samPersonId = newId<"Person">();

  const alexViewer: Viewer = {
    kind: "person",
    personId: alexPersonId,
    authAt: now,
  };

  const sharedAccountId = newId<"Account">();
  const privateAccountId = newId<"Account">();

  uow.state.people.push(
    {
      id: alexPersonId,
      userId: "user-alex",
      displayName: "Alex",
      colour: "#ff0000",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
    {
      id: samPersonId,
      userId: "user-sam",
      displayName: "Sam",
      colour: "#0000ff",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
  );

  // Shared account owned by both
  uow.state.accounts.push({
    id: sharedAccountId,
    name: "Joint Everyday",
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
  uow.state.accountOwners.push(
    {
      accountId: sharedAccountId,
      personId: alexPersonId,
      shareBp: 5000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
    {
      accountId: sharedAccountId,
      personId: samPersonId,
      shareBp: 5000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
  );

  // Private account owned only by Alex
  uow.state.accounts.push({
    id: privateAccountId,
    name: "Alex Spending",
    type: "transaction",
    currency: "AUD",
    isPrivate: true,
    institutionId: null,
    openedOn: "2024-01-01",
    closedOn: null,
    isSavings: false,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });
  uow.state.accountOwners.push({
    accountId: privateAccountId,
    personId: alexPersonId,
    shareBp: 10000,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });

  const ctx = {
    viewer: alexViewer,
    clock,
    newId,
    uow,
  };

  return { ctx, alexViewer, sharedAccountId, privateAccountId, alexPersonId, uow };
}

describe("importStatement use case", () => {
  it("imports valid CommBank OFX with 5 transactions into shared account", () => {
    const { ctx, sharedAccountId, uow } = setup();

    const sampleOfx = `<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</STATUS><DTSERVER>20240920</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240901120000
<TRNAMT>-45.00
<FITID>OFX001
<NAME>WOOLWORTHS
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240902120000
<TRNAMT>2500.00
<FITID>OFX002
<NAME>SALARY
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240903120000
<TRNAMT>-4.50
<FITID>OFX003
<NAME>CAFE LATTE
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240904120000
<TRNAMT>-120.00
<FITID>OFX004
<NAME>ENERGY AUSTRALIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240905120000
<TRNAMT>-15.00
<FITID>OFX005
<NAME>PHARMACY
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>3500.00</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

    const result = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_ofx",
      content: sampleOfx,
    });

    expect(result.status).toBe("committed");
    expect(result.rowCount).toBe(5);
    expect(result.newCount).toBe(5);
    expect(result.dupCount).toBe(0);
    expect(result.transactionIds).toHaveLength(5);

    // Verify 5 transactions and splits created in ledger
    expect(uow.state.transactions).toHaveLength(5);
    expect(uow.state.splits).toHaveLength(5);

    // Shared account splits must have beneficiary = "shared"
    for (const split of uow.state.splits) {
      expect(split.beneficiary).toBe("shared");
    }

    // Verify import_batch record
    const batch = uow.state.importBatches.find((b) => b.id === result.batchId);
    expect(batch).toBeDefined();
    expect(batch?.newCount).toBe(5);
    expect(batch?.dupCount).toBe(0);
    expect(batch?.status).toBe("committed");

    // Verify import_rows staged and committed
    const rows = uow.state.importRows.filter((r) => r.batchId === result.batchId);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.status).toBe("committed");
    }
  });

  it("sets split beneficiary to account owner on private accounts", () => {
    const { ctx, privateAccountId, alexPersonId, uow } = setup();

    const sampleCsv = `Date,Amount,Description,Balance
01/09/2024,-45.00,"COFFEE",500.00`;

    const result = importStatement(ctx, {
      accountId: privateAccountId,
      format: "commbank_csv",
      content: sampleCsv,
    });

    expect(result.newCount).toBe(1);
    expect(uow.state.splits).toHaveLength(1);
    expect(uow.state.splits[0]?.beneficiary).toBe(alexPersonId);
  });

  it("re-importing identical file is strictly idempotent", () => {
    const { ctx, sharedAccountId, uow } = setup();

    const sampleCsv = `Date,Amount,Description,Balance
01/09/2024,-50.00,"SUPERMARKET",1000.00
02/09/2024,-12.00,"BOOKSTORE",988.00`;

    const first = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_csv",
      content: sampleCsv,
    });
    expect(first.newCount).toBe(2);
    expect(first.dupCount).toBe(0);
    expect(uow.state.transactions).toHaveLength(2);

    // Second import of identical file
    const second = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_csv",
      content: sampleCsv,
    });
    expect(second.batchId).toBe(first.batchId);
    expect(second.newCount).toBe(0);
    expect(second.dupCount).toBe(2);
    // 0 new transactions created
    expect(uow.state.transactions).toHaveLength(2);
  });

  it("handles overlapping date range with partial duplicate skip", () => {
    const { ctx, sharedAccountId, uow } = setup();

    const file1 = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240901120000</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>FIT001</FITID><NAME>LINE 1</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240902120000</DTPOSTED><TRNAMT>-20.00</TRNAMT><FITID>FIT002</FITID><NAME>LINE 2</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240903120000</DTPOSTED><TRNAMT>-30.00</TRNAMT><FITID>FIT003</FITID><NAME>LINE 3</NAME></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

    const file2 = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240901120000</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>FIT001</FITID><NAME>LINE 1</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240902120000</DTPOSTED><TRNAMT>-20.00</TRNAMT><FITID>FIT002</FITID><NAME>LINE 2</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240903120000</DTPOSTED><TRNAMT>-30.00</TRNAMT><FITID>FIT003</FITID><NAME>LINE 3</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240904120000</DTPOSTED><TRNAMT>-40.00</TRNAMT><FITID>FIT004</FITID><NAME>LINE 4</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240905120000</DTPOSTED><TRNAMT>-50.00</TRNAMT><FITID>FIT005</FITID><NAME>LINE 5</NAME></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

    const res1 = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_ofx",
      content: file1,
    });
    expect(res1.newCount).toBe(3);
    expect(res1.dupCount).toBe(0);

    const res2 = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_ofx",
      content: file2,
    });
    expect(res2.newCount).toBe(2);
    expect(res2.dupCount).toBe(3);
    expect(uow.state.transactions).toHaveLength(5);

    const b2Rows = uow.state.importRows.filter((r) => r.batchId === res2.batchId);
    expect(b2Rows).toHaveLength(5);
    const discarded = b2Rows.filter((r) => r.status === "discarded");
    expect(discarded).toHaveLength(3);
    for (const d of discarded) {
      expect(d.reason).toBe("duplicate");
    }
    const committed = b2Rows.filter((r) => r.status === "committed");
    expect(committed).toHaveLength(2);
  });

  it("imports an identical same-day transaction into an account that already contains that transaction with newCount: 1", () => {
    const { ctx, sharedAccountId, uow } = setup();

    const file1 = `Date,Amount,Description,Balance
01/09/2024,-15.00,"WOOLWORTHS",100.00`;

    const res1 = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_csv",
      content: file1,
    });
    expect(res1.newCount).toBe(1);
    expect(res1.dupCount).toBe(0);
    expect(uow.state.transactions).toHaveLength(1);

    const file2 = `Date,Amount,Description,Balance
01/09/2024,-15.00,"WOOLWORTHS",85.00`;

    const res2 = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_csv",
      content: file2,
    });
    expect(res2.newCount).toBe(1);
    expect(res2.dupCount).toBe(0);
    expect(uow.state.transactions).toHaveLength(2);
    expect(uow.state.transactions[0]?.fingerprint).not.toBe(uow.state.transactions[1]?.fingerprint);
  });

  it("keeps two identical same-day transactions distinct by occurrence index", () => {
    const { ctx, sharedAccountId, uow } = setup();

    const file = `Date,Amount,Description,Balance
01/09/2024,-4.50,"CAFE SYDNEY",500.00
01/09/2024,-4.50,"CAFE SYDNEY",495.50`;

    const res = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_csv",
      content: file,
    });

    expect(res.newCount).toBe(2);
    expect(res.dupCount).toBe(0);
    expect(uow.state.transactions).toHaveLength(2);

    const tx1 = uow.state.transactions[0];
    const tx2 = uow.state.transactions[1];
    expect(tx1).toBeDefined();
    expect(tx2).toBeDefined();
    if (!tx1 || !tx2) throw new Error("Transactions missing");

    expect(tx1.postedOn).toBe("2024-09-01");
    expect(tx2.postedOn).toBe("2024-09-01");
    expect(tx1.amountCents).toBe(-450);
    expect(tx2.amountCents).toBe(-450);

    // Fingerprints must be distinct due to occurrence indices 0 and 1
    expect(tx1.fingerprint).not.toBe(tx2.fingerprint);
  });

  it("skips re-importing a transaction that was soft-deleted in the ledger", () => {
    const { ctx, sharedAccountId, uow, alexViewer } = setup();

    const file1 = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240901120000</DTPOSTED><TRNAMT>-50.00</TRNAMT><FITID>FIT-GYM-001</FITID><NAME>GYM MEMBERSHIP</NAME></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

    const res1 = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_ofx",
      content: file1,
    });
    expect(res1.newCount).toBe(1);
    expect(uow.state.transactions).toHaveLength(1);

    const txnId = res1.transactionIds[0];
    expect(txnId).toBeDefined();
    if (!txnId) throw new Error("Transaction ID missing");

    // Soft delete the transaction
    uow.transaction((tx) => {
      tx.transactions.softDelete(alexViewer, txnId, now.toString());
    });

    // Re-import a new file that contains the deleted transaction and a new transaction
    const file2 = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240901120000</DTPOSTED><TRNAMT>-50.00</TRNAMT><FITID>FIT-GYM-001</FITID><NAME>GYM MEMBERSHIP</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240902120000</DTPOSTED><TRNAMT>-15.00</TRNAMT><FITID>FIT-LUNCH-002</FITID><NAME>LUNCH</NAME></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

    const res2 = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_ofx",
      content: file2,
    });

    // GYM MEMBERSHIP should be recognized as duplicate (even though soft deleted) and skipped
    expect(res2.newCount).toBe(1);
    expect(res2.dupCount).toBe(1);
    // Total transactions in state: 1 soft-deleted + 1 new = 2
    expect(uow.state.transactions).toHaveLength(2);
  });

  it("normalises CommBank descriptions by stripping VISA DEBIT noise", () => {
    const { ctx, sharedAccountId, uow } = setup();

    const file = `Date,Amount,Description,Balance
01/09/2024,-4.50,"VISA DEBIT PURCHASE CARD 1234 CAFE SYDNEY",500.00
01/09/2024,-4.50,"PENDING - VISA DEBIT PURCHASE CARD 1234 CAFE SYDNEY",495.50`;

    const res = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_csv",
      content: file,
    });
    expect(res.newCount).toBe(2);
    expect(res.dupCount).toBe(0);

    // Both transactions have normalised description "CAFE SYDNEY" and distinct occurrence indices
    const tx1 = uow.state.transactions[0];
    const tx2 = uow.state.transactions[1];
    expect(tx1).toBeDefined();
    expect(tx2).toBeDefined();
    expect(tx1?.fingerprint).toBe(
      computeFingerprint({
        accountId: sharedAccountId,
        postedOn: "2024-09-01",
        amountCents: -450,
        normalisedDescription: "CAFE SYDNEY",
        occurrence: 0,
      }),
    );
    expect(tx2?.fingerprint).toBe(
      computeFingerprint({
        accountId: sharedAccountId,
        postedOn: "2024-09-01",
        amountCents: -450,
        normalisedDescription: "CAFE SYDNEY",
        occurrence: 1,
      }),
    );
  });

  it("rejects with 404 NotFound if account does not exist", () => {
    const { ctx } = setup();

    expect(() =>
      importStatement(ctx, {
        accountId: "01J9NONEXISTENTACCOUNT0000" as Id<"Account">,
        format: "commbank_csv",
        content: `Date,Amount,Description,Balance\n01/09/2024,-10.00,"TEST",100.00`,
      }),
    ).toThrowError(AppError);

    try {
      importStatement(ctx, {
        accountId: "01J9NONEXISTENTACCOUNT0000" as Id<"Account">,
        format: "commbank_csv",
        content: `Date,Amount,Description,Balance\n01/09/2024,-10.00,"TEST",100.00`,
      });
    } catch (err) {
      expect((err as AppError).code).toBe("NotFound");
    }
  });

  it("rejects with 400 Validation if statement content is unparseable", () => {
    const { ctx, sharedAccountId } = setup();

    expect(() =>
      importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: "not a valid csv statement at all",
      }),
    ).toThrowError(AppError);

    try {
      importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: "not a valid csv statement at all",
      });
    } catch (err) {
      expect((err as AppError).code).toBe("Validation");
    }
  });

  describe("All format fixtures and re-import idempotency", () => {
    it("imports and re-imports commbank.ofx fixture with zero duplicates", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = readFileSync(join(fixturesDir, "commbank.ofx"), "utf8");

      const res1 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_ofx",
        content,
      });

      expect(res1.rowCount).toBe(4);
      expect(res1.newCount).toBe(4);
      expect(res1.dupCount).toBe(0);
      expect(uow.state.transactions).toHaveLength(4);
      expect(uow.state.splits).toHaveLength(4);

      // Re-importing identical file
      const res2 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_ofx",
        content,
      });

      expect(res2.rowCount).toBe(4);
      expect(res2.newCount).toBe(0);
      expect(res2.dupCount).toBe(4);
      expect(uow.state.transactions).toHaveLength(4);
    });

    it("imports and re-imports commbank.csv fixture with zero duplicates", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = readFileSync(join(fixturesDir, "commbank.csv"), "utf8");

      const res1 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content,
      });

      expect(res1.rowCount).toBe(4);
      expect(res1.newCount).toBe(4);
      expect(res1.dupCount).toBe(0);
      expect(uow.state.transactions).toHaveLength(4);

      const res2 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content,
      });

      expect(res2.newCount).toBe(0);
      expect(res2.dupCount).toBe(4);
      expect(uow.state.transactions).toHaveLength(4);
    });

    it("imports and re-imports commbank.qif fixture with zero duplicates", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = readFileSync(join(fixturesDir, "commbank.qif"), "utf8");

      const res1 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_qif",
        content,
      });

      expect(res1.rowCount).toBe(4);
      expect(res1.newCount).toBe(4);
      expect(res1.dupCount).toBe(0);
      expect(uow.state.transactions).toHaveLength(4);
      expect(uow.state.transactions[0]?.externalId).toBe("1001");

      const res2 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_qif",
        content,
      });

      expect(res2.newCount).toBe(0);
      expect(res2.dupCount).toBe(4);
      expect(uow.state.transactions).toHaveLength(4);
    });

    it("imports and re-imports ubank.csv fixture with zero duplicates", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = readFileSync(join(fixturesDir, "ubank.csv"), "utf8");

      const res1 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "ubank_csv",
        content,
      });

      expect(res1.rowCount).toBe(4);
      expect(res1.newCount).toBe(4);
      expect(res1.dupCount).toBe(0);
      expect(uow.state.transactions).toHaveLength(4);
      expect(uow.state.transactions[0]?.amountCents).toBe(-4500);

      const res2 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "ubank_csv",
        content,
      });

      expect(res2.newCount).toBe(0);
      expect(res2.dupCount).toBe(4);
      expect(uow.state.transactions).toHaveLength(4);
    });

    it("imports and re-imports up.csv fixture with zero duplicates (skipping pending)", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = readFileSync(join(fixturesDir, "up.csv"), "utf8");

      const res1 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "up_csv",
        content,
      });

      expect(res1.rowCount).toBe(4);
      expect(res1.newCount).toBe(4);
      expect(res1.dupCount).toBe(0);
      expect(uow.state.transactions).toHaveLength(4);

      const res2 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "up_csv",
        content,
      });

      expect(res2.newCount).toBe(0);
      expect(res2.dupCount).toBe(4);
      expect(uow.state.transactions).toHaveLength(4);
    });

    it("imports and re-imports fy2025-multibank.csv fixture with zero duplicates", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = readFileSync(join(fixturesDir, "fy2025-multibank.csv"), "utf8");

      const res1 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "fy2025_multibank_csv",
        content,
      });

      expect(res1.rowCount).toBe(4);
      expect(res1.newCount).toBe(4);
      expect(res1.dupCount).toBe(0);
      expect(uow.state.transactions).toHaveLength(4);

      const res2 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "fy2025_multibank_csv",
        content,
      });

      expect(res2.newCount).toBe(0);
      expect(res2.dupCount).toBe(4);
      expect(uow.state.transactions).toHaveLength(4);
    });

    it("imports and re-imports generic.csv fixture with debit/credit mapping", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = readFileSync(join(fixturesDir, "generic.csv"), "utf8");

      const mapping = {
        date: "TxDate",
        dateFormat: "YYYY-MM-DD" as const,
        description: "Merchant",
        debit: "Debit",
        credit: "Credit",
        balance: "Balance",
        externalId: "Reference",
      };

      const res1 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "generic_csv",
        content,
        csvMapping: mapping,
      });

      expect(res1.rowCount).toBe(4);
      expect(res1.newCount).toBe(4);
      expect(res1.dupCount).toBe(0);
      expect(uow.state.transactions).toHaveLength(4);
      expect(uow.state.transactions[0]?.amountCents).toBe(-4500);
      expect(uow.state.transactions[1]?.amountCents).toBe(150000);
      expect(uow.state.transactions[0]?.externalId).toBe("REF-001");

      const res2 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "generic_csv",
        content,
        csvMapping: mapping,
      });

      expect(res2.newCount).toBe(0);
      expect(res2.dupCount).toBe(4);
      expect(uow.state.transactions).toHaveLength(4);
    });
  });

  describe("Overlapping date range import across statement files", () => {
    it("commits only genuine new transactions and skips overlapping transactions", () => {
      const { ctx, sharedAccountId, uow } = setup();

      // First file has 2 transactions with externalId
      const file1 = `!Type:Bank
D01/09/2024
T-45.00
PWOOLWORTHS
N1001
^
D02/09/2024
T1500.00
PSALARY
N1002
^`;

      const res1 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_qif",
        content: file1,
      });

      expect(res1.rowCount).toBe(2);
      expect(res1.newCount).toBe(2);
      expect(res1.dupCount).toBe(0);
      expect(uow.state.transactions).toHaveLength(2);

      // Second file has the same 2 transactions PLUS 2 new transactions
      const file2 = `!Type:Bank
D01/09/2024
T-45.00
PWOOLWORTHS
N1001
^
D02/09/2024
T1500.00
PSALARY
N1002
^
D03/09/2024
T-4.50
PCAFE LATTE
N1003
^
D04/09/2024
T-120.00
PENERGY BILL
N1004
^`;

      const res2 = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_qif",
        content: file2,
      });

      expect(res2.rowCount).toBe(4);
      expect(res2.newCount).toBe(2);
      expect(res2.dupCount).toBe(2);
      expect(uow.state.transactions).toHaveLength(4);
      expect(uow.state.transactions[2]?.amountCents).toBe(-450);
      expect(uow.state.transactions[3]?.amountCents).toBe(-12000);
    });
  });

  describe("Generic CSV mapping edge cases", () => {
    it("handles signed amounts and inverted sign convention", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = `Date,Description,Amount
01/09/2024,Expense,50.00
02/09/2024,Income,-1500.00`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "generic_csv",
        content,
        csvMapping: {
          date: "Date",
          dateFormat: "DD/MM/YYYY",
          description: "Description",
          amount: "Amount",
          signConvention: "inverted",
        },
      });

      expect(res.rowCount).toBe(2);
      expect(res.newCount).toBe(2);
      expect(uow.state.transactions[0]?.amountCents).toBe(-5000);
      expect(uow.state.transactions[1]?.amountCents).toBe(150000);
    });

    it("throws Validation when generic_csv is called without csvMapping", () => {
      const { ctx, sharedAccountId } = setup();
      expect(() =>
        importStatement(ctx, {
          accountId: sharedAccountId,
          format: "generic_csv",
          content: "Date,Desc,Amt\n01/09/2024,Test,10.00",
        }),
      ).toThrowError(AppError);
    });

    it("throws Validation when both debit and credit are present in a row", () => {
      const { ctx, sharedAccountId } = setup();
      const badContent = `Date,Description,Debit,Credit
01/09/2024,Conflict,50.00,50.00`;

      expect(() =>
        importStatement(ctx, {
          accountId: sharedAccountId,
          format: "generic_csv",
          content: badContent,
          csvMapping: {
            date: "Date",
            description: "Description",
            debit: "Debit",
            credit: "Credit",
          },
        }),
      ).toThrowError(AppError);
    });

    it("concatenates description and memo in generic CSV", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = `Date,Merchant,Notes,Amount
01/09/2024,Bunnings,Hardware tools,-120.50`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "generic_csv",
        content,
        csvMapping: {
          date: "Date",
          dateFormat: "DD/MM/YYYY",
          description: "Merchant",
          memo: "Notes",
          amount: "Amount",
        },
      });

      expect(res.rowCount).toBe(1);
      expect(res.newCount).toBe(1);
      expect(uow.state.transactions[0]?.descriptionRaw).toBe("Bunnings Hardware tools");
    });

    it("imports generic CSV with custom delimiter, hasHeader false, and numeric column indices", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = `01/09/2024;Supermarket;-65.00;1000.00
02/09/2024;Salary;3000.00;4000.00`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "generic_csv",
        content,
        csvMapping: {
          date: 0,
          dateFormat: "DD/MM/YYYY",
          description: 1,
          amount: 2,
          balance: 3,
          hasHeader: false,
          delimiter: ";",
        },
      });

      expect(res.rowCount).toBe(2);
      expect(res.newCount).toBe(2);
      expect(uow.state.transactions[0]?.amountCents).toBe(-6500);
      expect(uow.state.transactions[1]?.amountCents).toBe(300000);
    });

    it("rejects multi-character delimiter in csvMapping with Validation error", () => {
      const { ctx, sharedAccountId } = setup();
      expect(() =>
        importStatement(ctx, {
          accountId: sharedAccountId,
          format: "generic_csv",
          content: "01/09/2024::Test::-10.00",
          csvMapping: {
            date: 0,
            description: 1,
            amount: 2,
            hasHeader: false,
            delimiter: "::",
          },
        }),
      ).toThrowError(AppError);
    });

    it("imports standard QIF using format 'qif'", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const qif = `!Type:Bank
D01/09/2024
T-22.50
PCAFE
^`;
      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "qif",
        content: qif,
      });

      expect(res.rowCount).toBe(1);
      expect(res.newCount).toBe(1);
      expect(uow.state.transactions[0]?.amountCents).toBe(-2250);
    });

    it("imports statement files with leading UTF-8 BOM", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const bomContent = `\uFEFFDate,Description,Amount,Balance
01/09/2024,"BOM MERCHANT",-55.00,1000.00`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "ubank_csv",
        content: bomContent,
      });

      expect(res.rowCount).toBe(1);
      expect(res.newCount).toBe(1);
      expect(uow.state.transactions[0]?.descriptionRaw).toBe("BOM MERCHANT");
    });

    it("imports ubank CSV with 2-digit years (DD/MM/YY)", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = `Date,Description,Amount,Balance
15/09/24,"UBANK 2-DIGIT YEAR",-30.00,970.00`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "ubank_csv",
        content,
      });

      expect(res.rowCount).toBe(1);
      expect(res.newCount).toBe(1);
      expect(uow.state.transactions[0]?.postedOn).toBe("2024-09-15");
    });
  });
});
