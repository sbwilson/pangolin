// The accounts use cases on real SQLite (the app package may not import an adapter in its
// sources). Their parity with the memory mirror is in packages/app/src/testing/accounts-parity.test.ts.
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
  createPerson,
  createTransaction,
  deleteTransaction,
  getAccount,
  getTransaction,
  listAccounts,
  listBalanceSnapshots,
  listInstitutions,
  personViewer,
  recordBalanceSnapshot,
  setPrivacy,
  setSplitField,
  type UseCaseContext,
  updateAccount,
  updateInstitution,
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-accounts-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  let ms = now.epochMilliseconds;
  const base = {
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
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

  it("lets a person remove only themself from the owners; the system may remove anyone", () => {
    const id = make(as(a));
    expect(() => updateAccount(as(a), { id, owners: own(a) })).toThrow(
      expect.objectContaining({
        code: "Validation",
        message: "You can only remove yourself from an account's owners",
      }),
    );
    expect(getAccount(as(a), { id }).owners).toEqual(joint());
    expect(auditFor("account", id).map((row) => row.action)).toEqual(["create"]);
    expect(updateAccount(as(b), { id, owners: own(a) }).owners).toEqual(own(a));
    const other = make(as(a));
    expect(updateAccount(sys, { id: other, owners: own(b) }).owners).toEqual(own(b));
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
    // createTransaction is untouched by a closed account.
    expect(() => txn(as(a), id, "2026-09-28", -100)).not.toThrow();
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
