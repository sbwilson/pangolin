// The memory mirror answers balanceAsOf, shared-split checks, account views and the ownership
// and privacy switches (story 2.15) as SQLite does, through the use cases. It sits beside the memory unit of work, which is not exported
// from the package: a test file here may import the adapter.
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
import {
  type AccountView,
  balanceAsOf as accountBalanceAsOf,
  closeAccount,
  createAccount,
  createIdGenerator,
  createPayee,
  createPerson,
  createTag,
  createTransaction,
  deleteTransaction,
  getAccount,
  getTransaction,
  hideTransactionName,
  listAccounts,
  listAudit,
  listReviewItems,
  listTransactions,
  personViewer,
  recordBalanceSnapshot,
  rejoinAccount,
  setPrivacy,
  setSplitField,
  setSplitTags,
  type UseCaseContext,
  unhideTransactionName,
  updateAccount,
  updateTransaction,
} from "../index.ts";
import { systemViewer } from "../system-viewer.ts";
import { memoryUnitOfWork } from "./memory-uow.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");

const own = (id: Id<"Person">) => [{ personId: id, shareBp: 10000 }];
const txn = (ctx: UseCaseContext, accountId: string, postedOn: string, amountCents: number) =>
  createTransaction(ctx, {
    accountId,
    postedOn,
    amountCents,
    description: `${postedOn} ${amountCents}`,
  });

/** `ok`, or the code of the `AppError` the call threw. */
const outcome = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
};

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-accounts-parity-"));
  db = openDatabase(join(dir, "test.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("memory mirror parity", () => {
  it("answers balanceAsOf, shared-split and account views as SQLite does", () => {
    migrate(db, loadMigrations(packageMigrationsDir));
    let ms = now.epochMilliseconds;
    const sqliteBase = {
      clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
      newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
      uow: createUnitOfWork(db),
    };
    const sys: UseCaseContext = { ...sqliteBase, viewer: systemViewer("cli:test") };
    const as = (id: Id<"Person">): UseCaseContext => ({
      ...sqliteBase,
      viewer: personViewer(id, now),
    });
    const a = createPerson(sys, { displayName: "A", colour: "#000000" });
    const b = createPerson(sys, { displayName: "B", colour: "#ffffff" });
    const run = (
      ctxs: { sys: UseCaseContext; as: (id: Id<"Person">) => UseCaseContext },
      pa: Id<"Person">,
      pb: Id<"Person">,
    ) => {
      const acct = createAccount(ctxs.sys, {
        name: "P",
        type: "savings",
        currency: "AUD",
        isPrivate: false,
        owners: [
          { personId: pa, shareBp: 6000 },
          { personId: pb, shareBp: 4000 },
        ],
      });
      const A = ctxs.as(pa);
      recordBalanceSnapshot(A, { accountId: acct, asOf: "2026-09-01", balanceCents: 5000 });
      recordBalanceSnapshot(A, { accountId: acct, asOf: "2026-09-10", balanceCents: 4000 });
      // Same day and created_at: the later ID wins.
      recordBalanceSnapshot(A, { accountId: acct, asOf: "2026-09-10", balanceCents: 4100 });
      txn(A, acct, "2026-09-01", -100);
      txn(A, acct, "2026-09-05", -200);
      txn(A, acct, "2026-09-12", 25);
      // A soft-deleted line no longer counts.
      deleteTransaction(A, { id: txn(A, acct, "2026-09-14", -999) });
      const balances = ["2026-08-01", "2026-09-01", "2026-09-05", "2026-09-10", "2026-09-30"].map(
        (date) => accountBalanceAsOf(A, { accountId: acct, date }),
      );
      const view: AccountView = getAccount(A, { id: acct });
      const removedOther = outcome(() => updateAccount(A, { id: acct, owners: own(pa) }));
      const edited = outcome(() => updateAccount(ctxs.as(pb), { id: acct, owners: own(pa) }));
      const pooled = getAccount(A, { id: acct }).pool;
      const madePrivate = outcome(() => setPrivacy(A, { id: acct, isPrivate: true }));
      return {
        balances,
        pool: view.pool,
        owners: view.owners,
        removedOther,
        edited,
        pooled,
        madePrivate,
      };
    };
    const sqlite = run({ sys, as }, a, b);

    const uow = memoryUnitOfWork();
    let n = 0;
    const base = {
      clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
      newId: (<B extends string>() =>
        `M${String(++n).padStart(6, "0")}` as Id<B>) as UseCaseContext["newId"],
      uow,
    };
    const msys: UseCaseContext = { ...base, viewer: systemViewer("cli:test") };
    const ma = createPerson(msys, { displayName: "A", colour: "#000000" });
    const mb = createPerson(msys, { displayName: "B", colour: "#ffffff" });
    const memory = run(
      { sys: msys, as: (id) => ({ ...base, viewer: personViewer(id, now) }) },
      ma,
      mb,
    );
    const norm = (r: typeof sqlite, x: Id<"Person">, y: Id<"Person">) =>
      JSON.parse(JSON.stringify(r).replaceAll(x, "PA").replaceAll(y, "PB"));
    expect(norm(memory, ma, mb)).toEqual(norm(sqlite, a, b));
    // Each adapter is held to the expected answers itself, not only to the other.
    for (const [who, result] of [
      ["sqlite", sqlite],
      ["memory", memory],
    ] as const) {
      expect(result.balances, who).toEqual([0, 5000, 4800, 4100, 4125]);
      expect(result.pool, who).toBe("shared");
      expect(result.removedOther, who).toBe("ok");
      expect(result.edited, who).toBe("Validation");
      expect(result.pooled, who).not.toBe("shared");
      expect(result.madePrivate, who).toBe("Conflict");
    }
  });
});

