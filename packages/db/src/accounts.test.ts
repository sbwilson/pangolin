// The accounts use cases on real SQLite (the app package may not import an adapter in its
// sources). Their parity with the memory mirror is in packages/app/src/testing/accounts-parity.test.ts.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  balanceAsOf as accountBalanceAsOf,
  closeAccount,
  createAccount,
  createActivity,
  createIdGenerator,
  createInstitution,
  createPayee,
  createPayeeAlias,
  createPerson,
  createTag,
  createTransaction,
  createTransferGroup,
  defineReviewKind,
  deleteTransaction,
  getAccount,
  getTransaction,
  hideTransactionName,
  leaveHousehold,
  listAccounts,
  listBalanceSnapshots,
  listInstitutions,
  listReviewItems,
  listTransactions,
  personViewer,
  raiseReviewItem,
  recordBalanceSnapshot,
  rejoinAccount,
  setPrivacy,
  setSplitField,
  setSplitTags,
  syncClosingBalances,
  type TokenPort,
  type UseCaseContext,
  updateAccount,
  updateInstitution,
  updateTransaction,
  write,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { balanceAsOf as dbBalanceAsOf } from "./balance.ts";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");

let dir: string;
let db: Db;
let sys: UseCaseContext;
let as: (id: Id<"Person">) => UseCaseContext;
let a: Id<"Person">;
let b: Id<"Person">;
/** The clock's today, moved by a test with `setToday`; reset to `now`'s day before each test. */
let clockDay: string;
const setToday = (day: string) => {
  clockDay = day;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-accounts-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  let ms = now.epochMilliseconds;
  clockDay = "2026-09-27";
  const base = {
    clock: { now: () => now, today: () => Temporal.PlainDate.from(clockDay) },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
  sys = { ...base, viewer: systemViewer("cli:test") };
  as = (id) => ({ ...base, viewer: personViewer(id, now) });
  a = createPerson(sys, { displayName: "A", colour: "#000000" });
  b = createPerson(sys, { displayName: "B", colour: "#ffffff" });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const own = (id: Id<"Person">) => [{ personId: id, shareBp: 10000 }];
const joint = () => [
  { personId: a, shareBp: 5000 },
  { personId: b, shareBp: 5000 },
];
const make = (
  ctx: UseCaseContext,
  over: Partial<Parameters<typeof createAccount>[1]> = {},
): Id<"Account"> =>
  createAccount(ctx, {
    name: "Acct",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: joint(),
    ...over,
  });
const txn = (ctx: UseCaseContext, accountId: string, postedOn: string, amountCents: number) =>
  createTransaction(ctx, {
    accountId,
    postedOn,
    amountCents,
    description: `${postedOn} ${amountCents}`,
  });

const auditFor = (entity: string, entityId: string) =>
  db
    .prepare(
      "SELECT action, account_id, actor FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY at, id",
    )
    .all(entity, entityId) as { action: string; account_id: string | null; actor: string }[];

const code = (code: string) => expect.objectContaining({ code });

describe("privacy of ids (AD-5)", () => {
  it("answers NotFound to the partner for every read and write of a private account", () => {
    const priv = make(as(a), { isPrivate: true, owners: own(a) });
    const bctx = as(b);
    const calls: (() => unknown)[] = [
      () => getAccount(bctx, { id: priv }),
      () => updateAccount(bctx, { id: priv, name: "x" }),
      () => closeAccount(bctx, { id: priv }),
      () => setPrivacy(bctx, { id: priv, isPrivate: false }),
      () => rejoinAccount(bctx, { id: priv }),
      () => accountBalanceAsOf(bctx, { accountId: priv, date: "2026-09-27" }),
      () => listBalanceSnapshots(bctx, { accountId: priv }),
      () => recordBalanceSnapshot(bctx, { accountId: priv, asOf: "2026-09-01", balanceCents: 1 }),
    ];
    for (const call of calls) expect(call).toThrow(code("NotFound"));
    expect(listAccounts(bctx).map((row) => row.id)).not.toContain(priv);
    expect(listAccounts(as(a)).map((row) => row.id)).toContain(priv);
    // Nothing was written by the refused calls.
    expect(auditFor("account", priv).map((row) => row.action)).toEqual(["create"]);
    expect(db.prepare("SELECT count(*) FROM balance_snapshot").pluck().get()).toBe(0);
  });
});

describe("createAccount", () => {
  it("takes an institution, an opening date and the savings flag, and returns the pool", () => {
    const inst = createInstitution(sys, { name: "Bank", kind: "bank" });
    const id = make(sys, {
      institutionId: inst.id,
      openedOn: "2024-01-31",
      isSavings: true,
      type: "savings",
    });
    expect(getAccount(as(a), { id })).toMatchObject({
      institutionId: inst.id,
      openedOn: "2024-01-31",
      isSavings: true,
      pool: "shared",
    });
    expect(getAccount(as(a), { id }).owners).toHaveLength(2);
  });

  it("audits the create with the account's own id as account_id", () => {
    const id = make(sys);
    expect(auditFor("account", id)).toEqual([
      { action: "create", account_id: id, actor: "cli:test" },
    ]);
  });

  it("refuses a currency other than the base currency", () => {
    expect(() => make(sys, { currency: "USD" })).toThrow(code("Validation"));
    expect(db.prepare("SELECT count(*) FROM account").pluck().get()).toBe(0);
  });

  it("refuses an unknown institution", () => {
    expect(() => make(sys, { institutionId: "nope" })).toThrow(code("Validation"));
  });
});

describe("updateAccount", () => {
  it("edits fields, replaces owners and audits one update with the accountId", () => {
    const inst = createInstitution(sys, { name: "Bank", kind: "bank" });
    const id = make(as(a));
    const after = updateAccount(as(a), {
      id,
      name: "Renamed",
      institutionId: inst.id,
      isSavings: true,
      owners: [
        { personId: a, shareBp: 7000 },
        { personId: b, shareBp: 3000 },
      ],
    });
    expect(after).toMatchObject({ name: "Renamed", isSavings: true, pool: "shared" });
    expect(getAccount(as(b), { id }).owners).toEqual([
      { personId: a, shareBp: 7000 },
      { personId: b, shareBp: 3000 },
    ]);
    expect(auditFor("account", id).at(-1)).toEqual({
      action: "update",
      account_id: id,
      actor: `person:${a}`,
    });
  });

  it("moves the pool to the sole owner when the other removes themself", () => {
    const id = make(as(a));
    expect(updateAccount(as(b), { id, owners: own(a) }).pool).toBe(a);
  });

  it("refuses another currency, a type change, bad owners and a private account's second owner", () => {
    const id = make(as(a));
    const priv = make(as(a), { isPrivate: true, owners: own(a) });
    for (const input of [
      { id, currency: "USD" },
      { id, type: "savings" },
      { id, owners: [{ personId: a, shareBp: 4000 }] },
      { id, owners: [{ personId: "nobody", shareBp: 10000 }] },
      { id: priv, owners: joint() },
      { id: priv, owners: own(b) },
    ]) {
      expect(() => updateAccount(as(a), input as never)).toThrow(code("Validation"));
    }
    expect(updateAccount(as(a), { id, currency: "AUD" }).currency).toBe("AUD");
  });

  it("lets an owner share a public account, remove the other or change shares", () => {
    const id = make(as(a), { owners: own(a) });
    expect(updateAccount(as(a), { id, owners: joint() }).owners).toEqual(joint());
    const audit = db
      .prepare("SELECT before, after FROM audit_log WHERE entity_id = ? AND action = 'update'")
      .get(id) as { before: string; after: string };
    const listed = (json: string) =>
      (JSON.parse(json) as { owners: { personId: string; shareBp: number }[] }).owners.map((o) => ({
        personId: o.personId,
        shareBp: o.shareBp,
      }));
    expect(listed(audit.before)).toEqual(own(a));
    expect(listed(audit.after)).toEqual(joint());
    const shares = [
      { personId: a, shareBp: 2500 },
      { personId: b, shareBp: 7500 },
    ];
    expect(updateAccount(as(b), { id, owners: shares }).owners).toEqual(shares);
    expect(updateAccount(as(a), { id, owners: own(a) }).owners).toEqual(own(a));
    expect(updateAccount(as(a), { id, owners: own(b) }).owners).toEqual(own(b));
    const other = make(as(a));
    expect(updateAccount(sys, { id: other, owners: own(b) }).owners).toEqual(own(b));
    expect(() => updateAccount(as(a), { id: other, owners: [] })).toThrow(code("Validation"));
  });

  it("lets a non-owner only join: the new list is the owners plus themself", () => {
    const id = make(as(a), { owners: own(a) });
    const c = createPerson(sys, { displayName: "C", colour: "#888888" });
    const refused = [
      [], // empty
      own(b), // drops the owner
      [
        { personId: a, shareBp: 5000 },
        { personId: c, shareBp: 5000 },
      ], // joins without themself, with a third person
      [
        { personId: a, shareBp: 4000 },
        { personId: b, shareBp: 3000 },
        { personId: c, shareBp: 3000 },
      ], // owners plus themself plus a third person
    ];
    for (const owners of refused) {
      expect(() => updateAccount(as(b), { id, owners })).toThrow(code("Validation"));
    }
    // Dropping an owner or adding someone else says what to do instead.
    for (const owners of [
      own(b),
      [
        { personId: a, shareBp: 5000 },
        { personId: c, shareBp: 5000 },
      ],
    ]) {
      expect(() => updateAccount(as(b), { id, owners })).toThrow(
        expect.objectContaining({
          code: "Validation",
          message:
            "Add yourself to the current owners: you cannot change who else owns this account",
        }),
      );
    }
    expect(getAccount(as(a), { id }).owners).toEqual(own(a));
    expect(auditFor("account", id).map((row) => row.action)).toEqual(["create"]);
    // By decision (Simon accepted it), a joiner sets the shares: the existing owner at 1 bp and
    // the joiner at 9999 is allowed, as only the people are checked, not the split between them.
    const skewed = [
      { personId: a, shareBp: 1 },
      { personId: b, shareBp: 9999 },
    ];
    expect(updateAccount(as(b), { id, owners: skewed }).owners).toEqual(skewed);
    const plain = make(as(a), { owners: own(a) });
    expect(updateAccount(as(b), { id: plain, owners: joint() }).owners).toEqual(joint());
  });

  it("marks a removed person and puts them back at their share on rejoin", () => {
    const id = make(as(a), {
      owners: [
        { personId: a, shareBp: 3000 },
        { personId: b, shareBp: 7000 },
      ],
    });
    expect(getAccount(as(b), { id }).removal).toBeUndefined();
    expect(() => rejoinAccount(as(b), { id })).toThrow(code("Validation"));
    updateAccount(as(a), { id, owners: own(a) });
    const removed = getAccount(as(b), { id });
    expect(removed.owners).toEqual(own(a));
    expect(removed.removal).toEqual({
      by: a,
      at: "2026-09-27T00:00:00.000Z",
      previousOwners: [
        { personId: a, shareBp: 3000 },
        { personId: b, shareBp: 7000 },
      ],
    });
    expect(listAccounts(as(b)).find((row) => row.id === id)?.removal?.by).toBe(a);
    expect(getAccount(as(a), { id }).removal).toBeUndefined();
    expect(getAccount(sys, { id }).removal).toBeUndefined();
    expect(() => rejoinAccount(sys, { id })).toThrow(code("Validation"));
    expect(() => rejoinAccount(as(a), { id })).toThrow(code("Validation"));

    const back = rejoinAccount(as(b), { id });
    expect(back.owners.map((o) => [o.personId, o.shareBp])).toEqual([
      [a, 3000],
      [b, 7000],
    ]);
    expect(back.removal).toBeUndefined();
    expect(getAccount(as(b), { id }).removal).toBeUndefined();
    expect(auditFor("account", id).at(-1)).toEqual({
      action: "update",
      account_id: id,
      actor: `person:${b}`,
    });
    expect(() => rejoinAccount(as(b), { id })).toThrow(code("Validation"));
  });

  it("scales the current owner when a removed person rejoins, and marks a person who left", () => {
    const id = make(as(a));
    updateAccount(as(b), { id, owners: own(a) });
    expect(getAccount(as(b), { id }).removal?.by).toBe(b);
    // A changes the account while B is away; the latest removal still names B's leaving.
    updateAccount(as(a), { id, name: "Renamed", owners: own(a) });
    expect(getAccount(as(b), { id }).removal?.by).toBe(b);
    expect(rejoinAccount(as(b), { id }).owners).toEqual([
      { personId: a, shareBp: 5000 },
      { personId: b, shareBp: 5000 },
    ]);
    // A hands the account over entirely: B's previous share leaves A one basis point.
    updateAccount(as(b), { id, owners: own(a) });
    updateAccount(as(a), { id, owners: own(b) });
    expect(getAccount(as(a), { id }).removal?.previousOwners).toEqual(own(a));
    expect(rejoinAccount(as(a), { id }).owners).toEqual([
      { personId: b, shareBp: 1 },
      { personId: a, shareBp: 9999 },
    ]);
  });

  it("reads the latest removal of a person removed twice, and rejoins at the share held before it", () => {
    const later = Temporal.Instant.from("2026-09-28T00:00:00Z");
    const at = (id: Id<"Person">): UseCaseContext => ({
      ...as(id),
      clock: { now: () => later, today: () => later.toZonedDateTimeISO("UTC").toPlainDate() },
    });
    const id = make(as(a));
    updateAccount(as(a), { id, owners: own(a) });
    expect(getAccount(as(b), { id }).removal).toMatchObject({
      by: a,
      at: "2026-09-27T00:00:00.000Z",
    });
    rejoinAccount(as(b), { id });
    // The shares change, so the second removal's previous owners differ from the first's.
    const held = [
      { personId: a, shareBp: 2000 },
      { personId: b, shareBp: 8000 },
    ];
    updateAccount(as(a), { id, owners: held });
    updateAccount(at(b), { id, owners: own(a) });
    const removal = getAccount(as(b), { id }).removal;
    expect(removal).toEqual({ by: b, at: "2026-09-28T00:00:00.000Z", previousOwners: held });
    expect(listAccounts(as(b)).find((row) => row.id === id)?.removal).toEqual(removal);
    expect(rejoinAccount(as(b), { id }).owners).toEqual(held);
  });

  it("does not show another person's private account or its removal, and a private account stays single", () => {
    const gone = make(as(a));
    updateAccount(as(a), { id: gone, owners: own(a) });
    expect(getAccount(as(b), { id: gone }).removal?.by).toBe(a);
    setPrivacy(as(a), { id: gone, isPrivate: true });
    expect(() => getAccount(as(b), { id: gone })).toThrow(code("NotFound"));
    expect(listAccounts(as(b)).map((row) => row.id)).not.toContain(gone);
    expect(() => rejoinAccount(as(b), { id: gone })).toThrow(code("NotFound"));
    const priv = make(as(a), { isPrivate: true, owners: own(a) });
    expect(() => updateAccount(as(a), { id: priv, owners: joint() })).toThrow(code("Validation"));
    expect(() => updateAccount(as(a), { id: priv, owners: own(b) })).toThrow(code("Validation"));
    expect(() => updateAccount(as(b), { id: priv, owners: joint() })).toThrow(code("NotFound"));
  });

  it("reopens an account when closedOn is cleared", () => {
    const id = make(as(a));
    closeAccount(as(a), { id, closedOn: "2026-09-01" });
    expect(updateAccount(as(a), { id, closedOn: null }).closedOn).toBeNull();
  });
});

describe("closeAccount", () => {
  it("sets closedOn only, defaults to today, audits and refuses a second close", () => {
    const id = make(as(a), { openedOn: "2020-01-01" });
    const before = getAccount(as(a), { id });
    const closed = closeAccount(as(a), { id });
    expect(closed).toMatchObject({ closedOn: "2026-09-27", name: before.name, pool: "shared" });
    expect(auditFor("account", id).at(-1)).toMatchObject({ action: "close", account_id: id });
    expect(() => closeAccount(as(a), { id })).toThrow(code("Conflict"));
    // A closed account takes entries up to its closed date and refuses later ones.
    expect(() => txn(as(a), id, "2026-09-27", -100)).not.toThrow();
    expect(() => txn(as(a), id, "2026-09-28", -100)).toThrow(code("Conflict"));
  });

  it("refuses a close before the opening date", () => {
    const id = make(as(a), { openedOn: "2026-01-01" });
    expect(() => closeAccount(as(a), { id, closedOn: "2025-12-31" })).toThrow(code("Validation"));
  });
});

describe("setPrivacy", () => {
  it("is refused with Conflict while a live split is shared, and changes nothing", () => {
    const id = make(as(a), { owners: own(a) });
    txn(as(a), id, "2026-09-01", -100);
    expect(() => setPrivacy(as(a), { id, isPrivate: true })).toThrow(code("Conflict"));
    expect(getAccount(as(a), { id }).isPrivate).toBe(false);
    expect(auditFor("account", id).map((row) => row.action)).toEqual(["create"]);
  });

  it("counts live transactions only", () => {
    const id = make(as(a), { owners: own(a) });
    const t = txn(as(a), id, "2026-09-01", -100);
    db.prepare('UPDATE "transaction" SET deleted_at = ? WHERE id = ?').run(
      "2026-09-02T00:00:00Z",
      t,
    );
    expect(setPrivacy(as(a), { id, isPrivate: true }).isPrivate).toBe(true);
    expect(auditFor("account", id).at(-1)).toMatchObject({ action: "set_privacy", account_id: id });
    expect(() => getAccount(as(b), { id })).toThrow(code("NotFound"));
  });

  it("is refused with Validation for a two-owner account, until it is edited down", () => {
    const id = make(as(a));
    expect(() => setPrivacy(as(a), { id, isPrivate: true })).toThrow(code("Validation"));
    updateAccount(as(b), { id, owners: own(a) });
    expect(setPrivacy(as(a), { id, isPrivate: true })).toMatchObject({ isPrivate: true, pool: a });
  });

  it("lets a person make only their own account private", () => {
    const id = make(as(a), { owners: own(b) });
    expect(() => setPrivacy(as(a), { id, isPrivate: true })).toThrow(code("Validation"));
  });

  it("is refused with Conflict while a live split is for the partner", () => {
    const id = make(as(a), { owners: own(a) });
    const t = txn(as(a), id, "2026-09-01", -100);
    const splitId = getTransaction(as(a), { id: t }).splits[0]?.id ?? "";
    const set = (value: string) =>
      setSplitField(as(a), { transactionId: t, splitId, field: "beneficiary", value });
    set(b);
    expect(() => setPrivacy(as(a), { id, isPrivate: true })).toThrow(code("Conflict"));
    expect(getAccount(as(a), { id }).isPrivate).toBe(false);
    set(a);
    expect(setPrivacy(as(a), { id, isPrivate: true }).isPrivate).toBe(true);
  });

  it("refuses public while owner-scoped rows are in use, naming them, then scopes the history", () => {
    const id = make(as(a), { isPrivate: true, owners: own(a) });
    const payee = createPayee(as(a), { name: "Chemist", originAccountId: id });
    const activity = createActivity(as(a), { name: "Bali", originAccountId: id });
    const t = createTransaction(as(a), {
      accountId: id,
      postedOn: "2026-09-01",
      amountCents: -100,
      description: "x",
      payeeId: payee.id,
    });
    const splitId = getTransaction(as(a), { id: t }).splits[0]?.id ?? "";
    setSplitField(as(a), { transactionId: t, splitId, field: "activity", value: activity.id });
    const refused = (() => {
      try {
        setPrivacy(as(a), { id, isPrivate: false });
      } catch (error) {
        return error as { code: string; message: string; details: unknown };
      }
      return undefined;
    })();
    expect(refused?.code).toBe("Conflict");
    expect(refused?.message).toContain('payee "Chemist", activity "Bali"');
    expect(refused?.details).toEqual({
      payees: [{ id: payee.id, name: "Chemist" }],
      tags: [],
      activities: [{ id: activity.id, name: "Bali" }],
      owners: [{ personId: a, displayName: "A" }],
    });
    expect(getAccount(as(a), { id }).isPrivate).toBe(true);
    deleteTransaction(as(a), { id: t });
    expect(setPrivacy(as(a), { id, isPrivate: false }).isPrivate).toBe(false);
    const scopes = db
      .prepare("SELECT action, person_id FROM audit_log WHERE account_id = ? ORDER BY at, id")
      .all(id) as { action: string; person_id: string | null }[];
    expect(scopes.at(-1)).toEqual({ action: "set_privacy", person_id: null });
    expect(scopes.slice(0, -1).every((row) => row.person_id === a)).toBe(true);
  });

  it("leaves an already public account and its history alone", () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", -100);
    expect(setPrivacy(as(b), { id, isPrivate: false }).isPrivate).toBe(false);
    const scoped = db
      .prepare("SELECT count(*) FROM audit_log WHERE account_id = ? AND person_id IS NOT NULL")
      .pluck()
      .get(id);
    expect(scoped).toBe(0);
  });

  it("makes an account public with no split rule", () => {
    const id = make(as(a), { isPrivate: true, owners: own(a) });
    expect(setPrivacy(as(a), { id, isPrivate: false }).isPrivate).toBe(false);
    expect(getAccount(as(b), { id }).id).toBe(id);
  });
});

describe("institutions", () => {
  it("creates, renames and lists household-wide, audited without an accountId", () => {
    const first = createInstitution(as(a), {
      name: "Zed Bank",
      kind: "bank",
      websiteUrl: "https://zed.example",
    });
    const second = createInstitution(as(b), { name: "Alpha Super", kind: "super_fund" });
    const renamed = updateInstitution(as(b), { id: first.id, name: "Zeta Bank", websiteUrl: null });
    expect(renamed).toMatchObject({ name: "Zeta Bank", websiteUrl: null });
    expect(listInstitutions(as(a)).map((row) => row.name)).toEqual(["Alpha Super", "Zeta Bank"]);
    for (const [id, actions] of [
      [first.id, ["create", "update"]],
      [second.id, ["create"]],
    ] as const) {
      const rows = auditFor("institution", id);
      expect(rows.map((row) => row.action)).toEqual(actions);
      expect(rows.every((row) => row.account_id === null)).toBe(true);
    }
  });

  it("refuses an unknown id and a non-http address", () => {
    expect(() => updateInstitution(as(a), { id: "nope", name: "x" })).toThrow(code("NotFound"));
    expect(() =>
      createInstitution(as(a), { name: "x", kind: "bank", websiteUrl: "javascript:1" }),
    ).toThrow(code("Validation"));
  });
});

describe("balance snapshots", () => {
  it("records for any viewer who sees the account, audited with the accountId", () => {
    const id = make(as(a));
    const snap = recordBalanceSnapshot(as(b), {
      accountId: id,
      asOf: "2026-09-01",
      balanceCents: 1000,
    });
    expect(snap.source).toBe("manual");
    expect(listBalanceSnapshots(as(a), { accountId: id })).toHaveLength(1);
    expect(auditFor("balance_snapshot", snap.id)).toEqual([
      { action: "create", account_id: id, actor: `person:${b}` },
    ]);
  });
});

describe("balanceAsOf", () => {
  it("is the snapshot plus later transactions: 1000, -100 on the day, -50 after => 950", () => {
    const id = make(as(a));
    recordBalanceSnapshot(as(a), { accountId: id, asOf: "2026-09-01", balanceCents: 1000 });
    txn(as(a), id, "2026-09-01", -100);
    txn(as(a), id, "2026-09-03", -50);
    expect(accountBalanceAsOf(as(a), { accountId: id, date: "2026-09-05" })).toBe(950);
    expect(accountBalanceAsOf(as(a), { accountId: id, date: "2026-09-02" })).toBe(1000);
    // Before the snapshot there is none to use: every live row up to the date counts.
    expect(accountBalanceAsOf(as(a), { accountId: id, date: "2026-08-31" })).toBe(0);
  });

  it("starts at 0 with no snapshot, counts pending, and skips soft-deleted rows", () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", -100);
    const pending = txn(as(a), id, "2026-09-02", -50);
    const gone = txn(as(a), id, "2026-09-03", -7000);
    db.prepare("UPDATE \"transaction\" SET status = 'pending' WHERE id = ?").run(pending);
    db.prepare("UPDATE \"transaction\" SET deleted_at = '2026-09-04T00:00:00Z' WHERE id = ?").run(
      gone,
    );
    expect(accountBalanceAsOf(as(a), { accountId: id, date: "2026-09-27" })).toBe(-150);
    expect(accountBalanceAsOf(as(a), { accountId: id })).toBe(-150);
  });

  it("breaks snapshot ties by created_at, then id", () => {
    const id = make(as(a));
    const ins = (sid: string, cents: number, createdAt: string) =>
      db
        .prepare(
          "INSERT INTO balance_snapshot (id, account_id, as_of, balance_cents, source, created_at, updated_at) VALUES (?, ?, '2026-09-01', ?, 'manual', ?, ?)",
        )
        .run(sid, id, cents, createdAt, createdAt);
    ins("S1", 100, "2026-09-01T10:00:00Z");
    ins("S2", 200, "2026-09-01T11:00:00Z");
    ins("S3", 300, "2026-09-01T11:00:00Z");
    expect(accountBalanceAsOf(sys, { accountId: id, date: "2026-09-01" })).toBe(300);
  });

  it("refuses non-cash types with Validation", () => {
    const id = make(as(a), { type: "brokerage" });
    expect(() => accountBalanceAsOf(as(a), { accountId: id, date: "2026-09-27" })).toThrow(
      code("Validation"),
    );
  });

  it("is the db function the manifest reuses", () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", -100);
    expect(dbBalanceAsOf(db, id, "2026-09-27")).toBe(-100);
    expect(() => dbBalanceAsOf(db, id, "tomorrow")).toThrow(TypeError);
  });
});

