// Story 4.2: P&L, spending and merchants fold the one `flowBreakdown` (AD-23), on SQLite and in
// memory, per viewer.
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
import { createCategory, deleteCategory } from "../classify/categories.ts";
import { createCategoryGroup } from "../classify/category-groups.ts";
import { createPayee } from "../classify/payees.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createPerson } from "../identity/create-person.ts";
import { createTransaction } from "../ledger/create-transaction.ts";
import { hideTransactionName } from "../ledger/hide-name.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import { setSplitField } from "../ledger/set-split-field.ts";
import { createTransferGroup } from "../ledger/transfer-groups.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { cashFlowTotals } from "./cash-flow-totals.ts";
import { merchants } from "./merchants.ts";
import { profitAndLoss } from "./profit-and-loss.ts";
import { spending } from "./spending.ts";

const clock = manualClock("2026-09-27T00:00:00Z");
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-report-core-"));
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
  const joint = (name: string, type: "transaction" | "credit_card") =>
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
  const everyday = joint("Everyday", "transaction");
  const card = joint("Card", "credit_card");
  const privA = createAccount(sys, {
    name: "A savings",
    type: "savings",
    currency: "AUD",
    isPrivate: true,
    owners: [{ personId: a, shareBp: 10000 }],
  });
  const incomeGroup = createCategoryGroup(sys, { name: "Income", kind: "income" });
  const salary = createCategory(sys, { groupId: incomeGroup.id, name: "Salary" });
  const food = createCategoryGroup(sys, { name: "Food", kind: "expense" });
  const groceries = createCategory(sys, { groupId: food.id, name: "Groceries" });
  const eatingOut = createCategory(sys, { groupId: food.id, name: "Eating out" });
  const home = createCategoryGroup(sys, { name: "Home", kind: "expense" });
  const hardware = createCategory(sys, { groupId: home.id, name: "Hardware" });
  const shop = createPayee(as(a), { name: "Shop" });
  const cafe = createPayee(as(a), { name: "Cafe" });
  const aSecret = createPayee(as(a), { name: "A secret", originAccountId: privA });

  const add = (
    ctx: UseCaseContext,
    accountId: string,
    amountCents: number,
    opts: { categoryId?: string; payeeId?: string; postedOn?: string } = {},
  ) => {
    const id = createTransaction(ctx, {
      accountId,
      postedOn: opts.postedOn ?? "2026-09-10",
      amountCents,
      description: `t ${amountCents}`,
      payeeId: opts.payeeId ?? null,
    });
    if (opts.categoryId !== undefined) {
      const split = ctx.uow.read((r) => r.transactions.findVisible(ctx.viewer, id, "2026-09-27"))
        ?.splits[0];
      setSplitField(ctx, {
        transactionId: id,
        splitId: split?.id as string,
        field: "category",
        value: opts.categoryId,
      });
    }
    return id;
  };

  add(as(a), everyday, 500000, { categoryId: salary.id });
  add(as(b), everyday, -12000, { categoryId: groceries.id, payeeId: shop.id });
  add(as(b), everyday, 4000, { categoryId: groceries.id, payeeId: shop.id }); // refund
  add(as(b), card, -3000, { categoryId: eatingOut.id, payeeId: cafe.id });
  const hidden = add(as(a), everyday, -7000, { categoryId: eatingOut.id, payeeId: cafe.id });
  hideTransactionName(as(a), { id: hidden, until: "2026-12-31" });
  add(as(a), everyday, -6000, { categoryId: hardware.id });
  deleteCategory(sys, { id: hardware.id });
  add(as(b), everyday, -2500); // uncategorised, no payee
  createTransferGroup(as(a), {
    transactionIds: [add(as(a), everyday, -50000), add(as(a), card, 50000)],
  });
  add(as(a), everyday, -999, { postedOn: "2026-08-31" }); // outside the range

  return {
    a,
    b,
    as,
    sys,
    everyday,
    privA,
    add,
    ids: { incomeGroup, salary, food, groceries, eatingOut, home, hardware, shop, cafe, aSecret },
  };
}

