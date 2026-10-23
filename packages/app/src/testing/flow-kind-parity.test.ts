// AD-23 parity: the one `flowKind` exists twice, as the pure `domain` function and as the SQL
// expression `flowKindSql` every aggregate composes. This builds each case of the story's I/O
// matrix (plus a deleted counterpart and a link to an account of another type) in SQLite, checks
// that the SQL class of every split equals the domain function's for each viewer, and that
// `cashFlowTotals` answers alike on SQLite and in memory.
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
  splitFlowKinds,
} from "@pangolin/db";
import { type FlowGroupKind, type FlowKind, flowKind } from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  type AccountRow,
  type AccountType,
  type DayRange,
  type SplitRow,
  type TransactionRow,
  type UnitOfWork,
} from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { memoryUnitOfWork } from "./memory-uow.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");
const T = "2026-09-27T00:00:00.000Z";
const TODAY = "2026-09-27";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-flow-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function ids() {
  let n = 0;
  return <B extends string>() => `01J0000000000000000000${String(++n).padStart(4, "0")}` as Id<B>;
}

/** A named account of the scenario; `each_<type>` is one public account per account type. */
type AccountKey = string;

const ACCOUNTS: Record<AccountKey, { type: AccountType; private: boolean }> = {
  everyday: { type: "transaction", private: false },
  card: { type: "credit_card", private: false },
  loan: { type: "home_loan", private: false },
  broker: { type: "brokerage", private: false },
  property: { type: "property", private: false },
  privA: { type: "savings", private: true },
  privABroker: { type: "brokerage", private: true },
  privALoan: { type: "home_loan", private: true },
  // One public account of every type, so every branch of the SQL CASE is reached.
  ...Object.fromEntries(ACCOUNT_TYPES.map((type) => [`each_${type}`, { type, private: false }])),
};

/** The account behind a key (every key the scenario uses is in `ACCOUNTS`). */
const accountOf = (key: AccountKey) => ACCOUNTS[key] as { type: AccountType; private: boolean };

type GroupKey = "income" | "expense" | "transfer";

/** One split as the test knows it, independently of either implementation. */
interface KnownSplit {
  readonly id: string;
  readonly txnKey: string;
  readonly account: AccountKey;
  readonly amountCents: number;
  readonly group: GroupKey | null;
  /** The account of the other live leg, or null when unlinked or the other leg is deleted. */
  readonly counterpart: AccountKey | null;
  readonly postedOn: string;
}