describe("a non-zero closing balance is a warning", () => {
  const items = (ctx: UseCaseContext) =>
    listReviewItems(ctx).filter((item) => item.kind === "accounts.closing-balance");
  const resolutions = () =>
    db
      .prepare("SELECT resolution FROM review_item WHERE kind = 'accounts.closing-balance'")
      .pluck()
      .all();

  it("closes with a balance: the view names it and one account-scoped item opens", () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", 12500);
    const closed = closeAccount(as(a), { id, closedOn: "2026-09-10" });
    expect(closed.warning).toEqual({ kind: "closing-balance", balanceCents: 12500 });
    expect(getAccount(as(b), { id }).warning).toEqual(closed.warning);
    expect(listAccounts(as(a)).some((row) => row.id === id)).toBe(false);
    expect(
      listAccounts(as(a), { includeClosed: true }).find((row) => row.id === id)?.warning,
    ).toEqual(closed.warning);
    expect(items(as(b))).toMatchObject([{ accountId: id, entityRef: `account:${id}` }]);
    expect(items(as(a))).toHaveLength(1);
  });

  it("has no warning and no item at a zero balance, or for a non-cash type", () => {
    const zero = make(as(a));
    expect(closeAccount(as(a), { id: zero, closedOn: "2026-09-10" }).warning).toBeUndefined();
    const property = make(as(a), { type: "property" });
    createTransaction(sys, {
      accountId: property,
      postedOn: "2026-09-01",
      amountCents: 500,
      description: "x",
    });
    expect(closeAccount(as(a), { id: property, closedOn: "2026-09-10" }).warning).toBeUndefined();
    expect(getAccount(as(a), { id: property }).warning).toBeUndefined();
    expect(items(as(a))).toEqual([]);
  });

  it("resolves when an entry, a snapshot or a deletion brings the balance to zero, and raises again", () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", 1000);
    closeAccount(as(a), { id, closedOn: "2026-09-10" });
    expect(items(as(a))).toHaveLength(1);
    // A second non-zero balance changes nothing: still one open item.
    const out = txn(as(a), id, "2026-09-05", -400);
    expect(getAccount(as(a), { id }).warning?.balanceCents).toBe(600);
    expect(items(as(a))).toHaveLength(1);
    // An edit to zero resolves it.
    updateTransaction(as(a), { id: out, amountCents: -1000 });
    expect(getAccount(as(a), { id }).warning).toBeUndefined();
    expect(items(as(a))).toEqual([]);
    // Deleting that entry makes it non-zero again: a new item.
    deleteTransaction(as(a), { id: out });
    expect(getAccount(as(a), { id }).warning?.balanceCents).toBe(1000);
    expect(items(as(a))).toHaveLength(1);
    // A snapshot of zero on the closed date resolves it.
    recordBalanceSnapshot(as(a), { accountId: id, asOf: "2026-09-10", balanceCents: 0 });
    expect(getAccount(as(a), { id }).warning).toBeUndefined();
    expect(items(as(a))).toEqual([]);
    expect(resolutions()).toEqual([
      "the closing balance reached zero",
      "the closing balance reached zero",
    ]);
  });

  it("follows a moved closed date and resolves when the account is opened again", () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", 1000);
    closeAccount(as(a), { id, closedOn: "2026-09-05" });
    expect(getAccount(as(a), { id }).warning?.balanceCents).toBe(1000);
    expect(items(as(a))).toHaveLength(1);
    // The system viewer is exempt from the lock: a later entry that zeroes the balance on the
    // new date once the closed date moves later.
    txn(sys, id, "2026-09-08", -1000);
    expect(getAccount(as(a), { id }).warning?.balanceCents).toBe(1000);
    expect(items(as(a))).toHaveLength(1);
    expect(updateAccount(as(a), { id, closedOn: "2026-09-08" }).warning).toBeUndefined();
    expect(items(as(a))).toEqual([]);
    // Another account is reopened with its balance still non-zero.
    const other = make(as(a));
    txn(as(a), other, "2026-09-01", 300);
    closeAccount(as(a), { id: other, closedOn: "2026-09-05" });
    expect(items(as(a))).toHaveLength(1);
    expect(updateAccount(as(a), { id: other, closedOn: null }).warning).toBeUndefined();
    expect(items(as(a))).toEqual([]);
    expect(resolutions()).toEqual([
      "the closing balance reached zero",
      "the account was opened again",
    ]);
  });

  it("carries the warning on the views setPrivacy and rejoinAccount return", () => {
    const warning = { kind: "closing-balance", balanceCents: 500 };
    // A snapshot, not an entry, holds the balance: an entry's split for "shared" would stop a
    // public account going private.
    const held = () => {
      const id = make(as(a));
      recordBalanceSnapshot(as(a), { accountId: id, asOf: "2026-09-01", balanceCents: 500 });
      closeAccount(as(a), { id, closedOn: "2026-09-10" });
      return id;
    };
    const toPrivate = held();
    updateAccount(as(a), { id: toPrivate, owners: own(a) });
    expect(setPrivacy(as(a), { id: toPrivate, isPrivate: true }).warning).toEqual(warning);
    expect(setPrivacy(as(a), { id: toPrivate, isPrivate: false }).warning).toEqual(warning);

    const left = held();
    updateAccount(as(a), { id: left, owners: own(a) });
    expect(rejoinAccount(as(b), { id: left }).warning).toEqual(warning);

    // Without a non-zero closing balance neither view carries one.
    const clear = make(as(a));
    closeAccount(as(a), { id: clear, closedOn: "2026-09-10" });
    updateAccount(as(a), { id: clear, owners: own(a) });
    expect(rejoinAccount(as(b), { id: clear }).warning).toBeUndefined();
    updateAccount(as(b), { id: clear, owners: own(b) });
    expect(setPrivacy(as(b), { id: clear, isPrivate: true }).warning).toBeUndefined();
  });

  it("is invisible to the partner for a private account", () => {
    const priv = make(as(a), { isPrivate: true, owners: own(a) });
    txn(as(a), priv, "2026-09-01", 700);
    const listBefore = listAccounts(as(b), { includeClosed: true });
    const reviewBefore = listReviewItems(as(b));
    closeAccount(as(a), { id: priv, closedOn: "2026-09-10" });
    expect(listAccounts(as(b), { includeClosed: true })).toEqual(listBefore);
    expect(listReviewItems(as(b))).toEqual(reviewBefore);
    expect(items(as(a))).toHaveLength(1);
    expect(items(as(b))).toEqual([]);
  });
});

