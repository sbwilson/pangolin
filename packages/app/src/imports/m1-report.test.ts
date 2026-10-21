import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { createIdGenerator } from "../ids.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import type { ImportBatchRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import { importStatement } from "./import-statement.ts";
import { accountReport, m1GateReport } from "./m1-report.ts";
import { undoImportBatch } from "./undo-batch.ts";

registerTransactionNeedsReviewSync();

const now = Temporal.Instant.from("2026-10-20T12:00:00.000Z");

function setup() {
  const clock = manualClock("2026-10-20T12:00:00.000Z");
  let ms = 1792400000000;
  const newId = createIdGenerator({ now: () => ++ms, random: () => 0.5 });
  const uow = memoryUnitOfWork();
  const stamp = now.toString();
  const alexId = newId<"Person">();
  uow.state.people.push({
    id: alexId,
    userId: "user-alex",
    displayName: "Alex",
    colour: "#ff0000",
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  });
  const account = (name: string) => {
    const id = newId<"Account">();
    uow.state.accounts.push({
      id,
      name,
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: "2024-01-01",
      closedOn: null,
      isSavings: false,
      createdAt: stamp,
      updatedAt: stamp,
    });
    uow.state.accountOwners.push({
      accountId: id,
      personId: alexId,
      shareBp: 10000,
      createdAt: stamp,
      updatedAt: stamp,
    });
    return id;
  };
  const viewer: Viewer = { kind: "person", personId: alexId, authAt: now };
  const ctx = { viewer, clock, newId, uow };
  const sysCtx = { viewer: systemViewer("cli:m1-report"), clock, newId, uow };
  return { uow, ctx, sysCtx, account };
}

const cents = (n: number) =>
  `${n < 0 ? "-" : ""}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, "0")}`;

/** A CommBank CSV whose balances chain from `opening`; `newestFirst` lists it as the bank does. */
function csv(
  rows: readonly (readonly [string, number])[],
  opening = 100_000,
  newestFirst = false,
): string {
  let balance = opening;
  const lines = rows.map(([date, amount], i) => {
    balance += amount;
    return `${date},${cents(amount)},"ROW ${date} ${i}",${cents(balance)}`;
  });
  return (newestFirst ? lines.reverse() : lines).join("\n");
}

const MARCH = [
  ["01/03/2026", -1000],
  ["02/03/2026", -2000],
  ["03/03/2026", 5000],
  ["04/03/2026", -300],
] as const;

