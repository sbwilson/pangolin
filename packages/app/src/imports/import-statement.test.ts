import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeFingerprint } from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import type { StatementParseResult } from "../ports/statement-parser.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import { importStatement } from "./import-statement.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../../importers/fixtures");

const now = Temporal.Instant.from("2026-10-20T12:00:00.000Z");
const clock = manualClock("2026-10-20T12:00:00.000Z");

function setup() {
  registerTransactionNeedsReviewSync();
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

  return {
    ctx,
    alexViewer,
    sharedAccountId,
    privateAccountId,
    alexPersonId,
    samPersonId,
    newId,
    uow,
  };
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

  it("adds only the excess when a later file has one more identical same-day line than the ledger", () => {
    const { ctx, sharedAccountId, uow } = setup();
    const head = "Date,Amount,Description,Balance";
    const line = '01/09/2024,-15.00,"WOOLWORTHS",0.00';
    const imp = (content: string) =>
      importStatement(ctx, { accountId: sharedAccountId, format: "commbank_csv", content });

    expect(imp(`${head}\n${line}`).newCount).toBe(1);
    const res2 = imp(`${head}\n${line}\n${line}`);
    expect(res2.newCount).toBe(1);
    expect(res2.dupCount).toBe(1);
    expect(uow.state.transactions).toHaveLength(2);
    expect(uow.state.transactions[0]?.fingerprint).not.toBe(uow.state.transactions[1]?.fingerprint);
  });

  it("adds zero when a file repeats same-day twins the ledger already has", () => {
    const { ctx, sharedAccountId, uow } = setup();
    const head = "Date,Amount,Description,Balance";
    const twins = `${head}\n01/09/2024,-4.50,"CAFE",0.00\n01/09/2024,-4.50,"CAFE",0.00`;
    const imp = (content: string) =>
      importStatement(ctx, { accountId: sharedAccountId, format: "commbank_csv", content });
    expect(imp(twins).newCount).toBe(2);
    const again = imp(`${twins}\n02/09/2024,-1.00,"OTHER",0.00`);
    expect(again.newCount).toBe(1);
    expect(again.dupCount).toBe(2);
    expect(uow.state.transactions).toHaveLength(3);
  });

  it("dedupes overlapping CSV files without ids, so each shared line exists once", () => {
    const { ctx, sharedAccountId, uow } = setup();
    const head = "Date,Amount,Description,Balance";
    const row = (n: number) => `0${n}/09/2024,-${n}.00,"LINE ${n}",0.00`;
    const imp = (rows: number[]) =>
      importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: [head, ...rows.map(row)].join("\n"),
      });
    expect(imp([1, 2, 3]).newCount).toBe(3);
    const b = imp([2, 3, 4]);
    expect(b.newCount).toBe(1);
    expect(b.dupCount).toBe(2);
    expect(uow.state.transactions).toHaveLength(4);
  });

  it("treats lines an OFX import already holds as duplicates in a later CSV", () => {
    const { ctx, sharedAccountId, uow } = setup();
    const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240901120000</DTPOSTED><TRNAMT>-50.00</TRNAMT><NAME>GYM MEMBERSHIP</NAME></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const r1 = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_ofx",
      content: ofx,
    });
    expect(r1.newCount).toBe(1);
    const r2 = importStatement(ctx, {
      accountId: sharedAccountId,
      format: "commbank_csv",
      content: `Date,Amount,Description,Balance\n01/09/2024,-50.00,"GYM MEMBERSHIP",0.00\n02/09/2024,-5.00,"NEW",0.00`,
    });
    expect(r2.newCount).toBe(1);
    expect(r2.dupCount).toBe(1);
    expect(uow.state.transactions).toHaveLength(2);
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

    it("sets aside row when both debit and credit are present in a row", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const badContent = `Date,Description,Debit,Credit
01/09/2024,Conflict,50.00,50.00`;

      const result = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "generic_csv",
        content: badContent,
        csvMapping: {
          date: "Date",
          description: "Description",
          debit: "Debit",
          credit: "Credit",
        },
      });

      expect(result.setAsideCount).toBe(1);
      expect(result.newCount).toBe(0);

      // Verify row is staged with status set_aside and reason mentions both debit and credit
      const batchRows = uow.state.importRows.filter((r) => r.batchId === result.batchId);
      expect(batchRows).toHaveLength(1);
      expect(batchRows[0]?.status).toBe("set_aside");
      expect(batchRows[0]?.reason).toMatch(/both debit and credit/i);

      // Verify review item was raised
      const reviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${result.batchId}`,
      );
      expect(reviewItem).toBeDefined();
    });

    it("sets aside row when debit column is malformed text even if credit column has an amount", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const content = `Date,Description,Debit,Credit
