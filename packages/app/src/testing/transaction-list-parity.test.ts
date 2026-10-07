// The transaction list repositories (`listPage`, `summarise`, `countBefore`, `dayNets`) on real
// SQLite and on the in-memory unit of work, which must answer alike: keyset and offset paging, every
// filter, and what another person's private rows, scoped payee or tag and hidden name do to them.
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
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { personViewer, type Viewer } from "../index.ts";
import type {
  AccountRow,
  SplitRow,
  TransactionCursor,
  TransactionFilter,
  TransactionPageAt,
  TransactionRow,
  UnitOfWork,
} from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { memoryUnitOfWork } from "./memory-uow.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");
const T = "2026-09-27T00:00:00.000Z";
const TODAY = "2026-09-27";
const SIZE = 50;

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-list-"));
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

const cursorOf = (row: { postedOn: string; id: string }): TransactionCursor => ({
  postedOn: row.postedOn,
  id: row.id,
});

/** What the scenario builds and what it asks of each viewer. */
function scenario(uow: UnitOfWork) {
  const newId = ids();
  const a = newId<"Person">();
  const b = newId<"Person">();
  const asA = personViewer(a, now);
  const asB = personViewer(b, now);
  const system: Viewer = systemViewer("cli:test");
  const shared = newId<"Account">();
  const otherShared = newId<"Account">();
  const privA = newId<"Account">();
  const privB = newId<"Account">();
  const group = newId<"CategoryGroup">();
  const cats = [newId<"Category">(), newId<"Category">()] as const;
  const payeeShared = newId<"Payee">();
  const payeeA = newId<"Payee">();
  const tagShared = newId<"Tag">();
  const tagA = newId<"Tag">();
  const transfer = newId<"TransferGroup">();

  const account = (id: Id<"Account">, isPrivate: boolean): AccountRow => ({
    id,
    name: id,
    type: "transaction",
    currency: "AUD",
    isPrivate,
    institutionId: null,
    openedOn: null,
    closedOn: null,
    isSavings: false,
    createdAt: T,
    updatedAt: T,
  });
  const txn = (accountId: Id<"Account">, n: number, over: Partial<TransactionRow>) =>
    ({
      id: newId<"Transaction">(),
      accountId,
      postedOn: "2026-08-01",
      amountCents: -100 * n,
      descriptionRaw: `row ${n}`,
      payeeId: null,
      status: "posted",
      externalId: null,
      fingerprint: `fp:${accountId}:${n}`,
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
    }) satisfies TransactionRow;
  const split = (
    transactionId: Id<"Transaction">,
    amountCents: number,
    categoryId: Id<"Category"> | null,
  ): SplitRow => ({
    id: newId<"Split">(),
    transactionId,
    amountCents,
    categoryId,
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

  const own = (accountId: Id<"Account">, personId: Id<"Person">, share = 10000) => ({
    accountId,
    personId,
    shareBp: share,
    createdAt: T,
    updatedAt: T,
  });
  uow.transaction((r) => {
    r.person.insert(person(a, "A"));
    r.person.insert(person(b, "B"));
    r.accounts.insert(account(shared, false), [own(shared, a, 5000), own(shared, b, 5000)]);
    r.accounts.insert(account(otherShared, false), [
      own(otherShared, a, 5000),
      own(otherShared, b, 5000),
    ]);
    r.accounts.insert(account(privA, true), [own(privA, a)]);
    r.accounts.insert(account(privB, true), [own(privB, b)]);
    r.categoryGroups.insert({
      id: group,
      name: "Food",
      kind: "expense",
      sort: 1,
      createdAt: T,
      updatedAt: T,
    });
    for (const [i, id] of cats.entries()) {
      r.categories.insert({
        id,
        groupId: group,
        name: `Cat ${i}`,
        isFixedCost: false,
        createdAt: T,
        updatedAt: T,
      });
    }
    const payee = (id: Id<"Payee">, name: string, scope: Id<"Person"> | null) => ({
      id,
      name,
      websiteUrl: null,
      logoAttachmentId: null,
      defaultCategoryId: null,
      scopePersonId: scope,
      createdAt: T,
      updatedAt: T,
    });
    r.payees.insert(payee(payeeShared, "Shop", null), null);
    r.payees.insert(payee(payeeA, "Secret shop", a), privA);
    const tag = (id: Id<"Tag">, name: string, scope: Id<"Person"> | null) => ({
      id,
      name,
      scopePersonId: scope,
      createdAt: T,
      updatedAt: T,
    });
    r.tags.insert(tag(tagShared, "trip", null), null);
    r.tags.insert(tag(tagA, "gift", a), privA);
    r.transferGroups.insert({ id: transfer, matchedBy: "manual", createdAt: T, updatedAt: T });
  });

  // 120 rows in the shared account over 30 days (four a day, so `id` breaks ties): money in on
  // every fifth, a category on two of three, a payee on every seventh, a tag on every ninth.
  const sharedIds: Id<"Transaction">[] = [];
  uow.transaction((r) => {
    for (let n = 1; n <= 120; n++) {
      const day = String(1 + ((n - 1) % 30)).padStart(2, "0");
      const amount = n % 5 === 0 ? 1000 * n : -100 * n;
      const t = txn(shared, n, {
        postedOn: `2026-08-${day}`,
        amountCents: amount,
        payeeId: n % 7 === 0 ? payeeShared : null,
        transferGroupId: n === 12 ? transfer : null,
      });
      sharedIds.push(t.id);
      const category = n % 3 === 0 ? null : (cats[n % 2] as Id<"Category">);
      const s = split(t.id, amount, category);
      r.transactions.insert(t, [s]);
      if (n % 9 === 0) r.tags.replaceForSplit(system, s.id, [tagShared], T);
    }
  });
  // A's private account: a scoped payee and tag; one two-split row with one uncategorised half.
  const privateRows: Id<"Transaction">[] = [];
  uow.transaction((r) => {
    for (let n = 1; n <= 6; n++) {
      const t = txn(privA, 200 + n, {
        postedOn: "2026-08-15",
        amountCents: -50 * n,
        payeeId: payeeA,
      });
      privateRows.push(t.id);
      const s = split(t.id, -50 * n, null);
      r.transactions.insert(t, [s]);
      r.tags.replaceForSplit(system, s.id, [tagA], T);
    }
    const t = txn(privB, 300, { postedOn: "2026-08-15", amountCents: -999 });
    r.transactions.insert(t, [split(t.id, -999, null)]);
    const two = txn(otherShared, 301, { postedOn: "2026-09-02", amountCents: -400 });
    r.transactions.insert(two, [split(two.id, -250, cats[0]), split(two.id, -150, null)]);
    // A hides the name of a shared row, with A's scoped payee on it.
    const hidden = txn(otherShared, 302, {
      postedOn: "2026-09-02",
      amountCents: -777,
      payeeId: payeeA,
      nameHiddenBy: a,
      nameHiddenUntil: "2027-01-01T00:00:00.000Z",
    });
    r.transactions.insert(hidden, [split(hidden.id, -777, cats[1])]);
  });

  const out: Record<string, unknown> = {};
  const viewers = { A: asA, B: asB, system } as const;
  const page = (v: Viewer, f: TransactionFilter, at: TransactionPageAt) =>
    uow.read((r) => r.transactions.listPage(v, TODAY, f, at, SIZE));
  const ids_ = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

  for (const [who, v] of Object.entries(viewers)) {
    // The whole list by keyset, forward then back, and by offset.
    const forward: string[][] = [];
    let after: TransactionCursor | undefined;
    for (;;) {
      const rows = page(v, {}, after === undefined ? { offset: 0 } : { after }) as {
        id: string;
        postedOn: string;
      }[];
      if (rows.length === 0) break;
      forward.push(ids_(rows));
      const last = rows[rows.length - 1];
      if (last === undefined || rows.length < SIZE) break;
      after = cursorOf(last);
    }
    out[`${who}.forward`] = forward;
    const offsets: string[][] = [];
    for (let p = 0; p < forward.length; p++) {
      offsets.push(ids_(page(v, {}, { offset: p * SIZE })));
    }
    out[`${who}.offsets`] = offsets;
    const back: string[][] = [];
    let before: TransactionCursor | undefined;
    const lastPage = forward[forward.length - 1];
    const lastRows = page(v, {}, { offset: (forward.length - 1) * SIZE }) as {
      id: string;
      postedOn: string;
    }[];
    expect(ids_(lastRows)).toEqual(lastPage);
    before = lastRows[0] === undefined ? undefined : cursorOf(lastRows[0]);
    while (before !== undefined) {
      const rows = page(v, {}, { before });
      if (rows.length === 0) break;
      back.push(ids_(rows));
      const first = rows[0];
      before = first === undefined ? undefined : cursorOf(first);
    }
    out[`${who}.back`] = back;
    const firstOfLast = lastRows[0];
    out[`${who}.countBefore`] =
      firstOfLast === undefined
        ? 0
        : uow.read((r) => r.transactions.countBefore(v, TODAY, {}, cursorOf(firstOfLast)));

    // Every filter: its summary, count before the second row, first page and the day nets.
    const filters: Record<string, TransactionFilter> = {
      none: {},
      account: { accountId: otherShared },
      from: { from: "2026-08-20" },
      to: { to: "2026-08-10" },
      range: { from: "2026-08-05", to: "2026-08-07" },
      category: { categoryId: cats[0] },
      noSuchCategory: { categoryId: "nope" },
      tag: { tagId: tagShared },
      scopedTag: { tagId: tagA },
      payee: { payeeId: payeeShared },
      scopedPayee: { payeeId: payeeA },
      noSuchPayee: { payeeId: "nope" },
      min: { minCents: 5000 },
      max: { maxCents: 1000 },
      amountRange: { minCents: 500, maxCents: 3000 },
      in: { type: "in" },
      out: { type: "out" },
      uncategorised: { uncategorised: true },
      transfers: { transfers: true },
      hidden: { hidden: true },
      combined: { type: "out", uncategorised: true, from: "2026-08-03", payeeId: payeeShared },
    };
    for (const [name, f] of Object.entries(filters)) {
      const rows = page(v, f, { offset: 0 });
      const days = [...new Set(rows.map((row) => row.postedOn))];
      out[`${who}.filter.${name}`] = {
        summary: uow.read((r) => r.transactions.summarise(v, TODAY, f)),
        ids: ids_(rows),
        dayNets: uow.read((r) => r.transactions.dayNets(v, TODAY, f, days)),
      };
    }
  }
  return { out, sharedIds, privateRows, a, b };
}

describe("the transaction list repositories", () => {
  it("answer alike on SQLite and in memory, and as the matrix says", () => {
    const sqlite = scenario(createUnitOfWork(db));
    const memory = scenario(memoryUnitOfWork());
    expect(sqlite.out).toEqual(memory.out);
    const out = sqlite.out as Record<string, never>;
    const get = (key: string) => out[key] as unknown as Record<string, unknown>;
    const sum = (key: string) =>
      get(key).summary as { count: number; inCents: number; outCents: number };

    // First page of 120 shared rows plus the partner-visible extras: A sees A's private rows.
    const aForward = out["A.forward"] as unknown as string[][];
    const aTotal = sum("A.filter.none").count as number;
    expect(aForward.map((p) => p.length)).toEqual(
      [SIZE, SIZE, aTotal - 2 * SIZE].filter((n) => n > 0),
    );
    // Keyset forward, back and offset reach the same pages.
    expect(out["A.offsets"]).toEqual(out["A.forward"]);
    expect([...(out["A.back"] as unknown as string[][])].reverse()).toEqual(aForward.slice(0, -1));
    expect(out["B.offsets"]).toEqual(out["B.forward"]);

    // The partner sees the shared rows only: A's private rows are as if they did not exist.
    expect(sum("A.filter.none").count).toBe(120 + 2 + 6);
    expect(sum("B.filter.none").count).toBe(120 + 2 + 1);
    expect(sum("system.filter.none").count).toBe(120 + 2 + 6 + 1);
    // A's scoped payee, scoped tag and hidden name cannot be probed.
    for (const name of ["scopedPayee", "scopedTag", "noSuchPayee"]) {
      expect(get(`B.filter.${name}`).ids).toEqual([]);
      expect(sum(`B.filter.${name}`)).toEqual({ count: 0, inCents: 0, outCents: 0 });
    }
    expect(get("B.filter.scopedPayee")).toEqual(get("B.filter.noSuchPayee"));
    expect(sum("A.filter.scopedPayee").count).toBe(6 + 1);
    expect(sum("A.filter.scopedTag").count).toBe(6);
    // A hidden name is hidden from B (and from nobody else).
    expect(sum("B.filter.hidden").count).toBe(1);
    expect(sum("A.filter.hidden").count).toBe(0);
    // Uncategorised: a row with any split without a category (a third of the shared rows, the
    // two-split row, and the private rows for those who see them).
    expect(sum("B.filter.uncategorised").count).toBe(40 + 1 + 1);
    expect(sum("A.filter.uncategorised").count).toBe(40 + 1 + 6);
    expect(sum("A.filter.transfers").count).toBe(1);
    // In and out never overlap and add to the whole.
    expect(sum("A.filter.in").count + sum("A.filter.out").count).toBe(sum("A.filter.none").count);
    expect(sum("A.filter.in").inCents).toBe(sum("A.filter.none").inCents);
    expect(sum("A.filter.in").outCents).toBe(0);
    expect(sum("A.filter.out").inCents).toBe(0);
    // Day nets are for the whole day under the filter.
    const nets = get("A.filter.none").dayNets as Record<string, number>;
    expect(Object.keys(nets).length).toBeGreaterThan(0);
  });
});