describe("import reconcile (pipeline step 7)", () => {
  it("records ok for balances that chain, in either file order", () => {
    const { uow, ctx, account } = setup();
    const a = account("A");
    const b = account("B");
    const oldest = importStatement(ctx, {
      accountId: a,
      format: "commbank_csv",
      content: csv(MARCH),
    });
    const newest = importStatement(ctx, {
      accountId: b,
      format: "commbank_csv",
      content: csv(MARCH, 100_000, true),
    });
    for (const id of [oldest.batchId, newest.batchId]) {
      expect(uow.state.importBatches.find((x) => x.id === id)).toMatchObject({
        status: "committed",
        reconcileStatus: "ok",
        reconcileGapCents: 0,
        firstPostedOn: "2026-03-01",
        lastPostedOn: "2026-03-04",
      });
    }
    expect(uow.state.reviewItems.filter((i) => i.kind === "import.balance_gap")).toHaveLength(0);
  });

  it("records a gap with its size, raises one item and still commits", () => {
    const { uow, ctx, account } = setup();
    const a = account("A");
    // The 5000 row is dropped from the file: its balance effect shows as a break of 5000.
    const full = csv(MARCH).split("\n");
    const content = [full[0], full[1], full[3]].join("\n");
    const res = importStatement(ctx, { accountId: a, format: "commbank_csv", content });
    expect(res.status).toBe("committed");
    expect(res.newCount).toBe(3);
    const batch = uow.state.importBatches.find((x) => x.id === res.batchId);
    expect(batch).toMatchObject({ reconcileStatus: "gap", reconcileGapCents: 5000 });
    const items = uow.state.reviewItems.filter((i) => i.kind === "import.balance_gap");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      entityRef: `import_batch:${res.batchId}`,
      accountId: a,
      resolvedAt: null,
    });
    // The same file again changes nothing.
    const again = importStatement(ctx, { accountId: a, format: "commbank_csv", content });
    expect(again.batchId).toBe(res.batchId);
    expect(uow.state.importBatches).toHaveLength(1);
    expect(uow.state.reviewItems.filter((i) => i.kind === "import.balance_gap")).toHaveLength(1);
    // Undoing the batch resolves the item.
    undoImportBatch(ctx, { batchId: res.batchId });
    expect(
      uow.state.reviewItems.filter((i) => i.kind === "import.balance_gap" && i.resolvedAt === null),
    ).toHaveLength(0);
  });

  it("records unavailable, not a gap, when the file has set-aside rows", () => {
    const { uow, ctx, account } = setup();
    const a = account("A");
    // A bad row sits mid-file; its neighbours would look adjacent and falsely break the chain.
    const lines = csv(MARCH).split("\n");
    const content = [lines[0], lines[1], 'not-a-date,-1.00,"BAD",0.00', lines[2], lines[3]].join(
      "\n",
    );
    const res = importStatement(ctx, { accountId: a, format: "commbank_csv", content });
    expect(res.setAsideCount).toBe(1);
    expect(uow.state.importBatches.find((x) => x.id === res.batchId)).toMatchObject({
      status: "committed",
      reconcileStatus: "unavailable",
      reconcileGapCents: 0,
    });
    expect(uow.state.reviewItems.filter((i) => i.kind === "import.balance_gap")).toHaveLength(0);
    expect(uow.state.reviewItems.filter((i) => i.kind === "import.set_aside")).toHaveLength(1);
  });

  it("records unavailable for formats without printed balances", () => {
    const { uow, ctx, account } = setup();
    const a = account("A");
    const ofx = `OFXHEADER:100\n<OFX><STMTTRN><DTPOSTED>20260301<TRNAMT>-10.00<FITID>1<NAME>A</STMTTRN><STMTTRN><DTPOSTED>20260302<TRNAMT>-5.00<FITID>2<NAME>B</STMTTRN></OFX>`;
    const qif = "!Type:Bank\nD01/03/2026\nT-10.00\nPA\n^\nD02/03/2026\nT-5.00\nPB\n^";
    const up =
      "Time,Settled Date,Description,Amount,Status\n2026-03-01T00:00:00Z,2026-03-01,A,-10.00,SETTLED\n2026-03-02T00:00:00Z,2026-03-02,B,-5.00,SETTLED";
    for (const [format, content] of [
      ["commbank_ofx", ofx],
      ["commbank_qif", qif],
      ["up_csv", up],
    ] as const) {
      const res = importStatement(ctx, { accountId: a, format, content });
      expect(
        uow.state.importBatches.find((x) => x.id === res.batchId),
        format,
      ).toMatchObject({
        reconcileStatus: "unavailable",
        reconcileGapCents: 0,
        firstPostedOn: "2026-03-01",
        lastPostedOn: "2026-03-02",
      });
    }
    expect(uow.state.reviewItems.filter((i) => i.kind === "import.balance_gap")).toHaveLength(0);
  });
});

