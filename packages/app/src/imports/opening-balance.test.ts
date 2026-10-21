import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { balanceAsOf, listBalanceSnapshots, recordBalanceSnapshot } from "../accounts/balance.ts";
import { createIdGenerator } from "../ids.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import { importStatement } from "./import-statement.ts";
import { m1GateReport } from "./m1-report.ts";
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
  const accountId = newId<"Account">();
  uow.state.accounts.push({
    id: accountId,
    name: "Everyday",
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
    accountId,
    personId: alexId,
    shareBp: 10000,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const viewer: Viewer = { kind: "person", personId: alexId, authAt: now };
  const ctx = { viewer, clock, newId, uow };
  const sysCtx = { viewer: systemViewer("cli:opening-balance"), clock, newId, uow };
  return { uow, ctx, sysCtx, accountId };
}

const cents = (n: number) =>
  `${n < 0 ? "-" : ""}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, "0")}`;

/** A CommBank CSV (oldest first) whose balances chain from `opening`. */
function csv(rows: readonly (readonly [string, number])[], opening: number): string {
  let balance = opening;
  return rows
    .map(([date, amount], i) => {
      balance += amount;
      return `${date},${cents(amount)},"ROW ${date} ${i}",${cents(balance)}`;
    })
    .join("\n");
}

const MARCH = [
  ["02/03/2026", -1000],
  ["03/03/2026", -2000],
  ["04/03/2026", 5000],
] as const;

describe("opening balance from an imported statement", () => {
  it("records a statement snapshot the day before the first row, linked to the batch and audited", () => {
    const { uow, ctx, accountId } = setup();
    const res = importStatement(ctx, {
      accountId,
      format: "commbank_csv",
      content: csv(MARCH, 70_000),
    });
    expect(uow.state.balanceSnapshots).toEqual([
      expect.objectContaining({
        accountId,
        asOf: "2026-03-01",
        balanceCents: 70_000,
        source: "statement",
        importBatchId: res.batchId,
      }),
    ]);
    expect(uow.state.importBatches[0]).toMatchObject({
      openingBalanceCents: 70_000,
      closingBalanceCents: 72_000,
    });
    // Acceptance: balance on the first row's date is the printed balance after that row.
    expect(balanceAsOf(ctx, { accountId, date: "2026-03-02" })).toBe(69_000);
    expect(balanceAsOf(ctx, { accountId, date: "2026-03-04" })).toBe(72_000);
    expect(
      uow.state.audit.filter((a) => a.entity === "balance_snapshot" && a.action === "create"),
    ).toEqual([expect.objectContaining({ accountId })]);
  });

  it("derives the same opening and closing from a newest-first file", () => {
    const { uow, ctx, accountId } = setup();
    importStatement(ctx, {
      accountId,
      format: "commbank_csv",
      content: csv(MARCH, 70_000).split("\n").reverse().join("\n"),
    });
    expect(uow.state.balanceSnapshots.map((s) => [s.asOf, s.balanceCents])).toEqual([
      ["2026-03-01", 70_000],
    ]);
    expect(uow.state.importBatches[0]).toMatchObject({
      openingBalanceCents: 70_000,
      closingBalanceCents: 72_000,
    });
  });

  it("records no snapshot or values for a gap, or a file without balances", () => {
    const { uow, ctx, accountId } = setup();
    const lines = csv(MARCH, 70_000).split("\n");
    const gap = importStatement(ctx, {
      accountId,
      format: "commbank_csv",
      content: [lines[0], lines[2]].join("\n"),
    });
    importStatement(ctx, {
      accountId,
      format: "up_csv",
      content:
        "Time,Settled Date,Description,Amount,Status\n2026-02-01T00:00:00Z,2026-02-01,A,-1.00,SETTLED\n2026-02-02T00:00:00Z,2026-02-02,B,-1.00,SETTLED",
    });
    expect(uow.state.balanceSnapshots).toEqual([]);
    expect(uow.state.importBatches.find((b) => b.id === gap.batchId)).toMatchObject({
      reconcileStatus: "gap",
      openingBalanceCents: null,
      closingBalanceCents: null,
    });
  });

  it("records none when the account already has earlier transactions or an earlier snapshot", () => {
    const { uow, ctx, accountId } = setup();
    importStatement(ctx, { accountId, format: "commbank_csv", content: csv(MARCH, 70_000) });
    // A later file: earlier history exists.
    importStatement(ctx, {
      accountId,
      format: "commbank_csv",
      content: csv([["10/03/2026", -100]], 72_000),
    });
    expect(uow.state.balanceSnapshots).toHaveLength(1);
    // An earlier snapshot at or before the day before the first row also blocks it.
    const other = setup();
    recordBalanceSnapshot(other.sysCtx, {
      accountId: other.accountId,
      asOf: "2026-02-01",
      balanceCents: 5,
    });
    importStatement(other.ctx, {
      accountId: other.accountId,
      format: "commbank_csv",
      content: csv(MARCH, 70_000),
    });
    expect(other.uow.state.balanceSnapshots).toHaveLength(1);
    expect(other.uow.state.importBatches[0]).toMatchObject({ openingBalanceCents: 70_000 });
  });

  it("records an older file's own opening after a newer file, and the join compares them", () => {
    const { uow, ctx, sysCtx, accountId } = setup();
    importStatement(ctx, {
      accountId,
      format: "commbank_csv",
      content: csv(
        [
          ["10/03/2026", -100],
          ["11/03/2026", -100],
        ],
        99_000,
      ),
    });
    const older = importStatement(ctx, {
      accountId,
      format: "commbank_csv",
      content: csv(MARCH, 70_000),
    });
    expect(uow.state.balanceSnapshots.map((s) => [s.asOf, s.balanceCents]).sort()).toEqual([
      ["2026-03-01", 70_000],
      ["2026-03-09", 99_000],
    ]);
    // Older closes at 72_000 but the newer one opens at 99_000.
    const [account] = m1GateReport(sysCtx).accounts;
    expect(account?.joinBreaks).toEqual([
      expect.objectContaining({
        previousBatchId: older.batchId,
        closingCents: 72_000,
        openingCents: 99_000,
      }),
    ]);
  });

  it("deletes the snapshot when the batch is undone, audited, and the leading span is a hole again", () => {
    const { uow, ctx, sysCtx, accountId } = setup();
    const res = importStatement(ctx, {
      accountId,
      format: "commbank_csv",
      content: csv(
        [
          ["05/07/2024", -100],
          ["06/07/2024", -100],
        ],
        1000,
      ),
    });
    expect(m1GateReport(sysCtx).accounts[0]?.holes).toEqual([]);
    undoImportBatch(ctx, { batchId: res.batchId });
    expect(uow.state.balanceSnapshots).toEqual([]);
    expect(
      uow.state.audit.filter((a) => a.entity === "balance_snapshot" && a.action === "delete"),
    ).toHaveLength(1);
    expect(listBalanceSnapshots(ctx, { accountId })).toEqual([]);
    // The undone batch no longer counts as a statement.
    const report = m1GateReport(sysCtx);
    expect(report.accounts[0]?.batches).toBe(0);
  });

  it("makes the leading span a hole again after undo when other batches remain", () => {
    const { ctx, sysCtx, accountId } = setup();
    const first = importStatement(ctx, {
      accountId,
      format: "commbank_csv",
      content: csv(
        [
          ["05/07/2024", -100],
          ["06/07/2024", -100],
        ],
        1000,
      ),
    });
    importStatement(ctx, {
      accountId,
      format: "commbank_csv",
      content: csv(
        [
          ["07/07/2024", -100],
          ["08/07/2024", -100],
        ],
        800,
      ),
    });
    expect(m1GateReport(sysCtx).totals.holes).toBe(0);
    undoImportBatch(ctx, { batchId: first.batchId });
    const [account] = m1GateReport(sysCtx).accounts;
    expect(account?.holes).toEqual([{ from: "2024-07-01", to: "2024-07-06", days: 6 }]);
    expect(account?.startsFrom).toBeNull();
  });

  it("re-imports the same file after an undo and records the statement snapshot again", () => {
    const { uow, ctx, sysCtx, accountId } = setup();
    const content = csv(
      [
        ["05/07/2024", -100],
        ["06/07/2024", -100],
      ],
      1000,
    );
    const first = importStatement(ctx, { accountId, format: "commbank_csv", content });
    undoImportBatch(ctx, { batchId: first.batchId });
    expect(uow.state.balanceSnapshots).toEqual([]);
    const again = importStatement(ctx, { accountId, format: "commbank_csv", content });
    expect(again.batchId).not.toBe(first.batchId);
    expect(again.newCount).toBe(2);
    expect(uow.state.balanceSnapshots).toHaveLength(1);
    expect(uow.state.balanceSnapshots[0]?.importBatchId).toBe(again.batchId);
    expect(m1GateReport(sysCtx).accounts[0]?.holes).toEqual([]);
  });
});