describe.each([
  ["SQLite", () => createUnitOfWork(db)],
  ["memory", () => memoryUnitOfWork()],
] as const)("reports on %s", (_name, makeUow) => {
  it("P&L by group and category: totals equal cash flow, refund in income, deleted named", () => {
    const h = household(makeUow());
    const { ids } = h;
    for (const who of [h.a, h.b]) {
      const ctx = h.as(who);
      const flow = cashFlowTotals(ctx, SEPTEMBER);
      const byGroup = profitAndLoss(ctx, { ...SEPTEMBER, by: "group" });
      const byCategory = profitAndLoss(ctx, { ...SEPTEMBER, by: "category" });
      for (const pnl of [byGroup, byCategory]) {
        expect(pnl.income.totalCents).toBe(flow.moneyInCents);
        expect(pnl.expense.totalCents).toBe(flow.moneyOutCents);
        expect(pnl.uncategorised).toEqual({ inCents: 0, outCents: 2500 });
      }
      expect(byGroup.income.rows).toEqual([
        { id: ids.incomeGroup.id, name: "Income", cents: 500000 },
        { id: ids.food.id, name: "Food", cents: 4000 },
      ]);
      expect(byGroup.expense.rows).toEqual([
        { id: ids.food.id, name: "Food", cents: 22000 },
        { id: ids.home.id, name: "Home", cents: 6000 },
        { id: null, name: null, cents: 2500 },
      ]);
      expect(byCategory.expense.rows).toEqual([
        {
          id: ids.groceries.id,
          name: "Groceries",
          groupId: ids.food.id,
          groupName: "Food",
          cents: 12000,
        },
        {
          id: ids.eatingOut.id,
          name: "Eating out",
          groupId: ids.food.id,
          groupName: "Food",
          cents: 10000,
        },
        {
          id: ids.hardware.id,
          name: "Hardware",
          groupId: ids.home.id,
          groupName: "Home",
          cents: 6000,
        },
        { id: null, name: null, groupId: null, groupName: null, cents: 2500 },
      ]);
      expect(byCategory.income.rows[1]).toMatchObject({ id: ids.groceries.id, cents: 4000 });
      expect(spending(ctx, { ...SEPTEMBER, by: "category" })).toEqual({
        ...SEPTEMBER,
        by: "category",
        totalCents: flow.moneyOutCents,
        rows: byCategory.expense.rows,
      });
    }
  });

  it("merchants group by the projected payee: a hidden name falls into the null bucket", () => {
    const h = household(makeUow());
    const { ids } = h;
    const forB = merchants(h.as(h.b), { ...SEPTEMBER, flow: "expense" });
    expect(forB.rows).toEqual([
      { payeeId: null, payeeName: null, cents: 7000 + 6000 + 2500 },
      { payeeId: ids.shop.id, payeeName: "Shop", cents: 12000 },
      { payeeId: ids.cafe.id, payeeName: "Cafe", cents: 3000 },
    ]);
    expect(forB.totalCents).toBe(cashFlowTotals(h.as(h.b), SEPTEMBER).moneyOutCents);
    const forA = merchants(h.as(h.a), { ...SEPTEMBER, flow: "expense" });
    expect(forA.rows).toEqual([
      { payeeId: ids.shop.id, payeeName: "Shop", cents: 12000 },
      { payeeId: ids.cafe.id, payeeName: "Cafe", cents: 10000 },
      { payeeId: null, payeeName: null, cents: 6000 + 2500 },
    ]);
    expect(merchants(h.as(h.b), { ...SEPTEMBER, flow: "income" }).rows).toEqual([
      { payeeId: null, payeeName: null, cents: 500000 },
      { payeeId: ids.shop.id, payeeName: "Shop", cents: 4000 },
    ]);
  });

  it("gives B the same bytes whatever A does privately or hides", () => {
    const h = household(makeUow());
    const asB = h.as(h.b);
    const read = () =>
      JSON.stringify([
        profitAndLoss(asB, { ...SEPTEMBER, by: "group" }),
        profitAndLoss(asB, { ...SEPTEMBER, by: "category" }),
        spending(asB, { ...SEPTEMBER, by: "group" }),
        merchants(asB, { ...SEPTEMBER, flow: "expense" }),
        merchants(asB, { ...SEPTEMBER, flow: "income" }),
      ]);
    const before = read();
    const asA = h.as(h.a);
    h.add(asA, h.privA, 90000, { categoryId: h.ids.salary.id });
    h.add(asA, h.privA, -3300, { categoryId: h.ids.groceries.id, payeeId: h.ids.aSecret.id });
    h.add(asA, h.privA, -1200, { categoryId: h.ids.eatingOut.id });
    expect(read()).toBe(before);
    expect(JSON.stringify(merchants(asA, { ...SEPTEMBER, flow: "expense" }))).toContain("A secret");
  });

  it("breaks equal amounts by name, then id, with the null row last", () => {
    const h = household(makeUow());
    const { ids } = h;
    const bills = createCategoryGroup(h.sys, { name: "Bills", kind: "expense" });
    const power = createCategory(h.sys, { groupId: bills.id, name: "Power" });
    const asB = h.as(h.b);
    const on = { postedOn: "2026-08-15" };
    h.add(asB, h.everyday, -500, { ...on, categoryId: ids.groceries.id, payeeId: ids.shop.id });
    h.add(asB, h.everyday, -500, { ...on, categoryId: ids.eatingOut.id, payeeId: ids.cafe.id });
    h.add(asB, h.everyday, -500, { ...on, categoryId: power.id, payeeId: ids.shop.id });
    h.add(asB, h.everyday, -500, { ...on, categoryId: power.id, payeeId: ids.cafe.id });
    h.add(asB, h.everyday, -1000, on); // uncategorised, no payee
    const AUGUST = { from: "2026-08-01", to: "2026-08-30" };
    const order = (rows: readonly { id?: string | null; cents: number }[]) =>
      rows.map((r) => [r.id ?? null, r.cents]);
    expect(order(profitAndLoss(asB, { ...AUGUST, by: "group" }).expense.rows)).toEqual([
      [bills.id, 1000],
      [ids.food.id, 1000],
      [null, 1000],
    ]);
    expect(order(profitAndLoss(asB, { ...AUGUST, by: "category" }).expense.rows)).toEqual([
      [power.id, 1000],
      [null, 1000],
      [ids.eatingOut.id, 500],
      [ids.groceries.id, 500],
    ]);
    expect(
      merchants(asB, { ...AUGUST, flow: "expense" }).rows.map((r) => [r.payeeName, r.cents]),
    ).toEqual([
      ["Cafe", 1000],
      ["Shop", 1000],
      [null, 1000],
    ]);
  });

  it("refuses a missing or bad by, flow or range", () => {
    const h = household(makeUow());
    const asB = h.as(h.b);
    for (const bad of [
      { ...SEPTEMBER },
      { ...SEPTEMBER, by: "payee" },
      { from: "2026-09-30", to: "2026-09-01", by: "group" },
      { from: "2026-9-1", to: "2026-09-30", by: "group" },
      { ...SEPTEMBER, by: "group", extra: 1 },
    ]) {
      expect(() => profitAndLoss(asB, bad as never)).toThrow(AppError);
      expect(() => spending(asB, bad as never)).toThrow(AppError);
    }
    for (const bad of [
      { ...SEPTEMBER },
      { ...SEPTEMBER, flow: "transfer" },
      { from: "2026-09-30", to: "2026-09-01", flow: "income" },
    ]) {
      expect(() => merchants(asB, bad as never)).toThrow(AppError);
    }
  });
});