describe("closed accounts are archived, never deleted", () => {
  const ids = (ctx: UseCaseContext, includeClosed?: boolean) =>
    listAccounts(ctx, includeClosed === undefined ? {} : { includeClosed })
      .map((row) => row.id)
      .sort();

  it("leaves a closed account out of the default list and adds it on request", () => {
    const open = make(as(a));
    const closed = make(as(a));
    closeAccount(as(a), { id: closed, closedOn: "2026-09-10" });
    expect(ids(as(a))).toEqual([open]);
    expect(ids(as(a), false)).toEqual([open]);
    expect(ids(as(a), true)).toEqual([open, closed].sort());
    expect(
      listAccounts(as(b), { includeClosed: true }).find((r) => r.id === closed)?.closedOn,
    ).toBe("2026-09-10");
  });

  it("keeps the record of a closed account intact", () => {
    const id = make(as(a));
    const entry = txn(as(a), id, "2026-09-01", 500);
    recordBalanceSnapshot(as(a), { accountId: id, asOf: "2026-09-05", balanceCents: 500 });
    closeAccount(as(a), { id, closedOn: "2026-09-10" });
    expect(ids(as(b))).not.toContain(id);
    expect(getAccount(as(b), { id }).closedOn).toBe("2026-09-10");
    expect(getTransaction(as(b), { id: entry }).accountId).toBe(id);
    expect(listTransactions(as(b)).transactions.some((t) => t.id === entry)).toBe(true);
    expect(listBalanceSnapshots(as(b), { accountId: id })).toHaveLength(1);
    expect(accountBalanceAsOf(as(b), { accountId: id, date: "2026-09-27" })).toBe(500);
    expect(auditFor("account", id).map((row) => row.action)).toEqual(["create", "close"]);
    expect(auditFor("transaction", entry).map((row) => row.action)).toEqual(["create"]);
  });

  it("returns a reopened account to the default list", () => {
    const id = make(as(a));
    closeAccount(as(a), { id, closedOn: "2026-09-10" });
    expect(ids(as(a))).not.toContain(id);
    updateAccount(as(a), { id, closedOn: null });
    expect(ids(as(a))).toContain(id);
  });

  it("keeps an account with a future closed date in the default list until that date", () => {
    const today = make(as(a));
    const future = make(as(a));
    const past = make(as(a));
    closeAccount(as(a), { id: today, closedOn: "2026-09-27" });
    closeAccount(as(a), { id: future, closedOn: "2026-09-28" });
    closeAccount(as(a), { id: past, closedOn: "2026-09-26" });
    expect(ids(as(a))).toEqual([future]);
    expect(ids(as(a), true)).toEqual([today, future, past].sort());
  });

  it("never shows a partner a closed private account, with or without includeClosed", () => {
    const priv = make(as(a), { isPrivate: true, owners: own(a) });
    closeAccount(as(a), { id: priv, closedOn: "2026-09-10" });
    expect(ids(as(b))).not.toContain(priv);
    expect(ids(as(b), true)).not.toContain(priv);
    expect(ids(as(a), true)).toContain(priv);
    expect(ids(as(a))).not.toContain(priv);
  });

  it("rejects an includeClosed that is not a boolean", () => {
    expect(() => listAccounts(as(a), { includeClosed: "yes" } as never)).toThrow(
      code("Validation"),
    );
  });
});