describe("m1GateReport", () => {
  const month = (m: string, days: readonly [number, number], opening: number) =>
    csv(
      [
        [`${String(days[0]).padStart(2, "0")}/${m}`, -1000],
        [`${String(days[1]).padStart(2, "0")}/${m}`, -2000],
      ],
      opening,
    );

  it("lists the hole between Jul-Sep and Nov-Jun coverage, and not the covered spans", () => {
    const { ctx, sysCtx, account } = setup();
    const a = account("Everyday");
    const load = (content: string) =>
      importStatement(ctx, { accountId: a, format: "commbank_csv", content });
    load(
      csv([
        ["01/07/2024", -100],
        ["30/09/2024", -100],
      ]),
    );
    load(
      csv(
        [
          ["01/11/2024", -100],
          ["30/06/2025", -100],
        ],
        50_000,
      ),
    );
    const report = m1GateReport(sysCtx);
    expect(report.totals).toEqual({ holes: 1, brokenBatches: 0 });
    const acct = report.accounts[0];
    expect(acct?.holes).toEqual([{ from: "2024-10-01", to: "2024-10-31", days: 31 }]);
    expect(acct?.monthsCovered).toBe(11);
    expect(acct?.covered.map((s) => [s.from, s.to])).toEqual([
      ["2024-07-01", "2024-09-30"],
      ["2024-11-01", "2025-06-30"],
    ]);
  });

  it("counts a weekend between files as a two-day hole, and a leading hole from 1 July 2024", () => {
    const { ctx, sysCtx, account } = setup();
    const a = account("Everyday");
    const load = (content: string) =>
      importStatement(ctx, { accountId: a, format: "commbank_csv", content });
    load(
      csv([
        ["05/07/2024", -100],
        ["12/07/2024", -100],
      ]),
    );
    load(
      csv(
        [
          ["15/07/2024", -100],
          ["31/07/2024", -100],
        ],
        90_000,
      ),
    );
    const [acct] = m1GateReport(sysCtx).accounts;
    expect(acct?.holes).toEqual([
      { from: "2024-07-01", to: "2024-07-04", days: 4 },
      { from: "2024-07-13", to: "2024-07-14", days: 2 },
    ]);
  });

  it("lists a broken batch, leaves out an undone one, and notes an account with no statements", () => {
    const { ctx, sysCtx, account } = setup();
    const a = account("Everyday");
    account("Empty");
    const good = importStatement(ctx, {
      accountId: a,
      format: "commbank_csv",
      content: month("07/2024", [1, 31], 100_000),
    });
    const lines = csv([
      ["01/08/2024", -100],
      ["15/08/2024", -200],
      ["31/08/2024", -300],
    ]).split("\n");
    const broken = importStatement(ctx, {
      accountId: a,
      format: "commbank_csv",
      content: [lines[0], lines[2]].join("\n"),
    });
    let report = m1GateReport(sysCtx);
    expect(report.accountsWithoutStatements).toBe(1);
    expect(report.totals).toEqual({ holes: 0, brokenBatches: 1 });
    expect(report.accounts.find((x) => x.accountId === a)?.brokenBatches).toEqual([
      expect.objectContaining({ batchId: broken.batchId, gapCents: 200 }),
    ]);
    undoImportBatch(ctx, { batchId: broken.batchId });
    report = m1GateReport(sysCtx);
    expect(report.totals).toEqual({ holes: 0, brokenBatches: 0 });
    expect(report.accounts.find((x) => x.accountId === a)?.batches).toBe(1);
    expect(good.status).toBe("committed");
  });

  it("is read-only", () => {
    const { uow, ctx, sysCtx, account } = setup();
    const a = account("Everyday");
    importStatement(ctx, { accountId: a, format: "commbank_csv", content: csv(MARCH) });
    const before = JSON.stringify([uow.state.audit, uow.state.importBatches]);
    m1GateReport(sysCtx);
    expect(JSON.stringify([uow.state.audit, uow.state.importBatches])).toBe(before);
  });
});

describe("accountReport", () => {
  const batch = (first: string | null, last: string | null): ImportBatchRow => ({
    id: "b" as never,
    accountId: "a" as never,
    source: "commbank_csv",
    fileSha256: "x",
    rowCount: 0,
    newCount: 0,
    dupCount: 0,
    status: "committed",
    importedByPersonId: null,
    undoneAt: null,
    reconcileStatus: null,
    reconcileGapCents: null,
    firstPostedOn: first,
    lastPostedOn: last,
    createdAt: "t",
    updatedAt: "t",
  });

  it("merges overlapping and touching ranges, and ignores batches without dates", () => {
    const r = accountReport({ id: "a", name: "A" }, [
      batch("2024-07-01", "2024-07-20"),
      batch("2024-07-15", "2024-07-31"),
      batch("2024-08-01", "2024-08-31"),
      batch(null, null),
    ]);
    expect(r.covered).toEqual([{ from: "2024-07-01", to: "2024-08-31", days: 62 }]);
    expect(r.holes).toEqual([]);
    expect(r.unchecked).toBe(4);
    expect(r.monthsCovered).toBe(2);
  });
});
