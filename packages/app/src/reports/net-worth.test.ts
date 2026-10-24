import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import type { Id } from "@pangolin/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordBalanceSnapshot } from "../accounts/balance.ts";
import { closeAccount } from "../accounts/close-account.ts";
import { createAccount } from "../accounts/create-account.ts";
import type { UseCaseContext } from "../context.ts";
import { createPerson } from "../identity/create-person.ts";
import { importStatement } from "../imports/import-statement.ts";
import { createTransaction } from "../ledger/create-transaction.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { netWorth } from "./net-worth.ts";

const clock = manualClock("2026-10-15T10:00:00Z");

let dir: string;
let db: Db;
let uow: UnitOfWork;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-net-worth-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  uow = createUnitOfWork(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function setupHousehold() {
  const newId = sequentialIds();
  const ctxOf = (viewer: Viewer): UseCaseContext => ({ viewer, clock, newId, uow });
  const sys = ctxOf(systemViewer("cli:test"));

  const simonId = createPerson(sys, { displayName: "Simon", colour: "#2C6681" });
  const carissaId = createPerson(sys, { displayName: "Carissa", colour: "#9C4277" });

  const simonCtx = ctxOf(personViewer(simonId, clock.now()));
  const carissaCtx = ctxOf(personViewer(carissaId, clock.now()));

  const sharedJoint = (
    name: string,
    type: "transaction" | "savings" | "offset" | "credit_card" | "home_loan",
  ) =>
    createAccount(sys, {
      name,
      type,
      currency: "AUD",
      isPrivate: false,
      owners: [
        { personId: simonId, shareBp: 5000 },
        { personId: carissaId, shareBp: 5000 },
      ],
    });

  const privateAccount = (
    name: string,
    type: "transaction" | "savings" | "offset" | "credit_card" | "home_loan",
    ownerId: Id<"Person">,
  ) =>
    createAccount(sys, {
      name,
      type,
      currency: "AUD",
      isPrivate: true,
      owners: [{ personId: ownerId, shareBp: 10000 }],
    });

  return { sys, simonId, carissaId, simonCtx, carissaCtx, sharedJoint, privateAccount };
}

describe("netWorth report", () => {
  it("computes hand sums across assets, liabilities, and subtotals", () => {
    const { sys, simonCtx, sharedJoint } = setupHousehold();

    const everyday = sharedJoint("Everyday", "transaction");
    const saver = sharedJoint("House Saver", "savings");
    const offset = sharedJoint("Offset", "offset");
    const card = sharedJoint("Low Rate Card", "credit_card");
    const loan = sharedJoint("Home Loan", "home_loan");

    recordBalanceSnapshot(sys, {
      accountId: everyday,
      asOf: "2026-10-01",
      balanceCents: 500_000,
    });
    // Add a transaction on Everyday posted after the snapshot
    createTransaction(sys, {
      accountId: everyday,
      postedOn: "2026-10-05",
      amountCents: -50_000,
      description: "Groceries",
    });
    // Everyday balance as of 2026-10-15 is 450_000

    recordBalanceSnapshot(sys, {
      accountId: saver,
      asOf: "2026-10-01",
      balanceCents: 2_000_000,
    });

    recordBalanceSnapshot(sys, {
      accountId: offset,
      asOf: "2026-10-01",
      balanceCents: 1_500_000,
    });

    recordBalanceSnapshot(sys, {
      accountId: card,
      asOf: "2026-10-01",
      balanceCents: -120_000,
    });

    recordBalanceSnapshot(sys, {
      accountId: loan,
      asOf: "2026-10-01",
      balanceCents: -40_000_000,
    });

    const report = netWorth(simonCtx);

    // Assets: 450_000 + 2_000_000 + 1_500_000 = 3_950_000
    expect(report.assetsCents).toBe(3_950_000);
    // Liabilities: -120_000 + -40_000_000 = -40_120_000
    expect(report.liabilitiesCents).toBe(-40_120_000);
    // Net worth = assets + liabilities
    expect(report.netWorthCents).toBe(3_950_000 + -40_120_000);

    // Subtotals
    expect(report.subtotals.cashCents).toBe(450_000 + 1_500_000); // 1_950_000
    expect(report.subtotals.savingsCents).toBe(2_000_000);
    expect(report.subtotals.cardsCents).toBe(-120_000);
    expect(report.subtotals.loansCents).toBe(-40_000_000);

    // Subtotals by type
    expect(report.subtotalsByType.transaction).toBe(450_000);
    expect(report.subtotalsByType.savings).toBe(2_000_000);
    expect(report.subtotalsByType.offset).toBe(1_500_000);
    expect(report.subtotalsByType.credit_card).toBe(-120_000);
    expect(report.subtotalsByType.home_loan).toBe(-40_000_000);

    // Accounts list length
    expect(report.accounts).toHaveLength(5);
  });

  it("strictly enforces partner privacy isolation", () => {
    const { sys, simonId, carissaId, simonCtx, carissaCtx, sharedJoint, privateAccount } =
      setupHousehold();

    const shared = sharedJoint("Everyday", "transaction");
    recordBalanceSnapshot(sys, {
      accountId: shared,
      asOf: "2026-10-01",
      balanceCents: 200_000,
    });

    const simonPrivate = privateAccount("Simon's Secret Stash", "savings", simonId);
    recordBalanceSnapshot(sys, {
      accountId: simonPrivate,
      asOf: "2026-10-01",
      balanceCents: 1_000_000,
    });

    const carissaPrivate = privateAccount("Carissa's Private Saver", "savings", carissaId);
    recordBalanceSnapshot(sys, {
      accountId: carissaPrivate,
      asOf: "2026-10-01",
      balanceCents: 500_000,
    });

    const simonReport = netWorth(simonCtx);
    const carissaReport = netWorth(carissaCtx);

    // Simon sees shared + simon's private
    expect(simonReport.accounts.map((a) => a.id)).toContain(shared);
    expect(simonReport.accounts.map((a) => a.id)).toContain(simonPrivate);
    expect(simonReport.accounts.map((a) => a.id)).not.toContain(carissaPrivate);
    expect(simonReport.netWorthCents).toBe(200_000 + 1_000_000);
    expect(simonReport.assetsCents).toBe(1_200_000);

    // Carissa sees shared + carissa's private
    expect(carissaReport.accounts.map((a) => a.id)).toContain(shared);
    expect(carissaReport.accounts.map((a) => a.id)).toContain(carissaPrivate);
    expect(carissaReport.accounts.map((a) => a.id)).not.toContain(simonPrivate);
    expect(carissaReport.netWorthCents).toBe(200_000 + 500_000);
    expect(carissaReport.assetsCents).toBe(700_000);

    // Neither leaks private names
    expect(JSON.stringify(simonReport)).not.toContain("Carissa's Private Saver");
    expect(JSON.stringify(carissaReport)).not.toContain("Simon's Secret Stash");
  });

  it("produces identical shared figures for both partners", () => {
    const { sys, simonCtx, carissaCtx, sharedJoint } = setupHousehold();

    const shared = sharedJoint("Joint Savings", "savings");
    recordBalanceSnapshot(sys, {
      accountId: shared,
      asOf: "2026-10-01",
      balanceCents: 800_000,
    });

    const simonReport = netWorth(simonCtx);
    const carissaReport = netWorth(carissaCtx);

    expect(simonReport.netWorthCents).toBe(800_000);
    expect(carissaReport.netWorthCents).toBe(800_000);
    expect(simonReport.subtotals.savingsCents).toBe(carissaReport.subtotals.savingsCents);
  });

  it("derives a 12-point month-end trend", () => {
    const { sys, simonCtx, sharedJoint } = setupHousehold();

    const saver = sharedJoint("Trend Saver", "savings");

    // Snapshots at various past month ends
    recordBalanceSnapshot(sys, {
      accountId: saver,
      asOf: "2025-11-30",
      balanceCents: 100_000,
    });
    recordBalanceSnapshot(sys, {
      accountId: saver,
      asOf: "2026-03-31",
      balanceCents: 250_000,
    });
    recordBalanceSnapshot(sys, {
      accountId: saver,
      asOf: "2026-09-30",
      balanceCents: 400_000,
    });
    recordBalanceSnapshot(sys, {
      accountId: saver,
      asOf: "2026-10-15",
      balanceCents: 420_000,
    });

    const report = netWorth(simonCtx, { asOf: "2026-10-15" });

    expect(report.trend).toHaveLength(12);

    // First point is 11 months before 2026-10: 2025-11-30
    expect(report.trend[0]?.date).toBe("2025-11-30");
    expect(report.trend[0]?.netWorthCents).toBe(100_000);

    // Point for 2026-03-31
    const marPoint = report.trend.find((p) => p.date === "2026-03-31");
    expect(marPoint).toBeDefined();
    expect(marPoint?.netWorthCents).toBe(250_000);

    // Point for 2026-09-30
    const sepPoint = report.trend.find((p) => p.date === "2026-09-30");
    expect(sepPoint).toBeDefined();
    expect(sepPoint?.netWorthCents).toBe(400_000);

    // 12th point uses asOf (2026-10-15)
    expect(report.trend[11]?.date).toBe("2026-10-15");
    expect(report.trend[11]?.netWorthCents).toBe(420_000);
    expect(report.trend[11]?.netWorthCents).toBe(report.netWorthCents);
  });

  it("handles zero accounts cleanly", () => {
    const { simonCtx } = setupHousehold();

    const report = netWorth(simonCtx);

    expect(report.accounts).toHaveLength(0);
    expect(report.netWorthCents).toBe(0);
    expect(report.assetsCents).toBe(0);
    expect(report.liabilitiesCents).toBe(0);
    expect(report.subtotals.cashCents).toBe(0);
    expect(report.subtotals.savingsCents).toBe(0);
    expect(report.subtotals.loansCents).toBe(0);
    expect(report.subtotals.cardsCents).toBe(0);
    expect(report.latestImport).toBeNull();
    expect(report.trend).toHaveLength(12);
    for (const point of report.trend) {
      expect(point.netWorthCents).toBe(0);
      expect(point.assetsCents).toBe(0);
      expect(point.liabilitiesCents).toBe(0);
    }
  });

  it("excludes accounts closed on or before asOf from live report, but includes them in historical trend when open", () => {
    const { sys, simonCtx, sharedJoint } = setupHousehold();

    const activeAccount = sharedJoint("Active Everyday", "transaction");
    recordBalanceSnapshot(sys, {
      accountId: activeAccount,
      asOf: "2026-06-01",
      balanceCents: 50_000,
    });

    const closedAccount = sharedJoint("Old Term Deposit", "savings");
    recordBalanceSnapshot(sys, {
      accountId: closedAccount,
      asOf: "2026-06-01",
      balanceCents: 100_000,
    });

    // Close the savings account on 2026-08-15
    closeAccount(sys, { id: closedAccount, closedOn: "2026-08-15" });

    const report = netWorth(simonCtx, { asOf: "2026-10-15" });

    // Live report at 2026-10-15 only lists the active account
    expect(report.accounts).toHaveLength(1);
    expect(report.accounts[0]?.id).toBe(activeAccount);
    expect(report.netWorthCents).toBe(50_000);
    expect(report.assetsCents).toBe(50_000);

    // Historical trend:
    // Before 2026-08-15 (e.g. 2026-06-30, 2026-07-31), closedAccount was open, so net worth = 150_000
    const junPoint = report.trend.find((p) => p.date === "2026-06-30");
    expect(junPoint?.netWorthCents).toBe(150_000);
    const julPoint = report.trend.find((p) => p.date === "2026-07-31");
    expect(julPoint?.netWorthCents).toBe(150_000);

    // After 2026-08-15 (e.g. 2026-08-31, 2026-09-30, 2026-10-15), closedAccount was closed, so net worth = 50_000
    const augPoint = report.trend.find((p) => p.date === "2026-08-31");
    expect(augPoint?.netWorthCents).toBe(50_000);
    const sepPoint = report.trend.find((p) => p.date === "2026-09-30");
    expect(sepPoint?.netWorthCents).toBe(50_000);
    const octPoint = report.trend.find((p) => p.date === "2026-10-15");
    expect(octPoint?.netWorthCents).toBe(50_000);
  });

  it("selects the newest import across accounts for latestImport", () => {
    const { sys, simonCtx, sharedJoint } = setupHousehold();

    const acct1 = sharedJoint("Account 1", "transaction");
    const acct2 = sharedJoint("Account 2", "savings");

    importStatement(sys, {
      accountId: acct1,
      format: "commbank_csv",
      content: 'Date,Amount,Description,Balance\n01/09/2026,-10.00,"Coffee",100.00',
    });

    importStatement(sys, {
      accountId: acct2,
      format: "commbank_csv",
      content: 'Date,Amount,Description,Balance\n20/09/2026,-50.00,"Interest",500.00',
    });

    const report = netWorth(simonCtx, { asOf: "2026-10-15" });

    expect(report.latestImport).not.toBeNull();
    // acct2 has newer through date (2026-09-20 vs 2026-09-01)
    expect(report.latestImport?.through).toBe("2026-09-20");
  });
});
