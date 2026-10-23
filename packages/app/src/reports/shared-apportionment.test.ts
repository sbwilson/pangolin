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
import { allocate, type Cents, type Id } from "@pangolin/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import type {
  AccountRow,
  HouseholdSettingsRow,
  SplitRow,
  TransactionRow,
  UnitOfWork,
} from "../ports/unit-of-work.ts";
import { manualClock } from "../testing/fixtures.ts";
import { DEFAULT_SETTINGS, memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { sharedApportionment, sharedShare, wholePercent } from "./shared-apportionment.ts";

const clock = manualClock("2026-09-27T00:00:00Z");
const T = "2026-09-27T00:00:00.000Z";
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-apportion-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function build(uow: UnitOfWork, setting: HouseholdSettingsRow["sharedAttribution"]) {
  let n = 0;
  const newId = <B extends string>() =>
    `01J0000000000000000000${String(++n).padStart(4, "0")}` as Id<B>;
  const a = newId<"Person">();
  const b = newId<"Person">();
  const acct = {
    everyday: newId<"Account">(),
    savings: newId<"Account">(),
    privA: newId<"Account">(),
    privA2: newId<"Account">(),
    privB: newId<"Account">(),
    soloA: newId<"Account">(),
  };
  const own = (accountId: Id<"Account">, personId: Id<"Person">, shareBp: number) => ({
    accountId,
    personId,
    shareBp,
    createdAt: T,
    updatedAt: T,
  });
  const account = (
    id: Id<"Account">,
    isPrivate: boolean,
    type: AccountRow["type"],
  ): AccountRow => ({
    id,
    name: id,
    type,
    currency: "AUD",
    isPrivate,
    institutionId: null,
    openedOn: null,
    closedOn: null,
    isSavings: false,
    createdAt: T,
    updatedAt: T,
  });
  uow.transaction((r) => {
    for (const [id, name] of [
      [a, "A"],
      [b, "B"],
    ] as const) {
      r.person.insert({
        id,
        userId: null,
        displayName: name,
        colour: "#000000",
        createdAt: T,
        updatedAt: T,
        deletedAt: null,
      });
    }
    r.householdSettings.update({ ...DEFAULT_SETTINGS, sharedAttribution: setting });
    const joint = [own(acct.everyday, a, 5000), own(acct.everyday, b, 5000)];
    r.accounts.insert(account(acct.everyday, false, "transaction"), joint);
    r.accounts.insert(account(acct.savings, false, "savings"), [
      own(acct.savings, a, 5000),
      own(acct.savings, b, 5000),
    ]);
    r.accounts.insert(account(acct.privA, true, "transaction"), [own(acct.privA, a, 10000)]);
    r.accounts.insert(account(acct.privA2, true, "savings"), [own(acct.privA2, a, 10000)]);
    r.accounts.insert(account(acct.privB, true, "transaction"), [own(acct.privB, b, 10000)]);
    r.accounts.insert(account(acct.soloA, false, "transaction"), [own(acct.soloA, a, 10000)]);
  });
  let fp = 0;
  const txn = (
    key: string,
    accountId: Id<"Account">,
    amountCents: number,
    over: Partial<TransactionRow> & { beneficiary?: string } = {},
  ) => {
    const { beneficiary, ...rest } = over;
    const id = newId<"Transaction">();
    const row: TransactionRow = {
      id,
      accountId,
      postedOn: "2026-09-10",
      amountCents,
      descriptionRaw: key,
      payeeId: null,
      status: "posted",
      externalId: null,
      fingerprint: `fp:${++fp}`,
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
      ...rest,
    };
    const splitRow: SplitRow = {
      id: newId<"Split">(),
      transactionId: id,
      amountCents,
      categoryId: null,
      activityId: null,
      beneficiary: beneficiary ?? "shared",
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
    };
    uow.transaction((r) => r.transactions.insert(row, [splitRow]));
  };
  /** A linked pair: `from` loses, `to` gains; `by` is set on the `to` leg. */
  const transfer = (
    key: string,
    from: Id<"Account">,
    to: Id<"Account">,
    cents: number,
    by: Id<"Person"> | null,
    postedOn = "2026-09-10",
  ) => {
    const group = newId<"TransferGroup">();
    uow.transaction((r) =>
      r.transferGroups.insert({ id: group, matchedBy: "manual", createdAt: T, updatedAt: T }),
    );
    const fromOwner = from === acct.privA || from === acct.privA2 ? a : b;
    const privateFrom = from === acct.privA || from === acct.privA2 || from === acct.privB;
    txn(`${key}.out`, from, -cents, {
      transferGroupId: group,
      postedOn,
      ...(privateFrom ? { beneficiary: fromOwner } : {}),
    });
    txn(`${key}.in`, to, cents, { transferGroupId: group, postedOn, performedBy: by });
  };
  const ctxOf = (viewer: Viewer): UseCaseContext => ({
    viewer,
    clock,
    newId: newId as UseCaseContext["newId"],
    uow,
  });
  const as = (id: Id<"Person">) => ctxOf(personViewer(id, clock.now()));
  return { a, b, acct, txn, transfer, as };
}

const shareOf = (r: ReturnType<typeof sharedApportionment>, id: string) =>
  r.people.find((p) => p.personId === id)?.shareCents;

describe.each([
  ["SQLite", () => createUnitOfWork(db)],
  ["memory", () => memoryUnitOfWork()],
] as const)("reports.sharedApportionment on %s", (_name, makeUow) => {
  it("apportions by contribution: transfers in and paid personally", () => {
    const h = build(makeUow(), "contribution");
    h.transfer("a-in", h.acct.privA, h.acct.everyday, 600, h.a);
    h.transfer("b-in", h.acct.privB, h.acct.everyday, 400, h.b);
    h.txn("shop", h.acct.everyday, -10_000);
    h.txn("paid", h.acct.soloA, -90); // shared beneficiary on A's public personal account
    h.txn("a-private", h.acct.privA, -5000, { beneficiary: h.a });
    const r = sharedApportionment(h.as(h.a), SEPTEMBER);
    expect(r.sharedCents).toBe(10_090);
    expect(r.basis).toBe("contribution");
    expect(r.people.map((p) => p.contributionCents)).toEqual([690, 400]);
    const expected = allocate(10_090 as Cents, [690, 400]);
    expect(r.people.map((p) => p.shareCents)).toEqual(expected);
    expect(r.people.reduce((n, p) => n + p.shareCents, 0)).toBe(10_090);
  });

  it("is 60/40 on a clean 600/400 split", () => {
    const h = build(makeUow(), "contribution");
    h.transfer("a-in", h.acct.privA, h.acct.everyday, 600, h.a);
    h.transfer("b-in", h.acct.privB, h.acct.everyday, 400, h.b);
    h.txn("shop", h.acct.everyday, -10_000);
    const r = sharedApportionment(h.as(h.b), SEPTEMBER);
    expect(r.people.map((p) => p.shareCents)).toEqual([6000, 4000]);
  });

  it("splits 50/50 under the even setting whatever was contributed", () => {
    const h = build(makeUow(), "even");
    h.transfer("a-in", h.acct.privA, h.acct.everyday, 600, h.a);
    h.txn("shop", h.acct.everyday, -10_000);
    const r = sharedApportionment(h.as(h.a), SEPTEMBER);
    expect(r.basis).toBe("even");
    expect(r.people.map((p) => p.shareCents)).toEqual([5000, 5000]);
  });

  it("splits 50/50 with no attributable contribution, and gives the odd cent to the first", () => {
    const h = build(makeUow(), "contribution");
    h.txn("shop", h.acct.everyday, -10_001, { postedOn: "2026-10-05" });
    const r = sharedApportionment(h.as(h.a), OCTOBER);
    expect(r.basis).toBe("even-fallback");
    expect(r.sharedCents).toBe(10_001);
    expect(r.people.map((p) => p.shareCents)).toEqual([5001, 5000]);
  });

  it("counts neither an unattributed transfer, a joint-to-joint one, salary nor an outflow", () => {
    const h = build(makeUow(), "contribution");
    h.transfer("unattributed", h.acct.privB, h.acct.everyday, 777, null);
    h.transfer("shared-to-shared", h.acct.everyday, h.acct.savings, 5000, h.a);
    h.transfer("allowance", h.acct.everyday, h.acct.privB, 3000, h.b);
    h.txn("salary", h.acct.everyday, 300_000, { performedBy: h.a });
    h.txn("shop", h.acct.everyday, -2000);
    const r = sharedApportionment(h.as(h.a), SEPTEMBER);
    expect(r.people.map((p) => p.contributionCents)).toEqual([0, 0]);
    expect(r.basis).toBe("even-fallback");
    expect(r.sharedCents).toBe(2000);
  });

  it("attributes personal shared spend to the sole owner unless performedBy says otherwise", () => {
    const h = build(makeUow(), "contribution");
    h.txn("owner pays", h.acct.soloA, -300);
    h.txn("b pays", h.acct.soloA, -200, { performedBy: h.b });
    const r = sharedApportionment(h.as(h.b), SEPTEMBER);
    expect(r.people.map((p) => p.contributionCents)).toEqual([300, 200]);
    expect(r.sharedCents).toBe(500);
  });

  it("gives both partners the same output, whatever only A's private data does", () => {
    const h = build(makeUow(), "contribution");
    h.transfer("a-in", h.acct.privA, h.acct.everyday, 600, h.a);
    h.transfer("b-in", h.acct.privB, h.acct.everyday, 400, h.b);
    h.txn("shop", h.acct.everyday, -10_000);
    const asA = JSON.stringify(sharedApportionment(h.as(h.a), SEPTEMBER));
    const asB = JSON.stringify(sharedApportionment(h.as(h.b), SEPTEMBER));
    expect(asA).toBe(asB);
    // Only A's private data changes: private spend, a private-to-private transfer and savings.
    h.txn("a-lunch", h.acct.privA, -3300, { beneficiary: h.a });
    h.txn("a-bonus", h.acct.privA, 90_000, { beneficiary: h.a });
    h.transfer("a-save", h.acct.privA, h.acct.privA2, 10_000, h.a);
    expect(JSON.stringify(sharedApportionment(h.as(h.b), SEPTEMBER))).toBe(asB);
    expect(JSON.stringify(sharedApportionment(h.as(h.a), SEPTEMBER))).toBe(asA);
  });

  it("refuses a range that is backwards or not YYYY-MM-DD", () => {
    const h = build(makeUow(), "contribution");
    for (const bad of [
      { from: "2026-09-30", to: "2026-09-01" },
      { from: "2026-9-1", to: "2026-09-30" },
      { from: "2026-09-01" },
    ]) {
      expect(() => sharedApportionment(h.as(h.a), bad as never)).toThrow(AppError);
    }
    expect(shareOf(sharedApportionment(h.as(h.a), SEPTEMBER), h.a)).toBe(0);
  });

  it("handles a household with no active people", () => {
    const uow = makeUow();
    const h = build(uow, "contribution");
    h.txn("shop", h.acct.everyday, -1000);
    uow.transaction((r) => {
      r.person.markLeft(h.a, T);
      r.person.markLeft(h.b, T);
    });
    for (const [setting, basis] of [
      ["contribution", "even-fallback"],
      ["even", "even"],
    ] as const) {
      uow.transaction((r) =>
        r.householdSettings.update({ ...DEFAULT_SETTINGS, sharedAttribution: setting }),
      );
      const r = sharedApportionment(h.as(h.a), SEPTEMBER);
      expect(r.people).toEqual([]);
      expect(r.basis).toBe(basis);
      expect(r.sharedCents).toBe(1000);
    }
  });
});

describe("wholePercent", () => {
  it("is part ÷ whole as a whole percent, half away from zero, null without a whole", () => {
    expect(wholePercent(1, 3)).toBe(33);
    expect(wholePercent(2, 3)).toBe(67);
    expect(wholePercent(1, 200)).toBe(1);
    expect(wholePercent(-1, 200)).toBe(-1);
    expect(wholePercent(5001, 10_001)).toBe(50);
    expect(wholePercent(0, 100)).toBe(0);
    expect(wholePercent(5, 0)).toBeNull();
  });
});

describe.each([
  ["SQLite", () => createUnitOfWork(db)],
  ["memory", () => memoryUnitOfWork()],
] as const)("reports.sharedShare on %s", (_name, makeUow) => {
  it("gives each partner their own share and percent of the identical shared total", () => {
    const h = build(makeUow(), "contribution");
    h.transfer("a-in", h.acct.privA, h.acct.everyday, 600, h.a);
    h.transfer("b-in", h.acct.privB, h.acct.everyday, 400, h.b);
    h.txn("shop", h.acct.everyday, -10_000);
    const asA = sharedShare(h.as(h.a), SEPTEMBER);
    const asB = sharedShare(h.as(h.b), SEPTEMBER);
    expect(asA).toMatchObject({ sharedCents: 10_000, shareCents: 6000, sharePercent: 60 });
    expect(asB).toMatchObject({ sharedCents: 10_000, shareCents: 4000, sharePercent: 40 });
    expect({ ...asA, shareCents: 0, sharePercent: 0 }).toEqual({
      ...asB,
      shareCents: 0,
      sharePercent: 0,
    });
  });

  it("follows the setting, and has no percent when nothing is shared", () => {
    const h = build(makeUow(), "even");
    h.transfer("a-in", h.acct.privA, h.acct.everyday, 600, h.a);
    expect(sharedShare(h.as(h.b), SEPTEMBER)).toMatchObject({
      setting: "even",
      sharedCents: 0,
      shareCents: 0,
      sharePercent: null,
    });
    h.txn("shop", h.acct.everyday, -10_000);
    expect(sharedShare(h.as(h.b), SEPTEMBER)).toMatchObject({ shareCents: 5000, sharePercent: 50 });
  });
});
