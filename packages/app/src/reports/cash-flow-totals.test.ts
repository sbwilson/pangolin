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
import { createAccount } from "../accounts/create-account.ts";
import { createCategory } from "../classify/categories.ts";
import { createCategoryGroup } from "../classify/category-groups.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createPerson } from "../identity/create-person.ts";
import { createTransaction } from "../ledger/create-transaction.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import { setSplitField } from "../ledger/set-split-field.ts";
import { createTransferGroup } from "../ledger/transfer-groups.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { cashFlowTotals } from "./cash-flow-totals.ts";

const clock = manualClock("2026-09-27T00:00:00Z");
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-cash-flow-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function household(uow: UnitOfWork) {
  registerTransactionNeedsReviewSync();
  const newId = sequentialIds();
  const ctxOf = (viewer: Viewer): UseCaseContext => ({ viewer, clock, newId, uow });
  const sys = ctxOf(systemViewer("cli:test"));
  const a = createPerson(sys, { displayName: "A", colour: "#000000" });
  const b = createPerson(sys, { displayName: "B", colour: "#ffffff" });
  const as = (id: Id<"Person">) => ctxOf(personViewer(id, clock.now()));
  const joint = (name: string, type: "transaction" | "credit_card" | "home_loan") =>
    createAccount(sys, {
      name,
      type,
      currency: "AUD",
      isPrivate: false,
      owners: [
        { personId: a, shareBp: 5000 },
        { personId: b, shareBp: 5000 },
      ],
    });
  const mine = (name: string, type: "savings" | "brokerage") =>
    createAccount(sys, {
      name,
      type,
      currency: "AUD",
      isPrivate: true,
      owners: [{ personId: a, shareBp: 10000 }],
    });
  const everyday = joint("Everyday", "transaction");
  const card = joint("Card", "credit_card");
  const loan = joint("Loan", "home_loan");
  const privA = mine("A savings", "savings");
  const income = createCategoryGroup(sys, { name: "Income", kind: "income" });
  const salary = createCategory(sys, { groupId: income.id, name: "Salary" });
  const spend = createCategoryGroup(sys, { name: "Food", kind: "expense" });
  const groceries = createCategory(sys, { groupId: spend.id, name: "Groceries" });

  const add = (
    ctx: UseCaseContext,
    accountId: string,
    amountCents: number,
    postedOn = "2026-09-10",
  ) =>
    createTransaction(ctx, { accountId, postedOn, amountCents, description: `t ${amountCents}` });
  const categorise = (ctx: UseCaseContext, transactionId: string, categoryId: string) => {
    const split = ctx.uow.read((r) =>
      r.transactions.findVisible(ctx.viewer, transactionId, "2026-09-27"),
    )?.splits[0];
    setSplitField(ctx, {
      transactionId,
      splitId: split?.id as string,
      field: "category",
      value: categoryId,
    });
  };
  const link = (ctx: UseCaseContext, out: string, inn: string) =>
    createTransferGroup(ctx, { transactionIds: [out, inn] });

  // Shared data both partners see.
  const pay = add(as(a), everyday, 500000);
  categorise(as(a), pay, salary.id);
  const shop = add(as(b), everyday, -12000);
  categorise(as(b), shop, groceries.id);
  add(as(b), everyday, -2500); // uncategorised
  link(as(a), add(as(a), everyday, -50000), add(as(a), card, 50000)); // card repayment
  link(as(a), add(as(a), everyday, -200000), add(as(a), loan, 200000)); // loan repayment
  // A shared row A linked to A's private savings: a transfer for both.
  link(as(a), add(as(a), everyday, -70000), add(as(a), privA, 70000));
  add(as(a), everyday, -999, "2026-08-31"); // outside the range

  return { a, b, as, sys, everyday, privA, salary, groceries, add, categorise, link, mine };
}

describe.each([
  ["SQLite", () => createUnitOfWork(db)],
  ["memory", () => memoryUnitOfWork()],
] as const)("reports.cashFlowTotals on %s", (_name, makeUow) => {
  it("totals money in, money out and kept by flowKind for each partner", () => {
    const h = household(makeUow());
    // Out: groceries 12000 + uncategorised 2500 + loan 200000. Transfers count in neither.
    const shared = { moneyInCents: 500000, moneyOutCents: 214500, keptCents: 285500 };
    expect(cashFlowTotals(h.as(h.b), SEPTEMBER)).toEqual({ ...SEPTEMBER, ...shared });
    expect(cashFlowTotals(h.as(h.a), SEPTEMBER)).toEqual({ ...SEPTEMBER, ...shared });
    // A's private spend counts for A only.
    h.add(h.as(h.a), h.privA, -4000);
    expect(cashFlowTotals(h.as(h.a), SEPTEMBER)).toMatchObject({ moneyOutCents: 218500 });
    expect(cashFlowTotals(h.as(h.b), SEPTEMBER)).toEqual({ ...SEPTEMBER, ...shared });
    // Kept may be negative.
    expect(cashFlowTotals(h.as(h.b), { from: "2026-08-31", to: "2026-08-31" })).toEqual({
      from: "2026-08-31",
      to: "2026-08-31",
      moneyInCents: 0,
      moneyOutCents: 999,
      keptCents: -999,
    });
  });

  it("gives B the same answer whatever A does in A's private accounts", () => {
    const h = household(makeUow());
    const before = JSON.stringify(cashFlowTotals(h.as(h.b), SEPTEMBER));
    const asA = h.as(h.a);
    const broker = h.mine("A broker", "brokerage");
    const bonus = h.add(asA, h.privA, 90000);
    h.categorise(asA, bonus, h.salary.id);
    const lunch = h.add(asA, h.privA, -3300);
    h.categorise(asA, lunch, h.groceries.id);
    h.link(asA, h.add(asA, h.privA, -10000), h.add(asA, broker, 10000));
    h.add(asA, broker, -1);
    expect(JSON.stringify(cashFlowTotals(h.as(h.b), SEPTEMBER))).toBe(before);
    expect(JSON.stringify(cashFlowTotals(asA, SEPTEMBER))).not.toBe(before);
  });

  it("refuses a range that is backwards or not YYYY-MM-DD", () => {
    const h = household(makeUow());
    const asB = h.as(h.b);
    for (const bad of [
      { from: "2026-09-30", to: "2026-09-01" },
      { from: "2026-9-1", to: "2026-09-30" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-09-01" },
      { from: "2026-09-01", to: "2026-09-30", extra: 1 },
    ]) {
      expect(() => cashFlowTotals(asB, bad as never)).toThrow(AppError);
    }
    expect(cashFlowTotals(asB, { from: "2026-09-10", to: "2026-09-10" }).from).toBe("2026-09-10");
  });
});