/** Builds the matrix in `uow` and returns what each split is, by the test's own account. */
function scenario(uow: UnitOfWork) {
  const newId = ids();
  const a = newId<"Person">();
  const b = newId<"Person">();
  const accountIds = {} as Record<AccountKey, Id<"Account">>;
  for (const key of Object.keys(ACCOUNTS) as AccountKey[]) accountIds[key] = newId<"Account">();
  const groups = {} as Record<GroupKey, Id<"CategoryGroup">>;
  const cats = {} as Record<GroupKey, Id<"Category">>;
  for (const g of ["income", "expense", "transfer"] as const) {
    groups[g] = newId<"CategoryGroup">();
    cats[g] = newId<"Category">();
  }
  /** A category in the transfer-kind group that is soft-deleted after a split uses it. */
  const deletedTransferCat = newId<"Category">();
  /** An expense category that is soft-deleted after a split uses it: still its own named row. */
  const deletedExpenseCat = newId<"Category">();
  /** A shared payee, and one scoped to A (which B never sees named). */
  const shopPayee = newId<"Payee">();
  const scopedPayee = newId<"Payee">();
  const known: KnownSplit[] = [];
  const txnIds: Record<string, Id<"Transaction">> = {};

  const own = (accountId: Id<"Account">, personId: Id<"Person">, shareBp: number) => ({
    accountId,
    personId,
    shareBp,
    createdAt: T,
    updatedAt: T,
  });
  const person = (id: Id<"Person">, name: string) => ({
    id,
    userId: null,
    displayName: name,
    colour: "#000000",
    createdAt: T,
    updatedAt: T,
    deletedAt: null,
  });

  uow.transaction((r) => {
    r.person.insert(person(a, "A"));
    r.person.insert(person(b, "B"));
    for (const [key, def] of Object.entries(ACCOUNTS) as [
      AccountKey,
      (typeof ACCOUNTS)[AccountKey],
    ][]) {
      const row: AccountRow = {
        id: accountIds[key] as Id<"Account">,
        name: key,
        type: def.type,
        currency: "AUD",
        isPrivate: def.private,
        institutionId: null,
        openedOn: null,
        closedOn: null,
        isSavings: false,
        createdAt: T,
        updatedAt: T,
      };
      r.accounts.insert(
        row,
        def.private ? [own(row.id, a, 10000)] : [own(row.id, a, 5000), own(row.id, b, 5000)],
      );
    }
    for (const [i, g] of (["income", "expense", "transfer"] as const).entries()) {
      r.categoryGroups.insert({
        id: groups[g],
        name: `Group ${g}`,
        kind: g,
        sort: i,
        createdAt: T,
        updatedAt: T,
      });
      r.categories.insert({
        id: cats[g],
        groupId: groups[g],
        name: `Cat ${g}`,
        isFixedCost: false,
        createdAt: T,
        updatedAt: T,
      });
    }
    r.categories.insert({
      id: deletedTransferCat,
      groupId: groups.transfer,
      name: "Cat deleted transfer",
      isFixedCost: false,
      createdAt: T,
      updatedAt: T,
    });
    r.categories.insert({
      id: deletedExpenseCat,
      groupId: groups.expense,
      name: "Cat deleted expense",
      isFixedCost: false,
      createdAt: T,
      updatedAt: T,
    });
    const payeeRow = (id: Id<"Payee">, name: string, scopePersonId: Id<"Person"> | null) => ({
      id,
      name,
      websiteUrl: null,
      logoAttachmentId: null,
      defaultCategoryId: null,
      scopePersonId,
      createdAt: T,
      updatedAt: T,
    });
    r.payees.insert(payeeRow(shopPayee, "Shop", null), null);
    r.payees.insert(payeeRow(scopedPayee, "A's corner shop", a), accountIds.privA as Id<"Account">);
  });

  let n = 0;
  /** Inserts one transaction with its splits; returns its id. */
  const add = (
    r: Parameters<Parameters<UnitOfWork["transaction"]>[0]>[0],
    key: string,
    account: AccountKey,
    splits: readonly {
      amountCents: number;
      group: GroupKey | null;
      deletedCategory?: true;
      deletedExpense?: true;
    }[],
    over: Partial<TransactionRow> = {},
  ) => {
    n++;
    const id = newId<"Transaction">();
    txnIds[key] = id;
    const amountCents = splits.reduce((sum, s) => sum + s.amountCents, 0);
    const row: TransactionRow = {
      id,
      accountId: accountIds[account] as Id<"Account">,
      postedOn: "2026-09-10",
      amountCents,
      descriptionRaw: key,
      payeeId: null,
      status: "posted",
      externalId: null,
      fingerprint: `fp:${n}`,
      fingerprintVersion: 1,
      importId: null,
      performedBy: null,
      transferGroupId: null,
      needsReview: false,
      isHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      notes: null,
      createdAt: T,
      updatedAt: T,
      ...over,
    };
    const rows: SplitRow[] = splits.map((s) => ({
      id: newId<"Split">(),
      transactionId: id,
      amountCents: s.amountCents,
      categoryId:
        s.deletedCategory === true
          ? deletedTransferCat
          : s.deletedExpense === true
            ? deletedExpenseCat
            : s.group === null
              ? null
              : cats[s.group],
      activityId: null,
      beneficiary: "shared",
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: T,
      updatedAt: T,
    }));
    r.transactions.insert(row, rows);
    return rows.map((s, i) => ({
      id: s.id,
      txnKey: key,
      account,
      amountCents: s.amountCents,
      group: splits[i]?.group ?? null,
      postedOn: row.postedOn,
    }));
  };

  /** A linked pair: `from` gets `-amount`, `to` gets `+amount`. */
  const pair = (
    r: Parameters<Parameters<UnitOfWork["transaction"]>[0]>[0],
    key: string,
    from: AccountKey,
    to: AccountKey,
    amount: number,
    opts: { fromGroup?: GroupKey | null; toGroup?: GroupKey | null; deleteTo?: boolean } = {},
  ) => {
    const group = newId<"TransferGroup">();
    r.transferGroups.insert({ id: group, matchedBy: "manual", createdAt: T, updatedAt: T });
    const out = add(
      r,
      `${key}.out`,
      from,
      [{ amountCents: -amount, group: opts.fromGroup ?? null }],
      {
        transferGroupId: group,
      },
    );
    const inn = add(r, `${key}.in`, to, [{ amountCents: amount, group: opts.toGroup ?? null }], {
      transferGroupId: group,
    });
    if (opts.deleteTo === true) {
      r.transactions.softDelete(systemViewer("cli:test"), txnIds[`${key}.in`] as string, T);
      for (const s of out) known.push({ ...s, counterpart: null });
      return;
    }
    for (const s of out) known.push({ ...s, counterpart: to });
    for (const s of inn) known.push({ ...s, counterpart: from });
  };
  const single = (
    r: Parameters<Parameters<UnitOfWork["transaction"]>[0]>[0],
    key: string,
    account: AccountKey,
    splits: Parameters<typeof add>[3],
    over: Partial<TransactionRow> = {},
  ) => {
    for (const s of add(r, key, account, splits, over)) known.push({ ...s, counterpart: null });
  };

  uow.transaction((r) => {
    // The I/O matrix.
    pair(r, "cardRepayment", "everyday", "card", 50000);
    pair(r, "loanRepayment", "everyday", "loan", 200000);
    pair(r, "intoBrokerage", "everyday", "broker", 100000);
    pair(r, "toPrivateSavings", "everyday", "privA", 70000);
    pair(r, "toPrivateBroker", "everyday", "privABroker", 80000, { fromGroup: "expense" });
    pair(r, "toPrivateLoan", "everyday", "privALoan", 90000);
    single(r, "unlinkedTransfer", "everyday", [{ amountCents: 30000, group: "transfer" }]);
    single(r, "refund", "everyday", [{ amountCents: 4000, group: "expense" }]);
    single(r, "uncategorised", "everyday", [{ amountCents: -2500, group: null }]);
    // A counterpart that is deleted, and one of another type, fall through to category and sign.
    pair(r, "deletedCounterpart", "everyday", "card", 6000, { deleteTo: true });
    pair(r, "otherType", "everyday", "property", 9000, { toGroup: "transfer" });
    // A loan redraw: money in from the home loan is a transfer, in neither total.
    pair(r, "loanRedraw", "loan", "everyday", 1500);
    // One link from Everyday to an account of every type: each CASE branch, both signs.
    for (const type of ACCOUNT_TYPES) pair(r, `each.${type}`, "everyday", `each_${type}`, 1100);
    // A split in a transfer-kind category that is then soft-deleted: still a transfer.
    single(r, "deletedCategory", "everyday", [
      { amountCents: 2200, group: "transfer", deletedCategory: true },
    ]);
    // Salary, a zero split, a pending row, a two-split row and a row in A's private account.
    single(r, "salary", "everyday", [{ amountCents: 500000, group: "income" }]);
    single(r, "zero", "everyday", [{ amountCents: 0, group: "expense" }]);
    single(r, "pending", "card", [{ amountCents: -1234, group: "expense" }], { status: "pending" });
    single(r, "twoSplits", "card", [
      { amountCents: -3000, group: "expense" },
      { amountCents: 1000, group: "income" },
    ]);
    single(r, "privateSpend", "privA", [{ amountCents: -4321, group: "expense" }]);
    // Payees: a shared one, the same one on a row A hid from B, A's scoped one on a shared row
    // (B sees no payee), and a split in an expense category that is then deleted.
    single(r, "shopShared", "everyday", [{ amountCents: -1500, group: "expense" }], {
      payeeId: shopPayee,
    });
    single(r, "shopHidden", "everyday", [{ amountCents: -1600, group: "expense" }], {
      payeeId: shopPayee,
      nameHiddenBy: a,
      nameHiddenUntil: "2026-12-31",
    });
    single(r, "scopedPayee", "everyday", [{ amountCents: -1700, group: "expense" }], {
      payeeId: scopedPayee,
    });
    single(r, "privateShop", "privA", [{ amountCents: -1900, group: "expense" }], {
      payeeId: scopedPayee,
    });
    single(r, "deletedExpense", "everyday", [
      { amountCents: -1800, group: "expense", deletedExpense: true },
    ]);
    // A 0-cent split alone in its (kind, category, payee): no breakdown row at all.
    single(
      r,
      "zeroAlone",
      "everyday",
      [{ amountCents: 0, group: "expense", deletedExpense: true }],
      {
        payeeId: shopPayee,
      },
    );
    single(r, "hiddenRefund", "everyday", [{ amountCents: 1100, group: "expense" }], {
      payeeId: shopPayee,
      nameHiddenBy: a,
      nameHiddenUntil: "2026-12-31",
    });
    r.categories.softDelete(deletedTransferCat, T);
    r.categories.softDelete(deletedExpenseCat, T);
    // Outside the September range.
    single(r, "august", "everyday", [{ amountCents: -7777, group: null }], {
      postedOn: "2026-08-31",
    });
    single(r, "october", "everyday", [{ amountCents: 8888, group: "income" }], {
      postedOn: "2026-10-01",
    });
  });

  const viewers: Record<string, Viewer> = {
    A: personViewer(a, now),
    B: personViewer(b, now),
    system: systemViewer("cli:test"),
  };
  return {
    known,
    viewers,
    txnIds,
    ids: { shopPayee, scopedPayee, deletedExpenseCat, expenseCat: cats.expense },
  };
}