/** Contexts for one adapter: the system, and a person on a day (default the fixed today). */
interface Ctxs {
  readonly sys: UseCaseContext;
  readonly as: (id: Id<"Person">, day?: string) => UseCaseContext;
}

function sqliteCtxs(db: Db): Ctxs {
  migrate(db, loadMigrations(packageMigrationsDir));
  let ms = now.epochMilliseconds;
  const base = {
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
  return contexts(base);
}

function memoryCtxs(): Ctxs {
  let n = 0;
  return contexts({
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: (<B extends string>() =>
      `M${String(++n).padStart(6, "0")}` as Id<B>) as UseCaseContext["newId"],
    uow: memoryUnitOfWork(),
  });
}

function contexts(base: Omit<UseCaseContext, "viewer">): Ctxs {
  return {
    sys: { ...base, viewer: systemViewer("cli:test") },
    as: (id, day) => ({
      ...base,
      clock:
        day === undefined
          ? base.clock
          : { now: () => now, today: () => Temporal.PlainDate.from(day) },
      viewer: personViewer(id, now),
    }),
  };
}

/** The I/O matrix of story 2.15 on one adapter; a transcript with person IDs as PA/PB/PC. */
function switches(ctxs: Ctxs) {
  const { sys } = ctxs;
  const pa = createPerson(sys, { displayName: "A", colour: "#000000" });
  const pb = createPerson(sys, { displayName: "B", colour: "#ffffff" });
  const pc = createPerson(sys, { displayName: "C", colour: "#888888" });
  const A = ctxs.as(pa);
  const B = ctxs.as(pb);
  const joint = (owners: [Id<"Person">, number][]) =>
    createAccount(sys, {
      name: "Joint",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      owners: owners.map(([personId, shareBp]) => ({ personId, shareBp })),
    });
  const out: Record<string, unknown> = {};

  // An owner may swap the other person out; a non-owner may only join; system exempt.
  const three = joint([
    [pa, 5000],
    [pb, 5000],
  ]);
  const swap = [
    { personId: pa, shareBp: 5000 },
    { personId: pc, shareBp: 5000 },
  ];
  out.aSwapsBForC = outcome(() => updateAccount(A, { id: three, owners: swap }));
  out.bSwapsSelfForC = outcome(() => updateAccount(B, { id: three, owners: swap }));
  out.afterSwap = getAccount(A, { id: three }).owners;
  out.systemRemovesC = outcome(() => updateAccount(sys, { id: three, owners: own(pa) }));
  const mine = createAccount(A, {
    name: "Mine",
    type: "transaction",
    currency: "AUD",
    isPrivate: true,
    owners: own(pa),
  });
  out.selfFromPrivate = outcome(() => updateAccount(A, { id: mine, owners: own(pb) }));
  out.privateOwners = getAccount(A, { id: mine }).owners;

  // The takeover path: B hid a name on the joint account, A removed B, and A made it private.
  const acct = joint([
    [pa, 5000],
    [pb, 5000],
  ]);
  const gift = createTransaction(B, {
    accountId: acct,
    postedOn: "2026-09-01",
    amountCents: -500,
    description: "Gift for A",
  });
  hideTransactionName(B, { id: gift, until: "2027-03-12" });
  const splitId = getTransaction(B, { id: gift }).splits[0]?.id ?? "";
  out.removeOther = outcome(() => updateAccount(A, { id: acct, owners: own(pa) }));
  out.removeSelf = outcome(() => updateAccount(B, { id: acct, owners: own(pa) }));
  out.privateWhileShared = outcome(() => setPrivacy(A, { id: acct, isPrivate: true }));
  const beneficiary = (value: string) =>
    setSplitField(A, { transactionId: gift, splitId, field: "beneficiary", value });
  beneficiary(pb);
  out.privateWithPartner = outcome(() => setPrivacy(A, { id: acct, isPrivate: true }));
  beneficiary(pa);
  out.madePrivate = outcome(() => setPrivacy(A, { id: acct, isPrivate: true }));
  const nameFor = (ctx: UseCaseContext) =>
    listTransactions(ctx).find((t) => t.id === gift)?.descriptionRaw;
  out.aSeesWhilePrivate = nameFor(A);
  out.aAuditLeaks = JSON.stringify(listAudit(A)).includes("Gift");
  out.aSeesOnTheDay = nameFor(ctxs.as(pa, "2027-03-12"));

  // Private era: a scoped payee and tag block the public switch, by name, until removed.
  const payee = createPayee(A, { name: "Chemist", originAccountId: acct });
  const tag = createTag(A, { name: "health", originAccountId: acct });
  const priv = createTransaction(A, {
    accountId: acct,
    postedOn: "2026-09-02",
    amountCents: -900,
    description: "Private era",
    payeeId: payee.id,
  });
  const privSplit = getTransaction(A, { id: priv }).splits[0]?.id ?? "";
  setSplitTags(A, { transactionId: priv, splitId: privSplit, tagIds: [tag.id] });
  try {
    setPrivacy(A, { id: acct, isPrivate: false });
    out.publicRefused = "ok";
  } catch (error) {
    const e = error as { code: string; message: string; details: unknown };
    out.publicRefused = [e.code, e.message, e.details];
  }
  out.stillPrivate = getAccount(A, { id: acct }).isPrivate;
  deleteTransaction(A, { id: priv });
  out.madePublic = outcome(() => setPrivacy(A, { id: acct, isPrivate: false }));

  // B sees the joint-era rows and both flips, never the private era; A sees everything.
  const privateEra = new Set<string>([priv, payee.id, tag.id]);
  const label = (row: { entity: string; action: string; entityId: string }) =>
    `${row.entity}:${row.action}${privateEra.has(row.entityId) ? ":private-era" : ""}`;
  const auditOf = (ctx: UseCaseContext) =>
    listAudit(ctx)
      .filter((row) => row.accountId === acct)
      .map(label);
  out.auditA = auditOf(A);
  out.auditB = auditOf(B);
  // A redundant private → private switch does not restart the private era.
  const again = joint([
    [pa, 5000],
    [pb, 5000],
  ]);
  updateAccount(B, { id: again, owners: own(pa) });
  out.againPrivate = outcome(() => setPrivacy(A, { id: again, isPrivate: true }));
  const eraRow = createTransaction(A, {
    accountId: again,
    postedOn: "2026-09-03",
    amountCents: -700,
    description: "Before the repeat",
  });
  out.againRepeat = outcome(() => setPrivacy(A, { id: again, isPrivate: true }));
  out.againPublic = outcome(() => setPrivacy(A, { id: again, isPrivate: false }));
  const againFor = (ctx: UseCaseContext) => listAudit(ctx).filter((row) => row.accountId === again);
  out.againBSeesEra = againFor(B).some((row) => row.entityId === eraRow);
  out.againBLeaks = JSON.stringify(againFor(B)).includes("Before the repeat");
  out.againASeesEra = againFor(A).some((row) => row.entityId === eraRow);
  out.againBFlips = againFor(B).filter((row) => row.action === "set_privacy").length;
  out.bSeesOwnName = nameFor(B);
  out.aSeesAfterPublic = nameFor(A);
  // Share, join, remove and rejoin, with a hiding kept and the removal marker (ticket 20).
  const grp = joint([
    [pa, 6000],
    [pb, 4000],
  ]);
  const note = createTransaction(B, {
    accountId: grp,
    postedOn: "2026-09-04",
    amountCents: -300,
    description: "Gift for A too",
  });
  hideTransactionName(B, { id: note, until: "2027-03-12" });
  const noteFor = (ctx: UseCaseContext) =>
    listTransactions(ctx).find((t) => t.id === note)?.descriptionRaw;
  out.grpRejoinAsOwner = outcome(() => rejoinAccount(B, { id: grp }));
  out.grpAShares = outcome(() =>
    updateAccount(A, {
      id: grp,
      owners: [
        { personId: pa, shareBp: 3000 },
        { personId: pb, shareBp: 7000 },
      ],
    }),
  );
  out.grpARemovesB = outcome(() => updateAccount(A, { id: grp, owners: own(pa) }));
  out.grpBMarker = getAccount(B, { id: grp }).removal ?? null;
  out.grpBListMarker = listAccounts(B).find((row) => row.id === grp)?.removal ?? null;
  out.grpAMarker = getAccount(A, { id: grp }).removal ?? null;
  out.grpSysMarker = getAccount(sys, { id: grp }).removal ?? null;
  out.grpBTakesOver = outcome(() => updateAccount(B, { id: grp, owners: own(pb) }));
  out.grpASeesHidden = noteFor(A);
  out.grpBRejoins = outcome(() => rejoinAccount(B, { id: grp }));
  out.grpAfterRejoin = getAccount(A, { id: grp }).owners;
  out.grpBMarkerGone = getAccount(B, { id: grp }).removal ?? null;
  out.grpRejoinTwice = outcome(() => rejoinAccount(B, { id: grp }));
  out.grpBUnhides = outcome(() => unhideTransactionName(B, { id: note }));
  out.grpASeesAfterUnhide = noteFor(A);
  // The audit read behind the marker, per viewer; another person's private account gives none.
  const changes = (ctx: UseCaseContext, id: string) =>
    ctx.uow.read((r) =>
      r.audit.ownerChanges(ctx.viewer, id).map(({ at, actor, before, after }) => ({
        at,
        actor,
        before: before.map((o) => [o.personId, o.shareBp]),
        after: after.map((o) => [o.personId, o.shareBp]),
      })),
    );
  out.grpChangesA = changes(A, grp);
  out.grpChangesB = changes(B, grp);
  out.grpChangesSys = changes(sys, grp);
  out.grpChangesPrivate = [changes(B, mine), changes(A, mine)];
  const named: [string, string][] = [
    [pa, "PA"],
    [pb, "PB"],
    [pc, "PC"],
    [payee.id, "PAYEE"],
    [tag.id, "TAG"],
  ];
  return JSON.parse(
    named.reduce((json, [id, name]) => json.replaceAll(id, name), JSON.stringify(out)),
  ) as Record<string, unknown>;
}

describe("ownership and privacy switches (story 2.15)", () => {
  it("answers the I/O matrix the same on SQLite and memory", () => {
    const sqlite = switches(sqliteCtxs(db));
    const memory = switches(memoryCtxs());
    expect(memory).toEqual(sqlite);
    for (const [who, out] of [
      ["sqlite", sqlite],
      ["memory", memory],
    ] as const) {
      expect(out.aSwapsBForC, who).toBe("ok");
      expect(out.bSwapsSelfForC, who).toBe("Validation");
      expect(out.afterSwap, who).toEqual([
        { personId: "PA", shareBp: 5000 },
        { personId: "PC", shareBp: 5000 },
      ]);
      expect(out.systemRemovesC, who).toBe("ok");
      expect(out.selfFromPrivate, who).toBe("Validation");
      expect(out.privateOwners, who).toEqual([{ personId: "PA", shareBp: 10000 }]);
      expect(out.removeOther, who).toBe("ok");
      expect(out.removeSelf, who).toBe("Validation");
      expect(out.privateWhileShared, who).toBe("Conflict");
      expect(out.privateWithPartner, who).toBe("Conflict");
      expect(out.madePrivate, who).toBe("ok");
      expect(out.aSeesWhilePrivate, who).toBe("Hidden until 12 Mar 2027");
      expect(out.aAuditLeaks, who).toBe(false);
      expect(out.aSeesOnTheDay, who).toBe("Gift for A");
      const [code, message, details] = out.publicRefused as [string, string, unknown];
      expect(code, who).toBe("Conflict");
      expect(message, who).toContain('payee "Chemist", tag "health"');
      expect(message, who).toContain("private to A");
      expect(details, who).toEqual({
        payees: [{ id: "PAYEE", name: "Chemist" }],
        tags: [{ id: "TAG", name: "health" }],
        activities: [],
        owners: [{ personId: "PA", displayName: "A" }],
      });
      expect(out.stillPrivate, who).toBe(true);
      expect(out.madePublic, who).toBe("ok");
      const auditA = out.auditA as string[];
      const auditB = out.auditB as string[];
      expect(auditA.filter((l) => l.endsWith(":private-era")).length, who).toBeGreaterThan(0);
      expect(auditB, who).toEqual(auditA.filter((l) => !l.endsWith(":private-era")));
      expect(
        auditB.filter((l) => l === "account:set_privacy"),
        who,
      ).toHaveLength(2);
      expect(auditB, who).toContain("transaction:create");
      expect(out.bSeesOwnName, who).toBe("Gift for A");
      expect(out.grpRejoinAsOwner, who).toBe("Validation");
      expect(out.grpAShares, who).toBe("ok");
      expect(out.grpARemovesB, who).toBe("ok");
      const previous = [
        { personId: "PA", shareBp: 3000 },
        { personId: "PB", shareBp: 7000 },
      ];
      for (const marker of [out.grpBMarker, out.grpBListMarker]) {
        expect(marker, who).toEqual({
          by: "PA",
          at: "2026-09-27T00:00:00.000Z",
          previousOwners: previous,
        });
      }
      expect(out.grpAMarker, who).toBeNull();
      expect(out.grpSysMarker, who).toBeNull();
      expect(out.grpBTakesOver, who).toBe("Validation");
      expect(out.grpASeesHidden, who).toBe("Hidden until 12 Mar 2027");
      expect(out.grpBRejoins, who).toBe("ok");
      expect(out.grpAfterRejoin, who).toEqual(previous);
      expect(out.grpBMarkerGone, who).toBeNull();
      expect(out.grpRejoinTwice, who).toBe("Validation");
      expect(out.grpBUnhides, who).toBe("ok");
      expect(out.grpASeesAfterUnhide, who).toBe("Gift for A too");
      const lists = (out.grpChangesA as { before: unknown[][]; after: unknown[][] }[]).map((c) => [
        c.before.length,
        c.after.length,
      ]);
      expect(lists, who).toEqual([
        [2, 2],
        [2, 1],
        [1, 2],
      ]);
      expect(out.grpChangesB, who).toEqual(out.grpChangesA);
      expect(out.grpChangesSys, who).toEqual(out.grpChangesA);
      expect(out.grpChangesPrivate, who).toEqual([[], []]);
      expect(out.againPrivate, who).toBe("ok");
      expect(out.againRepeat, who).toBe("ok");
      expect(out.againPublic, who).toBe("ok");
      expect(out.againBSeesEra, who).toBe(false);
      expect(out.againBLeaks, who).toBe(false);
      expect(out.againASeesEra, who).toBe(true);
      // The two transitions; the redundant switch was inside the private era, so it is A's.
      expect(out.againBFlips, who).toBe(2);
      expect(out.aSeesAfterPublic, who).toBe("Hidden until 12 Mar 2027");
    }
  });
});

/** The closing-balance warning (story 24) on one adapter; a transcript with person IDs as PA/PB. */
function closingBalance(ctxs: Ctxs) {
  const { sys } = ctxs;
  const pa = createPerson(sys, { displayName: "A", colour: "#000000" });
  const pb = createPerson(sys, { displayName: "B", colour: "#ffffff" });
  const A = ctxs.as(pa);
  const B = ctxs.as(pb);
  const make = (type: "savings" | "property", isPrivate: boolean) =>
    createAccount(sys, {
      name: "Acct",
      type,
      currency: "AUD",
      isPrivate,
      owners: isPrivate
        ? own(pa)
        : [
            { personId: pa, shareBp: 5000 },
            { personId: pb, shareBp: 5000 },
          ],
    });
  const items = (ctx: UseCaseContext) =>
    listReviewItems(ctx)
      .filter((item) => item.kind === "accounts.closing-balance")
      .map((item) => [item.accountId === null ? null : "ACCT", item.entityRef.split(":")[0]]);
  const out: Record<string, unknown> = {};

  const acct = make("savings", false);
  const entry = txn(A, acct, "2026-09-01", 1000);
  out.closed = closeAccount(A, { id: acct, closedOn: "2026-09-10" }).warning;
  out.listed = listAccounts(B, { includeClosed: true }).find((row) => row.id === acct)?.warning;
  out.itemsB = items(B);
  out.edited =
    updateTransaction(A, { id: entry, amountCents: 800 }) && getAccount(A, { id: acct }).warning;
  out.itemsAfterEdit = items(A);
  recordBalanceSnapshot(A, { accountId: acct, asOf: "2026-09-10", balanceCents: 0 });
  out.zero = getAccount(A, { id: acct }).warning ?? null;
  out.itemsZero = items(A);
  out.reopened = updateAccount(A, { id: acct, closedOn: null }).warning ?? null;

  const property = make("property", false);
  txn(sys, property, "2026-09-01", 500);
  out.property = closeAccount(A, { id: property, closedOn: "2026-09-10" }).warning ?? null;
  out.itemsProperty = items(A);

  const priv = make("savings", true);
  txn(A, priv, "2026-09-01", 700);
  const bAccounts = JSON.stringify(listAccounts(B, { includeClosed: true }));
  const bItems = JSON.stringify(listReviewItems(B));
  closeAccount(A, { id: priv, closedOn: "2026-09-10" });
  out.privateAItems = items(A);
  out.privateBSame =
    JSON.stringify(listAccounts(B, { includeClosed: true })) === bAccounts &&
    JSON.stringify(listReviewItems(B)) === bItems;
  return out;
}

describe("closing-balance warning (story 24)", () => {
  it("is the same on SQLite and the memory mirror", () => {
    migrate(db, loadMigrations(packageMigrationsDir));
    const sqlite = closingBalance(sqliteCtxs(db));
    const memory = closingBalance(memoryCtxs());
    expect(memory).toEqual(sqlite);
    for (const [who, out] of [
      ["sqlite", sqlite],
      ["memory", memory],
    ] as const) {
      expect(out.closed, who).toEqual({ kind: "closing-balance", balanceCents: 1000 });
      expect(out.listed, who).toEqual(out.closed);
      expect(out.itemsB, who).toEqual([["ACCT", "account"]]);
      expect(out.edited, who).toEqual({ kind: "closing-balance", balanceCents: 800 });
      expect(out.itemsAfterEdit, who).toEqual([["ACCT", "account"]]);
      expect(out.zero, who).toBeNull();
      expect(out.itemsZero, who).toEqual([]);
      expect(out.reopened, who).toBeNull();
      expect(out.property, who).toBeNull();
      expect(out.itemsProperty, who).toEqual([]);
      expect(out.privateAItems, who).toEqual([["ACCT", "account"]]);
      expect(out.privateBSame, who).toBe(true);
    }
  });
});

/** The archive (story 25) on one adapter: what each list holds, with accounts named by label. */
function archive(ctxs: Ctxs) {
  const { sys } = ctxs;
  const pa = createPerson(sys, { displayName: "A", colour: "#000000" });
  const pb = createPerson(sys, { displayName: "B", colour: "#ffffff" });
  const A = ctxs.as(pa);
  const B = ctxs.as(pb);
  const labels = new Map<string, string>();
  const make = (label: string, isPrivate: boolean) => {
    const id = createAccount(sys, {
      name: label,
      type: "savings",
      currency: "AUD",
      isPrivate,
      owners: isPrivate
        ? own(pa)
        : [
            { personId: pa, shareBp: 5000 },
            { personId: pb, shareBp: 5000 },
          ],
    });
    labels.set(id, label);
    return id;
  };
  const listed = (ctx: UseCaseContext, includeClosed?: boolean) =>
    listAccounts(ctx, includeClosed === undefined ? {} : { includeClosed })
      .map((row) => `${labels.get(row.id)}${row.closedOn === null ? "" : `@${row.closedOn}`}`)
      .sort();
  const out: Record<string, unknown> = {};

  make("open", false);
  const closed = make("closed", false);
  const future = make("future", false);
  const priv = make("private", true);
  txn(A, closed, "2026-09-01", 500);
  closeAccount(A, { id: closed, closedOn: "2026-09-10" });
  closeAccount(A, { id: future, closedOn: "2026-12-31" });
  closeAccount(A, { id: priv, closedOn: "2026-09-10" });
  out.defaultB = listed(B);
  out.defaultFalseB = listed(B, false);
  out.allB = listed(B, true);
  out.defaultA = listed(A);
  out.allA = listed(A, true);
  out.record = [
    getAccount(B, { id: closed }).closedOn,
    listTransactions(B).filter((t) => t.accountId === closed).length,
    accountBalanceAsOf(B, { accountId: closed, date: "2026-09-27" }),
    listAudit(B).some((entry) => entry.entity === "account" && entry.entityId === closed),
  ];
  out.badInput = outcome(() => listAccounts(A, { includeClosed: "yes" } as never));
  updateAccount(A, { id: closed, closedOn: null });
  out.reopened = listed(B);
  return out;
}

describe("closed accounts are archived (story 25)", () => {
  it("lists the same on SQLite and the memory mirror", () => {
    migrate(db, loadMigrations(packageMigrationsDir));
    const sqlite = archive(sqliteCtxs(db));
    const memory = archive(memoryCtxs());
    expect(memory).toEqual(sqlite);
    for (const [who, out] of [
      ["sqlite", sqlite],
      ["memory", memory],
    ] as const) {
      expect(out.defaultB, who).toEqual(["future@2026-12-31", "open"]);
      expect(out.defaultFalseB, who).toEqual(out.defaultB);
      expect(out.allB, who).toEqual(["closed@2026-09-10", "future@2026-12-31", "open"]);
      expect(out.defaultA, who).toEqual(["future@2026-12-31", "open"]);
      expect(out.allA, who).toEqual([
        "closed@2026-09-10",
        "future@2026-12-31",
        "open",
        "private@2026-09-10",
      ]);
      expect(out.record, who).toEqual(["2026-09-10", 1, 500, true]);
      expect(out.badInput, who).toBe("Validation");
      expect(out.reopened, who).toEqual(["closed", "future@2026-12-31", "open"]);
    }
  });
});