01/09/2024,Cafe,not-a-number,20.00`;

      const result = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "generic_csv",
        content,
        csvMapping: {
          date: "Date",
          description: "Description",
          debit: "Debit",
          credit: "Credit",
        },
      });

      expect(result.setAsideCount).toBe(1);
      expect(result.newCount).toBe(0);

      const batchRows = uow.state.importRows.filter((r) => r.batchId === result.batchId);
      expect(batchRows).toHaveLength(1);
      expect(batchRows[0]?.status).toBe("set_aside");
      expect(batchRows[0]?.reason).toMatch(/invalid debit amount/i);
    });

    it("handles custom parser returning result omitting setAside", () => {
      const { ctx, sharedAccountId } = setup();
      const customParser = {
        format: "custom",
        parse: () =>
          ({
            rows: [
              {
                rowNumber: 1,
                rawLine: "mock line",
                postedOn: "2024-09-01",
                amountCents: -5000,
                rawDescription: "Mock txn",
                externalId: null,
                balanceCents: null,
              },
            ],
          }) as unknown as StatementParseResult,
      };

      const result = importStatement(
        ctx,
        {
          accountId: sharedAccountId,
          format: "commbank_csv",
          content: "mock",
        },
        { parser: customParser },
      );

      expect(result.newCount).toBe(1);
      expect(result.setAsideCount).toBe(0);
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

  describe("Partial import and set-aside pipeline", () => {
    it("imports valid CSV rows while setting aside malformed rows and raising review item", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const csv = `01/09/2024,-50.00,Good Coffee
bad-date,-10.00,Bad Row
02/09/2024,not-a-number,Bad Amount
03/09/2024,100.00,Valid Salary`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csv,
      });

      expect(res.rowCount).toBe(4);
      expect(res.newCount).toBe(2);
      expect(res.dupCount).toBe(0);
      expect(res.setAsideCount).toBe(2);

      // Ledger has only the 2 valid transactions
      expect(uow.state.transactions).toHaveLength(2);
      expect(uow.state.transactions.map((t) => t.descriptionRaw)).toEqual([
        "Good Coffee",
        "Valid Salary",
      ]);

      // import_batch has recorded counts
      const batch = uow.state.importBatches.find((b) => b.id === res.batchId);
      expect(batch).toBeDefined();
      expect(batch?.rowCount).toBe(4);
      expect(batch?.newCount).toBe(2);
      expect(batch?.dupCount).toBe(0);

      // import_row has staged 4 rows: 2 committed, 2 set_aside
      const rows = uow.state.importRows.filter((r) => r.batchId === res.batchId);
      expect(rows).toHaveLength(4);

      const setAsideRows = rows.filter((r) => r.status === "set_aside");
      expect(setAsideRows).toHaveLength(2);
      expect(setAsideRows[0]?.rowNumber).toBe(2);
      expect(setAsideRows[0]?.rawLine).toBe("bad-date,-10.00,Bad Row");
      expect(setAsideRows[0]?.reason).toMatch(/date/i);

      expect(setAsideRows[1]?.rowNumber).toBe(3);
      expect(setAsideRows[1]?.rawLine).toBe("02/09/2024,not-a-number,Bad Amount");
      expect(setAsideRows[1]?.reason).toMatch(/amount/i);

      // Review item was raised
      const reviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${res.batchId}`,
      );
      expect(reviewItem).toBeDefined();
      expect(reviewItem?.kind).toBe("import.set_aside");
      expect(reviewItem?.accountId).toBe(sharedAccountId);
      expect(reviewItem?.entityRef).toBe(`import_batch:${res.batchId}`);
      expect(reviewItem?.resolvedAt).toBeNull();
    });

    it("partially imports OFX with malformed STMTTRN blocks", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const ofx = `<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240901120000
<TRNAMT>-25.00
<FITID>OFX1
<NAME>Good OFX Transaction
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<TRNAMT>-50.00
<FITID>OFX2
<NAME>Missing Date OFX
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_ofx",
        content: ofx,
      });

      expect(res.rowCount).toBe(2);
      expect(res.newCount).toBe(1);
      expect(res.setAsideCount).toBe(1);

      expect(uow.state.transactions).toHaveLength(1);
      expect(uow.state.transactions[0]?.descriptionRaw).toBe("Good OFX Transaction");

      const rows = uow.state.importRows.filter((r) => r.batchId === res.batchId);
      expect(rows).toHaveLength(2);
      const setAsideRow = rows.find((r) => r.status === "set_aside");
      expect(setAsideRow).toBeDefined();
      expect(setAsideRow?.reason).toMatch(/dtposted/i);

      const reviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${res.batchId}`,
      );
      expect(reviewItem).toBeDefined();
    });

    it("partially imports QIF with malformed records", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const qif = `!Type:Bank
D01/09/2024
T-35.00
PValid QIF
^
D02/09/2024
PMissing Amount QIF
^`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "qif",
        content: qif,
      });

      expect(res.rowCount).toBe(2);
      expect(res.newCount).toBe(1);
      expect(res.setAsideCount).toBe(1);

      expect(uow.state.transactions).toHaveLength(1);
      expect(uow.state.transactions[0]?.descriptionRaw).toBe("Valid QIF");

      const rows = uow.state.importRows.filter((r) => r.batchId === res.batchId);
      expect(rows).toHaveLength(2);
      const setAsideRow = rows.find((r) => r.status === "set_aside");
      expect(setAsideRow).toBeDefined();
      expect(setAsideRow?.reason).toMatch(/missing amount/i);

      const reviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${res.batchId}`,
      );
      expect(reviewItem).toBeDefined();
    });

    it("stages all rows as set-aside when every row is malformed in a recognizable CSV", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const csv = `invalid-date-1,-10.00,Item 1