/** Whether `viewer` (by name) may see account `key`. */
const sees = (who: string, key: AccountKey) => who !== "B" || !accountOf(key).private;

/** The domain `flowKind` of a known split for one viewer. */
function expectedKind(who: string, s: KnownSplit): FlowKind {
  const counterpart =
    s.counterpart === null
      ? null
      : sees(who, s.counterpart)
        ? accountOf(s.counterpart).type
        : ("hidden" as const);
  return flowKind({
    amountCents: s.amountCents,
    counterpart,
    groupKind: s.group as FlowGroupKind | null,
  });
}

const SEPTEMBER: DayRange = { from: "2026-09-01", to: "2026-09-30" };
const RANGES: Record<string, DayRange> = {
  september: SEPTEMBER,
  oneDay: { from: "2026-09-10", to: "2026-09-10" },
  wide: { from: "2026-01-01", to: "2026-12-31" },
  empty: { from: "2025-01-01", to: "2025-01-31" },
};

describe("flowKind parity (AD-23)", () => {
  it("classes every split in SQL exactly as the domain function does, for each viewer", () => {
    const { known, viewers, txnIds } = scenario(createUnitOfWork(db));
    for (const [who, viewer] of Object.entries(viewers)) {
      const sql = splitFlowKinds(db, viewer, TODAY);
      const visible = known.filter((s) => sees(who, s.account));
      expect(Object.keys(sql).sort(), who).toEqual(visible.map((s) => s.id).sort());
      for (const s of visible) {
        expect(sql[s.id], `${who} ${s.txnKey}`).toBe(expectedKind(who, s));
      }
    }
    // The matrix, spelled out.
    const kindOf = (who: string, txnKey: string) => {
      const viewer = viewers[who] as Viewer;
      const split = known.find((s) => s.txnKey === txnKey) as KnownSplit;
      expect(txnIds[txnKey]).toBeDefined();
      return splitFlowKinds(db, viewer, TODAY)[split.id];
    };
    for (const who of ["A", "B"]) {
      expect(kindOf(who, "cardRepayment.out")).toBe("transfer");
      expect(kindOf(who, "cardRepayment.in")).toBe("transfer");
      expect(kindOf(who, "loanRepayment.out")).toBe("expense");
      expect(kindOf(who, "loanRepayment.in")).toBe("transfer");
      expect(kindOf(who, "intoBrokerage.out")).toBe("investing");
      expect(kindOf(who, "unlinkedTransfer")).toBe("transfer");
      expect(kindOf(who, "refund")).toBe("income");
      expect(kindOf(who, "uncategorised")).toBe("expense");
      expect(kindOf(who, "deletedCounterpart.out")).toBe("expense");
      expect(kindOf(who, "otherType.out")).toBe("expense");
      expect(kindOf(who, "otherType.in")).toBe("transfer");
      expect(kindOf(who, "loanRedraw.in")).toBe("transfer");
      expect(kindOf(who, "loanRedraw.out")).toBe("transfer");
      expect(kindOf(who, "deletedCategory")).toBe("transfer");
      expect(kindOf(who, "each.home_loan.out")).toBe("expense");
      expect(kindOf(who, "each.super.out")).toBe("investing");
      expect(kindOf(who, "each.offset.out")).toBe("transfer");
      expect(kindOf(who, "each.vehicle.out")).toBe("expense");
    }
    // A's private counterpart is a transfer for B whatever its type; A sees the real type.
    expect(kindOf("B", "toPrivateBroker.out")).toBe("transfer");
    expect(kindOf("A", "toPrivateBroker.out")).toBe("investing");
    expect(kindOf("B", "toPrivateLoan.out")).toBe("transfer");
    expect(kindOf("A", "toPrivateLoan.out")).toBe("expense");
    expect(kindOf("B", "toPrivateSavings.out")).toBe("transfer");
  });

  it("totals cash flow alike on SQLite and in memory, as a sum of the domain classes", () => {
    const sqlite = scenario(createUnitOfWork(db));
    const memoryUow = memoryUnitOfWork();
    const memory = scenario(memoryUow);
    const sqliteUow = createUnitOfWork(db);
    for (const [who, viewer] of Object.entries(sqlite.viewers)) {
      for (const [name, range] of Object.entries(RANGES)) {
        const fromSql = sqliteUow.read((r) => r.transactions.cashFlowTotals(viewer, TODAY, range));
        const fromMemory = memoryUow.read((r) =>
          r.transactions.cashFlowTotals(memory.viewers[who] as Viewer, TODAY, range),
        );
        expect(fromSql, `${who} ${name}`).toEqual(fromMemory);
        let moneyIn = 0;
        let moneyOut = 0;
        for (const s of sqlite.known) {
          if (!sees(who, s.account) || s.postedOn < range.from || s.postedOn > range.to) continue;
          const kind = expectedKind(who, s);
          if (kind === "income") moneyIn += s.amountCents;
          if (kind === "expense") moneyOut -= s.amountCents;
        }
        expect(fromSql, `${who} ${name}`).toEqual({
          moneyInCents: moneyIn,
          moneyOutCents: moneyOut || 0,
          keptCents: moneyIn - moneyOut || 0,
        });
      }
    }
    const b = sqlite.viewers.B as Viewer;
    expect(
      sqliteUow.read((r) => r.transactions.cashFlowTotals(b, TODAY, RANGES.empty as DayRange)),
    ).toEqual({
      moneyInCents: 0,
      moneyOutCents: 0,
      keptCents: 0,
    });
    // September for B. In: salary 500000 + refund 4000 + the income half of two splits 1000.
    // Out: loan 200000 + uncategorised 2500 + deleted counterpart 6000 + the everyday side of the
    // property link 9000 + pending 1234 + the expense half of two splits 3000 + the Everyday side
    // of the per-type links to home_loan, property, vehicle and other (4 × 1100). The redraw and
    // the deleted-category split count in neither. The payee rows add 1100 in (the hidden refund)
    // and 6600 out (shop, hidden shop, scoped payee and the deleted expense category).
    expect(sqliteUow.read((r) => r.transactions.cashFlowTotals(b, TODAY, SEPTEMBER))).toEqual({
      moneyInCents: 505000 + 1100,
      moneyOutCents: 226134 + 6600,
      keptCents: 505000 + 1100 - (226134 + 6600),
    });
  });

  it("breaks flows down alike on SQLite and in memory, summing to the cash-flow totals", () => {
    const sqlite = scenario(createUnitOfWork(db));
    const memoryUow = memoryUnitOfWork();
    const memory = scenario(memoryUow);
    const sqliteUow = createUnitOfWork(db);
    for (const [who, viewer] of Object.entries(sqlite.viewers)) {
      for (const [name, range] of Object.entries(RANGES)) {
        const fromSql = sqliteUow.read((r) => r.transactions.flowBreakdown(viewer, TODAY, range));
        const fromMemory = memoryUow.read((r) =>
          r.transactions.flowBreakdown(memory.viewers[who] as Viewer, TODAY, range),
        );
        expect(fromSql, `${who} ${name}`).toEqual(fromMemory);
        const totals = sqliteUow.read((r) => r.transactions.cashFlowTotals(viewer, TODAY, range));
        const sum = (kind: string) =>
          fromSql.filter((row) => row.kind === kind).reduce((n, row) => n + row.cents, 0);
        expect(sum("income"), `${who} ${name}`).toBe(totals.moneyInCents);
        expect(sum("expense"), `${who} ${name}`).toBe(totals.moneyOutCents);
        // A 0-cent split never makes a row.
        expect(
          fromSql.filter((row) => row.cents === 0),
          `${who} ${name}`,
        ).toEqual([]);
        // One row per kind, category and payee.
        const keys = fromSql.map((row) => `${row.kind}|${row.categoryId}|${row.payeeId}`);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
    const { ids } = sqlite;
    const rows = (who: string) =>
      sqliteUow.read((r) =>
        r.transactions.flowBreakdown(sqlite.viewers[who] as Viewer, TODAY, SEPTEMBER),
      );
    const find = (who: string, kind: string, categoryId: string | null, payeeId: string | null) =>
      rows(who).find(
        (row) => row.kind === kind && row.categoryId === categoryId && row.payeeId === payeeId,
      );
    // A sees the shop on the hidden rows; B sees the shared row only.
    expect(find("A", "expense", ids.expenseCat, ids.shopPayee)?.cents).toBe(1500 + 1600);
    expect(find("A", "income", ids.expenseCat, ids.shopPayee)?.cents).toBe(1100);
    expect(find("B", "expense", ids.expenseCat, ids.shopPayee)?.cents).toBe(1500);
    expect(find("B", "income", ids.expenseCat, ids.shopPayee)).toBeUndefined();
    // B's null payee holds the hidden row, the scoped-payee row and every payee-less expense.
    expect(find("B", "income", ids.expenseCat, null)?.cents).toBe(4000 + 1100);
    expect(find("B", "expense", ids.expenseCat, null)?.cents).toBe(
      // A's null payee also holds A's private spend (4321), which B never sees.
      (find("A", "expense", ids.expenseCat, null)?.cents ?? 0) - 4321 + 1600 + 1700,
    );
    expect(find("A", "expense", ids.expenseCat, ids.scopedPayee)?.cents).toBe(1700 + 1900);
    for (const row of rows("B")) {
      expect(row.payeeId).not.toBe(ids.scopedPayee);
      expect(row.payeeName).not.toBe("A's corner shop");
      if (row.payeeId === null) expect(row.payeeName).toBeNull();
    }
    // A deleted category is still its own named row; uncategorised has no category or group.
    expect(find("B", "expense", ids.deletedExpenseCat, null)).toMatchObject({
      categoryName: "Cat deleted expense",
      groupName: "Group expense",
      cents: 1800,
    });
    expect(find("B", "expense", null, null)).toMatchObject({
      groupId: null,
      groupName: null,
      categoryName: null,
    });
    expect(find("A", "expense", ids.deletedExpenseCat, ids.shopPayee)).toBeUndefined();
    // Transfers and investing appear nowhere.
    for (const row of rows("A")) expect(["income", "expense"]).toContain(row.kind);
  });

  it("throws without a viewer", () => {
    const uow = createUnitOfWork(db);
    expect(() =>
      uow.read((r) =>
        r.transactions.cashFlowTotals(undefined as unknown as Viewer, TODAY, SEPTEMBER),
      ),
    ).toThrow(/viewer/);
    expect(() => splitFlowKinds(db, undefined as unknown as Viewer, TODAY)).toThrow(/viewer/);
    expect(() =>
      uow.read((r) =>
        r.transactions.flowBreakdown(undefined as unknown as Viewer, TODAY, SEPTEMBER),
      ),
    ).toThrow(/viewer/);
  });
});