// ------------------------------------------------------------------------ leaving the household

const tokens: TokenPort = {
  generate: () => randomBytes(32).toString("base64url"),
  hash: (token) => `hash:${token}`,
  randomBytes: (length) => new Uint8Array(randomBytes(length)),
};
const ACCOUNT_ITEM = defineReviewKind({
  kind: "leave-test.account-item",
  module: "system",
  scope: "account",
});
const PERSON_ITEM = defineReviewKind({
  kind: "leave-test.person-item",
  module: "system",
  scope: "person",
});

describe("leaving the household (story 26)", () => {
  /** A context that can leave: `as` plus the token port, and a session this old. */
  const leaver = (id: Id<"Person">, ageMs = 0) => ({
    ...as(id),
    viewer: personViewer(id, now.subtract({ milliseconds: ageMs })),
    tokens,
  });
  const count = (sql: string, ...args: unknown[]) =>
    db
      .prepare(sql)
      .pluck()
      .get(...args) as number;
  /** Every table's rows in rowid order: equal before and after proves a refusal changed nothing. */
  const dump = (): string =>
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .pluck()
        .all() as string[]
    )
      .sort()
      .map(
        (name) =>
          `${name}: ${JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())}`,
      )
      .join("\n");
  const at = "2026-09-27T00:00:00.000Z";
  /** A login for `person`: password, TOTP, passkey, session and recovery codes. */
  const login = (person: Id<"Person">, user: string) => {
    db.prepare(
      `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
       VALUES (?, ?, ?, 0, 1, ?, ?)`,
    ).run(user, user, `${user}@example.com`, at, at);
    db.prepare(
      `INSERT INTO auth_account (id, user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES (?, ?, ?, 'credential', 'old-hash', ?, ?)`,
    ).run(`acc-${user}`, user, user, at, at);
    db.prepare(
      "INSERT INTO auth_two_factor (id, user_id, secret, backup_codes, verified) VALUES (?, ?, 's', '[]', 1)",
    ).run(`tf-${user}`, user);
    db.prepare(
      `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
       VALUES (?, ?, 'k', ?, 0, 'singleDevice', 0)`,
    ).run(`pk-${user}`, user, `cred-${user}`);
    db.prepare(
      `INSERT INTO auth_session (id, user_id, token, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, '2026-09-28T00:00:00.000Z', ?, ?)`,
    ).run(`s-${user}`, user, `t-${user}`, at, at);
    db.prepare(
      "INSERT INTO recovery_code (id, person_id, code_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run(`rc-${user}`, person, `h-${user}`, at);
    db.prepare("UPDATE person SET user_id = ? WHERE id = ?").run(user, person);
  };
  const owners = (accountId: string) =>
    db
      .prepare(
        "SELECT person_id, share_bp FROM account_owner WHERE account_id = ? ORDER BY person_id",
      )
      .all(accountId) as { person_id: string; share_bp: number }[];
  const firstSplit = (id: string) => getTransaction(as(a), { id }).splits[0]?.id as string;

  /** A's private data and what it touches: every row the matrix names. */
  function household() {
    login(a, "user-a");
    login(b, "user-b");
    const A = as(a);
    const B = as(b);
    const priv = make(A, { name: "A private", isPrivate: true, owners: own(a) });
    const closed = make(A, { name: "A closed", isPrivate: true, owners: own(a) });
    const shared = make(A, { name: "Joint" });
    const sole = make(A, { name: "A alone", owners: own(a) });

    const tag = createTag(A, { name: "A tag", originAccountId: priv });
    const payee = createPayee(A, { name: "A payee", originAccountId: priv });
    const alias = createPayeeAlias(A, {
      payeeId: payee.id,
      pattern: "A PAYEE",
      matchKind: "contains",
      originAccountId: priv,
    });
    const activity = createActivity(A, { name: "A trip", originAccountId: priv });
    const t1 = createTransaction(A, {
      accountId: priv,
      postedOn: "2026-09-01",
      amountCents: -500,
      description: "A secret one",
      payeeId: payee.id,
    });
    const split = firstSplit(t1);
    setSplitTags(A, { transactionId: t1, splitId: split, tagIds: [tag.id] });
    setSplitField(A, { transactionId: t1, splitId: split, field: "activity", value: activity.id });
    recordBalanceSnapshot(A, { accountId: priv, asOf: "2026-09-01", balanceCents: 9000 });
    const t2 = txn(A, closed, "2026-09-02", 700);
    recordBalanceSnapshot(A, { accountId: closed, asOf: "2026-09-02", balanceCents: 700 });
    closeAccount(A, { id: closed, closedOn: "2026-09-05" });

    // A transfer from A's private entry to B's entry in the joint account.
    const bSide = txn(B, shared, "2026-09-01", 500);
    createTransferGroup(A, { transactionIds: [t1, bSide] });
    // A shared transaction of A's, its name hidden from B.
    const aShared = txn(A, shared, "2026-09-03", -900);
    hideTransactionName(A, { id: aShared, until: "2026-12-01" });
    const aSole = txn(A, sole, "2026-09-03", -100);

    write(A, (tx, audit) => {
      raiseReviewItem(tx, audit, A, {
        kind: ACCOUNT_ITEM,
        entityRef: "x:priv",
        dedupeKey: "leave-test:priv",
        accountId: priv,
      });
      raiseReviewItem(tx, audit, A, {
        kind: PERSON_ITEM,
        entityRef: "x:a",
        dedupeKey: "leave-test:a",
        personId: a,
      });
    });
    return {
      priv,
      closed,
      shared,
      sole,
      tag,
      payee,
      alias,
      activity,
      t1,
      t2,
      bSide,
      aShared,
      aSole,
      split,
    };
  }

  it("deletes the private data, lifts the hidings, hands over the shared accounts and revokes the login", () => {
    const h = household();
    // A shared row that points at A's scoped rows (a shape the use cases refuse, planted).
    db.prepare('UPDATE "transaction" SET payee_id = ? WHERE id = ?').run(h.payee.id, h.aShared);
    const sharedSplit = firstSplit(h.aShared);
    db.prepare("UPDATE split SET activity_id = ? WHERE id = ?").run(h.activity.id, sharedSplit);
    db.prepare(
      "INSERT INTO split_tag (split_id, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(sharedSplit, h.tag.id, at, at);
    const bBefore = listTransactions(as(b)).transactions.filter((row) => row.id === h.bSide);

    leaveHousehold(leaver(a), { confirm: true });

    // The private accounts and everything in them are gone.
    for (const id of [h.priv, h.closed]) {
      expect(count("SELECT count(*) FROM account WHERE id = ?", id)).toBe(0);
      expect(count("SELECT count(*) FROM account_owner WHERE account_id = ?", id)).toBe(0);
      expect(count('SELECT count(*) FROM "transaction" WHERE account_id = ?', id)).toBe(0);
      expect(count("SELECT count(*) FROM balance_snapshot WHERE account_id = ?", id)).toBe(0);
      expect(count("SELECT count(*) FROM review_item WHERE account_id = ?", id)).toBe(0);
      expect(count("SELECT count(*) FROM audit_log WHERE account_id = ?", id)).toBe(0);
    }
    for (const id of [h.t1, h.t2]) {
      expect(count("SELECT count(*) FROM split WHERE transaction_id = ?", id)).toBe(0);
      expect(count("SELECT count(*) FROM audit_log WHERE entity_id = ?", id)).toBe(0);
    }
    expect(count("SELECT count(*) FROM transfer_group")).toBe(0);
    // A's scoped rows, their audit rows and the person-scoped items are gone.
    for (const table of ["payee", "payee_alias", "tag", "activity"]) {
      expect(count(`SELECT count(*) FROM ${table} WHERE scope_person_id = ?`, a), table).toBe(0);
    }
    expect(count("SELECT count(*) FROM split_tag WHERE tag_id = ?", h.tag.id)).toBe(0);
    expect(count("SELECT count(*) FROM audit_log WHERE person_id = ?", a)).toBe(0);
    expect(
      count(
        "SELECT count(*) FROM audit_log WHERE entity_id IN (?, ?, ?, ?)",
        h.payee.id,
        h.alias.id,
        h.tag.id,
        h.activity.id,
      ),
    ).toBe(0);
    expect(count("SELECT count(*) FROM review_item WHERE person_id = ?", a)).toBe(0);

    // The shared row that used A's scoped rows is kept, the references cleared.
    expect(
      db.prepare('SELECT payee_id FROM "transaction" WHERE id = ?').pluck().get(h.aShared),
    ).toBeNull();
    expect(
      db.prepare("SELECT activity_id FROM split WHERE id = ?").pluck().get(sharedSplit),
    ).toBeNull();

    // B's side of the transfer stays, unlinked, and says so only to the owner's scope.
    const survivor = getTransaction(as(b), { id: h.bSide });
    expect(survivor.transferGroupId).toBeNull();
    expect(survivor.transferLabel ?? null).toBeNull();
    expect(bBefore).toHaveLength(1);

    // The hiding is lifted: B reads the real name.
    const lifted = getTransaction(as(b), { id: h.aShared });
    expect(lifted.descriptionRaw).toBe("2026-09-03 -900");
    expect(lifted.nameHidden).toBe(false);
    expect(lifted.nameHiddenBy).toBeNull();
    expect(lifted.nameHiddenUntil).toBeNull();

    // Every shared account and its expenses stay, B the sole owner of each; a public account A
    // owned alone passes to B.
    expect(owners(h.shared)).toEqual([{ person_id: b, share_bp: 10000 }]);
    expect(owners(h.sole)).toEqual([{ person_id: b, share_bp: 10000 }]);
    expect(
      listAccounts(as(b))
        .map((row) => row.id)
        .sort(),
    ).toEqual([h.shared, h.sole].sort());
    expect(getAccount(as(b), { id: h.shared }).pool).toBe(b);
    for (const id of [h.aShared, h.aSole, h.bSide]) {
      expect(
        listTransactions(as(b)).transactions.some((row) => row.id === id),
        id,
      ).toBe(true);
    }
    // The owner swap is audited as the owner list change, in view of B.
    const swap = auditFor("account", h.shared).map((row) => row.action);
    expect(swap).toContain("update");

    // The person is marked left; no credential, passkey, session or code remains.
    expect(db.prepare("SELECT deleted_at FROM person WHERE id = ?").pluck().get(a)).toEqual(
      expect.any(String),
    );
    for (const table of ["auth_session", "auth_passkey", "auth_two_factor"]) {
      expect(count(`SELECT count(*) FROM ${table} WHERE user_id = 'user-a'`), table).toBe(0);
    }
    expect(count("SELECT count(*) FROM recovery_code WHERE person_id = ?", a)).toBe(0);
    expect(count("SELECT two_factor_enabled FROM auth_user WHERE id = 'user-a'")).toBe(0);
    const password = db
      .prepare("SELECT password FROM auth_account WHERE user_id = 'user-a'")
      .pluck()
      .get() as string;
    expect(password).not.toBe("old-hash");
    expect(password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    // B's login is untouched.
    expect(count("SELECT count(*) FROM auth_session WHERE user_id = 'user-b'")).toBe(1);
    expect(count("SELECT count(*) FROM auth_passkey WHERE user_id = 'user-b'")).toBe(1);
    // The leave itself is on record, with no scope.
    expect(auditFor("person", a).map((row) => row.action)).toEqual(["create", "leave"]);
    // A can no longer act.
    expect(() => leaveHousehold(leaver(a), { confirm: true })).toThrow(code("Unauthenticated"));
  });

  it("leaves with no private data: the shared accounts pass to the partner and nothing else changes", () => {
    login(a, "user-a");
    const shared = make(as(a), { name: "Joint" });
    const entry = txn(as(a), shared, "2026-09-03", -900);
    const before = listTransactions(as(b)).transactions;

    leaveHousehold(leaver(a), { confirm: true });

    expect(owners(shared)).toEqual([{ person_id: b, share_bp: 10000 }]);
    expect(listTransactions(as(b)).transactions.map((row) => row.id)).toEqual(
      before.map((row) => row.id),
    );
    expect(getTransaction(as(b), { id: entry }).amountCents).toBe(-900);
    expect(count("SELECT count(*) FROM account")).toBe(1);
    expect(count("SELECT count(*) FROM auth_session WHERE user_id = 'user-a'")).toBe(0);
  });

  it("changes nothing and answers ReauthRequired when the sign-in is older than the window", () => {
    household();
    const before = dump();
    expect(() => leaveHousehold(leaver(a, 6 * 60_000), { confirm: true })).toThrow(
      code("ReauthRequired"),
    );
    expect(dump()).toBe(before);
    // Inside the window it goes through.
    leaveHousehold(leaver(a, 4 * 60_000), { confirm: true });
    expect(count("SELECT count(*) FROM person WHERE deleted_at IS NOT NULL")).toBe(1);
  });

  it("changes nothing and answers Validation without a confirmation", () => {
    household();
    const before = dump();
    for (const input of [{}, { confirm: false }, { confirm: "true" }, { confirm: 1 }, null]) {
      expect(() => leaveHousehold(leaver(a), input as never), JSON.stringify(input)).toThrow(
        code("Validation"),
      );
    }
    expect(() => leaveHousehold(leaver(a), { confirm: true, extra: 1 } as never)).toThrow(
      code("Validation"),
    );
    expect(dump()).toBe(before);
  });

  it("checks the confirmation before the sign-in is asked for again", () => {
    household();
    const before = dump();
    expect(() => leaveHousehold(leaver(a, 6 * 60_000), {} as never)).toThrow(code("Validation"));
    expect(dump()).toBe(before);
  });

  it("answers Conflict, changing nothing, when there is no partner to hand over to", () => {
    household();
    db.prepare("UPDATE person SET deleted_at = ? WHERE id = ?").run(at, b);
    const before = dump();
    expect(() => leaveHousehold(leaver(a), { confirm: true })).toThrow(code("Conflict"));
    expect(dump()).toBe(before);
  });

  it("is for a person: the system viewer cannot leave", () => {
    household();
    const before = dump();
    expect(() => leaveHousehold({ ...sys, tokens }, { confirm: true })).toThrow(
      code("Unauthenticated"),
    );
    expect(dump()).toBe(before);
  });

  it("is all or nothing: a failure at the end undoes the deletes", () => {
    household();
    db.exec(
      "CREATE TRIGGER no_leave BEFORE UPDATE OF deleted_at ON person BEGIN SELECT RAISE(ABORT, 'no leave'); END",
    );
    const before = dump();
    expect(() => leaveHousehold(leaver(a), { confirm: true })).toThrow(/no leave/);
    expect(dump()).toBe(before);
  });

  it("deletes a closed private account despite its lock, and one that was soft-deleted", () => {
    const closed = make(as(a), { isPrivate: true, owners: own(a) });
    txn(as(a), closed, "2026-09-01", 100);
    closeAccount(as(a), { id: closed, closedOn: "2026-09-02" });
    const gone = make(as(a), { isPrivate: true, owners: own(a) });
    txn(as(a), gone, "2026-09-01", 100);
    db.prepare("UPDATE account SET deleted_at = ? WHERE id = ?").run(at, gone);

    leaveHousehold(leaver(a), { confirm: true });

    for (const id of [closed, gone]) {
      expect(count("SELECT count(*) FROM account WHERE id = ?", id)).toBe(0);
      expect(count('SELECT count(*) FROM "transaction" WHERE account_id = ?', id)).toBe(0);
    }
  });

  it("unlinks the surviving side of a transfer and audits it as the owner's", () => {
    const priv = make(as(a), { isPrivate: true, owners: own(a) });
    const bPriv = make(as(b), { isPrivate: true, owners: own(b) });
    const mine = txn(as(a), priv, "2026-09-01", -300);
    const theirs = txn(as(b), bPriv, "2026-09-01", 300);
    // Link them directly: a person cannot see the other's private entry.
    const group = "01J0000000000000000000GROUP";
    db.prepare(
      "INSERT INTO transfer_group (id, matched_by, created_at, updated_at) VALUES (?, 'manual', ?, ?)",
    ).run(group, at, at);
    db.prepare('UPDATE "transaction" SET transfer_group_id = ? WHERE id IN (?, ?)').run(
      group,
      mine,
      theirs,
    );

    leaveHousehold(leaver(a), { confirm: true });

    expect(getTransaction(as(b), { id: theirs }).transferGroupId).toBeNull();
    expect(count("SELECT count(*) FROM transfer_group")).toBe(0);
    const row = db
      .prepare(
        "SELECT person_id, account_id FROM audit_log WHERE entity_id = ? AND action = 'update' ORDER BY at DESC, id DESC",
      )
      .get(theirs) as { person_id: string | null; account_id: string };
    expect(row).toEqual({ person_id: b, account_id: bPriv });
  });

  it("lifts a hiding on an account that has turned private to the partner, audited as the partner's", () => {
    const acct = make(as(a), { name: "Was joint" });
    const entry = txn(as(a), acct, "2026-09-03", -900);
    hideTransactionName(as(a), { id: entry, until: "2026-12-01" });
    updateAccount(as(b), { id: acct, owners: own(b) });
    setSplitField(as(b), {
      transactionId: entry,
      splitId: firstSplit(entry),
      field: "beneficiary",
      value: b,
    });
    setPrivacy(as(b), { id: acct, isPrivate: true });
    // The hiding outlives the switch: A's, on B's own private account, until the leave lifts it.
    expect(getTransaction(as(b), { id: entry }).nameHidden).toBe(true);
    expect(
      db.prepare('SELECT name_hidden_by FROM "transaction" WHERE id = ?').pluck().get(entry),
    ).toBe(a);

    leaveHousehold(leaver(a), { confirm: true });

    expect(getTransaction(as(b), { id: entry }).nameHidden).toBe(false);
    expect(
      db.prepare('SELECT name_hidden_by FROM "transaction" WHERE id = ?').pluck().get(entry),
    ).toBeNull();
    const lift = db
      .prepare(
        "SELECT person_id, account_id, actor, after FROM audit_log WHERE entity_id = ? AND action = 'update' ORDER BY at DESC, id DESC",
      )
      .all(entry) as {
      person_id: string | null;
      account_id: string;
      actor: string;
      after: string;
    }[];
    const last = lift[0];
    expect(last).toMatchObject({ person_id: b, account_id: acct, actor: `person:${a}` });
    expect(JSON.parse(last?.after ?? "{}")).toMatchObject({
      nameHiddenBy: null,
      nameHiddenUntil: null,
    });
    // The lifted private account is the partner's alone, and kept.
    expect(count("SELECT count(*) FROM account WHERE id = ?", acct)).toBe(1);
  });

  it("lifts a lapsed hiding and a hiding on a closed account, bypassing the closed-date lock", () => {
    const acct = make(as(a), { name: "Closing" });
    const entry = txn(as(a), acct, "2026-09-03", -900);
    hideTransactionName(as(a), { id: entry, until: "2026-12-01" });
    closeAccount(as(a), { id: acct, closedOn: "2026-09-03" });
    // The entry sits on the closed date: moving the lock below it would refuse an unhide.
    db.prepare('UPDATE "transaction" SET posted_on = ? WHERE id = ?').run("2026-09-10", entry);

    leaveHousehold(leaver(a), { confirm: true });

    expect(
      db.prepare('SELECT name_hidden_until FROM "transaction" WHERE id = ?').pluck().get(entry),
    ).toBeNull();
  });

  it("never lifts a hiding the partner made", () => {
    const acct = make(as(a), { name: "Joint" });
    const entry = txn(as(b), acct, "2026-09-03", -900);
    hideTransactionName(as(b), { id: entry, until: "2026-12-01" });

    leaveHousehold(leaver(a), { confirm: true });

    expect(
      db.prepare('SELECT name_hidden_by FROM "transaction" WHERE id = ?').pluck().get(entry),
    ).toBe(b);
  });

  it("keeps the partner's own private data, scoped rows and items", () => {
    const bPriv = make(as(b), { isPrivate: true, owners: own(b) });
    const bPayee = createPayee(as(b), { name: "B payee", originAccountId: bPriv });
    const entry = createTransaction(as(b), {
      accountId: bPriv,
      postedOn: "2026-09-01",
      amountCents: -100,
      description: "B secret",
      payeeId: bPayee.id,
    });
    write(as(b), (tx, audit) =>
      raiseReviewItem(tx, audit, as(b), {
        kind: PERSON_ITEM,
        entityRef: "x:b",
        dedupeKey: "leave-test:b",
        personId: b,
      }),
    );
    const auditRows = count(
      "SELECT count(*) FROM audit_log WHERE person_id = ? OR account_id = ?",
      b,
      bPriv,
    );

    leaveHousehold(leaver(a), { confirm: true });

    expect(getTransaction(as(b), { id: entry }).payeeId).toBe(bPayee.id);
    expect(count("SELECT count(*) FROM payee WHERE scope_person_id = ?", b)).toBe(1);
    expect(count("SELECT count(*) FROM review_item WHERE person_id = ?", b)).toBe(1);
    expect(
      count("SELECT count(*) FROM audit_log WHERE person_id = ? OR account_id = ?", b, bPriv),
    ).toBe(auditRows);
  });

  it("keeps the audit rows of shared data, whoever authored them", () => {
    const shared = make(as(a), { name: "Joint" });
    const entry = txn(as(a), shared, "2026-09-03", -900);
    updateTransaction(as(b), { id: entry, notes: "B note" });
    const rows = count("SELECT count(*) FROM audit_log WHERE entity_id IN (?, ?)", shared, entry);

    leaveHousehold(leaver(a), { confirm: true });

    // Authored by A or not, the shared rows stay (and the owner swap adds one).
    expect(count("SELECT count(*) FROM audit_log WHERE entity_id IN (?, ?)", shared, entry)).toBe(
      rows + 1,
    );
    expect(
      count(
        "SELECT count(*) FROM audit_log WHERE entity_id = ? AND actor = ?",
        entry,
        `person:${a}`,
      ),
    ).toBeGreaterThan(0);
  });
});

describe("one closed state for the list, the warning and the review item", () => {
  const items = () =>
    listReviewItems(sys).filter((item) => item.kind === "accounts.closing-balance");
  const inList = (id: string, includeClosed = false) =>
    listAccounts(as(a), { includeClosed }).some((row) => row.id === id);
  const auditCount = () => db.prepare("SELECT COUNT(*) FROM audit_log").pluck().get();
  /** A cash account with 12 500 cents at its future closed date, 2026-10-05. */
  const closedForTheFuture = () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", 12500);
    closeAccount(as(a), { id, closedOn: "2026-10-05" });
    return id;
  };

  it("lists a future-closed account with no warning and no item, and the job changes nothing", () => {
    const id = closedForTheFuture();
    expect(inList(id)).toBe(true);
    expect(getAccount(as(a), { id }).warning).toBeUndefined();
    expect(
      listAccounts(as(a), { includeClosed: true }).find((row) => row.id === id)?.warning,
    ).toBeUndefined();
    expect(items()).toEqual([]);
    const before = auditCount();
    syncClosingBalances(sys);
    expect(items()).toEqual([]);
    expect(auditCount()).toBe(before);
  });

  it("locks entries after a future closed date, with its own wording, and takes those on or before it", () => {
    const id = closedForTheFuture();
    const message = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        expect((error as { code?: string }).code).toBe("Conflict");
        return (error as Error).message;
      }
      return "accepted";
    };
    expect(message(() => txn(as(a), id, "2026-10-06", -100))).toBe(
      "This account closes on 2026-10-05, so a transaction dated 2026-10-06 is locked. " +
        "Move the closed date to 2026-10-06 or later, move its manually entered transactions dated after 2026-10-05 back to on or before it, or reopen the account.",
    );
    expect(message(() => txn(as(a), id, "2026-10-05", -100))).toBe("accepted");
    expect(message(() => txn(as(a), id, "2026-09-10", -100))).toBe("accepted");
    expect(message(() => closeAccount(as(a), { id }))).toBe(
      "The account closes on 2026-10-05; change that date with updateAccount, or reopen it",
    );
    // The date arrives: the same refusals, in the closed wording.
    setToday("2026-10-05");
    expect(message(() => txn(as(a), id, "2026-10-06", -100))).toMatch(
      /^This account was closed on 2026-10-05, so a transaction dated 2026-10-06 is locked\./,
    );
    expect(message(() => closeAccount(as(a), { id }))).toBe("The account is already closed");
  });

  it("archives it, warns and raises one item when the date arrives and the job runs; a second run changes nothing", () => {
    const id = closedForTheFuture();
    setToday("2026-10-05");
    // The warning is derived on read; the item waits for the job.
    expect(inList(id)).toBe(false);
    expect(inList(id, true)).toBe(true);
    const warning = { kind: "closing-balance", balanceCents: 12500 };
    expect(getAccount(as(a), { id }).warning).toEqual(warning);
    expect(
      listAccounts(as(a), { includeClosed: true }).find((row) => row.id === id)?.warning,
    ).toEqual(warning);
    expect(items()).toEqual([]);
    syncClosingBalances(sys);
    expect(items()).toMatchObject([{ accountId: id, entityRef: `account:${id}` }]);
    expect(auditFor("review_item", items()[0]?.id ?? "").map((row) => row.actor)).toEqual([
      "cli:test",
    ]);
    const before = auditCount();
    syncClosingBalances(sys);
    expect(items()).toHaveLength(1);
    expect(auditCount()).toBe(before);
  });

  it("raises nothing at a zero balance when the date arrives", () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", 300);
    txn(as(a), id, "2026-09-02", -300);
    closeAccount(as(a), { id, closedOn: "2026-10-05" });
    setToday("2026-10-05");
    syncClosingBalances(sys);
    expect(getAccount(as(a), { id }).warning).toBeUndefined();
    expect(items()).toEqual([]);
  });

  it("moves the closed date into the future: the item is resolved until the date comes", () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", 700);
    closeAccount(as(a), { id, closedOn: "2026-09-10" });
    expect(items()).toHaveLength(1);
    updateAccount(as(a), { id, closedOn: "2026-10-05" });
    expect(items()).toEqual([]);
    expect(getAccount(as(a), { id }).warning).toBeUndefined();
    expect(inList(id)).toBe(true);
    expect(
      db
        .prepare("SELECT resolution FROM review_item WHERE kind = 'accounts.closing-balance'")
        .all(),
    ).toEqual([{ resolution: "the closed date has not come" }]);
    setToday("2026-10-05");
    syncClosingBalances(sys);
    expect(items()).toHaveLength(1);
  });

  it("resolves the item at reopening after the date arrived, and the job leaves open accounts alone", () => {
    const id = closedForTheFuture();
    setToday("2026-10-06");
    syncClosingBalances(sys);
    expect(items()).toHaveLength(1);
    updateAccount(as(a), { id, closedOn: null });
    expect(items()).toEqual([]);
    expect(getAccount(as(a), { id }).warning).toBeUndefined();
    const before = auditCount();
    syncClosingBalances(sys);
    expect(auditCount()).toBe(before);
  });

  it("keeps a closing on today's date raising in the close write, as before", () => {
    const id = make(as(a));
    txn(as(a), id, "2026-09-01", 900);
    expect(closeAccount(as(a), { id, closedOn: "2026-09-27" }).warning).toEqual({
      kind: "closing-balance",
      balanceCents: 900,
    });
    expect(items()).toHaveLength(1);
  });

  it("raises no item for a closed property account, and none for a private account a person cannot see", () => {
    const property = make(as(a), { type: "property" });
    createTransaction(sys, {
      accountId: property,
      postedOn: "2026-09-01",
      amountCents: 500,
      description: "x",
    });
    closeAccount(as(a), { id: property, closedOn: "2026-10-05" });
    const priv = make(as(a), { isPrivate: true, owners: own(a) });
    txn(as(a), priv, "2026-09-01", 100);
    closeAccount(as(a), { id: priv, closedOn: "2026-10-05" });
    setToday("2026-10-05");
    syncClosingBalances(sys);
    expect(getAccount(as(a), { id: property }).warning).toBeUndefined();
    // The job sees every account, so the private one gets its item; the partner sees neither.
    expect(items().map((item) => item.accountId)).toEqual([priv]);
    expect(listReviewItems(as(b))).toEqual([]);
  });
});