invalid-date-2,-20.00,Item 2`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csv,
      });

      expect(res.rowCount).toBe(2);
      expect(res.newCount).toBe(0);
      expect(res.dupCount).toBe(0);
      expect(res.setAsideCount).toBe(2);
      expect(uow.state.transactions).toHaveLength(0);

      const reviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${res.batchId}`,
      );
      expect(reviewItem).toBeDefined();
    });

    it("sets aside QIF record with non-empty lines but missing date and amount", () => {
      const { ctx, sharedAccountId, uow } = setup();
      const qif = `!Type:Bank
PPayee Only No Date Or Amount
MMemo Only
^`;

      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "qif",
        content: qif,
      });

      expect(res.rowCount).toBe(1);
      expect(res.newCount).toBe(0);
      expect(res.setAsideCount).toBe(1);

      const rows = uow.state.importRows.filter((r) => r.batchId === res.batchId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("set_aside");
      expect(rows[0]?.reason).toMatch(/missing date/i);
    });
  });

  describe("Classification cascade during import (payee alias, rules, payee default, review items)", () => {
    it("sets payeeId on imported transaction when description matches payee alias pattern", () => {
      const { ctx, sharedAccountId, uow, newId } = setup();

      const payeeId = newId<"Payee">();
      uow.state.payees.push({
        id: payeeId,
        name: "Woolworths",
        websiteUrl: null,
        logoAttachmentId: null,
        defaultCategoryId: null,
        scopePersonId: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.payeeAliases.push({
        id: newId<"PayeeAlias">(),
        payeeId,
        pattern: "WOOLWORTHS",
        matchKind: "prefix",
        scopePersonId: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      const csv = `20/10/2026,-52.30,WOOLWORTHS 1234 SUBIACO`;
      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csv,
      });

      expect(res.newCount).toBe(1);
      const txn = uow.state.transactions.find((t) => t.id === res.transactionIds[0]);
      expect(txn?.payeeId).toBe(payeeId);
    });

    it("applies the rule with lowest priority number when multiple rules match", () => {
      const { ctx, sharedAccountId, uow, newId } = setup();

      const catGroceries = newId<"Category">();
      const catSnacks = newId<"Category">();
      const catGroup = newId<"CategoryGroup">();

      uow.state.categoryGroups.push({
        id: catGroup,
        name: "Food",
        kind: "expense",
        sort: 1,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });
      uow.state.categories.push(
        {
          id: catGroceries,
          groupId: catGroup,
          name: "Groceries",
          isFixedCost: false,
          createdAt: now.toString(),
          updatedAt: now.toString(),
        },
        {
          id: catSnacks,
          groupId: catGroup,
          name: "Snacks",
          isFixedCost: false,
          createdAt: now.toString(),
          updatedAt: now.toString(),
        },
      );

      // Rule A: priority 10 (Groceries)
      uow.state.rules.push({
        id: newId<"Rule">(),
        name: "Rule A - Groceries",
        priority: 10,
        conditions: JSON.stringify({ descriptionPattern: "WOOLWORTHS" }),
        actions: JSON.stringify({ categoryId: catGroceries }),
        origin: "user",
        scopePersonId: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      // Rule B: priority 20 (Snacks)
      uow.state.rules.push({
        id: newId<"Rule">(),
        name: "Rule B - Snacks",
        priority: 20,
        conditions: JSON.stringify({ descriptionPattern: "WOOLWORTHS" }),
        actions: JSON.stringify({ categoryId: catSnacks }),
        origin: "user",
        scopePersonId: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      const csv = `20/10/2026,-45.00,WOOLWORTHS SUBIACO`;
      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csv,
      });

      expect(res.newCount).toBe(1);
      const split = uow.state.splits.find((s) => s.transactionId === res.transactionIds[0]);
      expect(split?.categoryId).toBe(catGroceries);
      expect(split?.categorySource).toBe("rule");
    });

    it("falls back to payee defaultCategoryId when no rule matches", () => {
      const { ctx, sharedAccountId, uow, newId } = setup();

      const catFuel = newId<"Category">();
      const catGroup = newId<"CategoryGroup">();

      uow.state.categoryGroups.push({
        id: catGroup,
        name: "Transport",
        kind: "expense",
        sort: 1,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });
      uow.state.categories.push({
        id: catFuel,
        groupId: catGroup,
        name: "Fuel",
        isFixedCost: false,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      const payeeId = newId<"Payee">();
      uow.state.payees.push({
        id: payeeId,
        name: "BP Connect",
        websiteUrl: null,
        logoAttachmentId: null,
        defaultCategoryId: catFuel,
        scopePersonId: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.payeeAliases.push({
        id: newId<"PayeeAlias">(),
        payeeId,
        pattern: "BP",
        matchKind: "prefix",
        scopePersonId: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      const csv = `20/10/2026,-80.00,BP CONNECT SUBIACO`;
      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csv,
      });

      expect(res.newCount).toBe(1);
      const split = uow.state.splits.find((s) => s.transactionId === res.transactionIds[0]);
      expect(split?.categoryId).toBe(catFuel);
      expect(split?.categorySource).toBe("payee");

      const txn = uow.state.transactions.find((t) => t.id === res.transactionIds[0]);
      expect(txn?.needsReview).toBe(false);
    });

    it("leaves split unclassified, raises review item, and sets needsReview when no rule or default matches", () => {
      const { ctx, sharedAccountId, uow } = setup();

      const csv = `20/10/2026,-15.00,UNKNOWN SHOP 9999`;
      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csv,
      });

      expect(res.newCount).toBe(1);
      const txnId = res.transactionIds[0];
      const txn = uow.state.transactions.find((t) => t.id === txnId);
      const split = uow.state.splits.find((s) => s.transactionId === txnId);

      expect(split?.categoryId).toBeNull();
      expect(split?.categorySource).toBeNull();
      expect(txn?.needsReview).toBe(true);

      const reviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `classify.unclassified:${txnId}`,
      );
      expect(reviewItem).toBeDefined();
      expect(reviewItem?.kind).toBe("classify.unclassified");
      expect(reviewItem?.resolvedAt).toBeNull();
    });

    it("does not apply Person A's private rule when Person B imports into a shared account", () => {
      const { sharedAccountId, alexPersonId, samPersonId, uow, newId } = setup();

      const catHealth = newId<"Category">();
      const catGroup = newId<"CategoryGroup">();

      uow.state.categoryGroups.push({
        id: catGroup,
        name: "Health",
        kind: "expense",
        sort: 1,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });
      uow.state.categories.push({
        id: catHealth,
        groupId: catGroup,
        name: "GP and Specialists",
        isFixedCost: false,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      // Alex creates a private rule for "CLINIC"
      uow.state.rules.push({
        id: newId<"Rule">(),
        name: "Alex Private Clinic Rule",
        priority: 1,
        conditions: JSON.stringify({ descriptionPattern: "CLINIC" }),
        actions: JSON.stringify({ categoryId: catHealth }),
        origin: "user",
        scopePersonId: alexPersonId,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      // Sam imports statement into the shared account
      const samCtx = {
        viewer: { kind: "person", personId: samPersonId, authAt: now } as Viewer,
        clock,
        newId,
        uow,
      };

      const csv = `20/10/2026,-150.00,SUBIACO CLINIC`;
      const res = importStatement(samCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csv,
      });

      expect(res.newCount).toBe(1);
      const split = uow.state.splits.find((s) => s.transactionId === res.transactionIds[0]);

      // Alex's private rule must NOT apply to the shared account!
      expect(split?.categoryId).toBeNull();
      expect(split?.categorySource).toBeNull();
    });
  });
  describe("Closed-account lock", () => {
    const close = (uow: ReturnType<typeof setup>["uow"], id: string, closedOn: string) => {
      uow.state.accounts = uow.state.accounts.map((a) => (a.id === id ? { ...a, closedOn } : a));
    };

    it("sets aside rows dated after closedOn with a reason and imports the rest", () => {
      const { ctx, sharedAccountId, uow } = setup();
      close(uow, sharedAccountId, "2026-06-30");
      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: "29/06/2026,-10.00,EARLY\n30/06/2026,-5.00,ON THE DAY\n02/07/2026,-20.00,LATE",
      });
      expect(res).toMatchObject({ rowCount: 3, newCount: 2, dupCount: 0, setAsideCount: 1 });
      expect(uow.state.transactions.map((t) => t.descriptionRaw)).toEqual(["EARLY", "ON THE DAY"]);
      const aside = uow.state.importRows.filter((r) => r.status === "set_aside");
      expect(aside).toHaveLength(1);
      expect(aside[0]?.rowNumber).toBe(3);
      expect(aside[0]?.reason).toBe("Dated after this account closed on 2026-06-30");
      const batch = uow.state.importBatches.find((b) => b.id === res.batchId);
      expect(batch).toMatchObject({
        lastPostedOn: "2026-06-30",
        firstPostedOn: "2026-06-29",
        reconcileStatus: "unavailable",
      });
      expect(
        uow.state.reviewItems.filter((i) => i.kind === "import.set_aside" && i.resolvedAt === null),
      ).toHaveLength(1);
    });

    it("commits nothing and records no snapshot when every row is after closedOn", () => {
      const { ctx, sharedAccountId, uow } = setup();
      close(uow, sharedAccountId, "2026-06-30");
      const res = importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: "01/07/2026,-10.00,ONE,90.00\n02/07/2026,-5.00,TWO,85.00",
      });
      expect(res).toMatchObject({ newCount: 0, setAsideCount: 2, transactionIds: [] });
      expect(uow.state.transactions).toHaveLength(0);
      expect(uow.state.balanceSnapshots).toHaveLength(0);
      const batch = uow.state.importBatches.find((b) => b.id === res.batchId);
      expect(batch).toMatchObject({ firstPostedOn: null, lastPostedOn: null });
    });

    it("derives the opening snapshot from committed rows, never after closedOn", () => {
      const { ctx, sharedAccountId, uow } = setup();
      close(uow, sharedAccountId, "2026-06-30");
      importStatement(ctx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: "28/06/2026,-10.00,ONE,90.00\n29/06/2026,-5.00,TWO,85.00",
      });
      expect(uow.state.balanceSnapshots.map((s) => [s.asOf, s.balanceCents])).toEqual([
        ["2026-06-27", 10_000],
      ]);
    });

    it("does not lock the system viewer", () => {
      const { ctx, sharedAccountId, uow } = setup();
      close(uow, sharedAccountId, "2026-06-30");
      const res = importStatement(
        { ...ctx, viewer: systemViewer("cli:test") },
        {
          accountId: sharedAccountId,
          format: "commbank_csv",
          content: "02/07/2026,-20.00,LATE",
        },
      );
      expect(res).toMatchObject({ newCount: 1, setAsideCount: 0 });
    });
  });
});
