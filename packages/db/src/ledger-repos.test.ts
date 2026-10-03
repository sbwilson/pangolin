import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAccount,
  createIdGenerator,
  createPerson,
  createTransaction,
  listTransactions,
  personViewer,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { visibleAccounts, visibleTxn } from "./privacy.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");

let dir: string;
let db: Db;
let sys: UseCaseContext;
let as: (id: Id<"Person">) => UseCaseContext;
let a: Id<"Person">;
let b: Id<"Person">;
let shared: Id<"Account">;
let privateA: Id<"Account">;
let privateB: Id<"Account">;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-ledger-"));
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
  const account = (name: string, owners: [Id<"Person">, number][], isPrivate: boolean) =>
    createAccount(sys, {
      name,
      type: "transaction",
      currency: "AUD",
      isPrivate,
      owners: owners.map(([personId, shareBp]) => ({ personId, shareBp })),
    });
  shared = account(
    "Joint",
    [
      [a, 5000],
      [b, 5000],
    ],
    false,
  );
  privateA = account("A private", [[a, 10000]], true);
  privateB = account("B private", [[b, 10000]], true);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const txn = (accountId: string, description: string, postedOn = "2026-09-01") => ({
  accountId,
  postedOn,
  amountCents: -1250,
  description,
});

describe("visibleAccounts and visibleTxn", () => {
  it("throw without a viewer", () => {
    expect(() => visibleAccounts(undefined)).toThrow(TypeError);
    expect(() => visibleTxn(undefined)).toThrow(TypeError);
  });

  it("add no filter for a system viewer", () => {
    expect(visibleAccounts(systemViewer("cli:test"))).toBeUndefined();
    expect(visibleTxn(systemViewer("cli:test"))).toBeUndefined();
  });
});

describe("transactions per viewer", () => {
  it("shows the shared account to both partners and each their own private one only", () => {
    createTransaction(as(a), txn(shared, "joint"));
    createTransaction(as(a), txn(privateA, "a-only"));
    createTransaction(as(b), txn(privateB, "b-only"));
    const names = (ctx: UseCaseContext) =>
      listTransactions(ctx)
        .map((row) => row.descriptionRaw)
        .sort();
    expect(names(as(a))).toEqual(["a-only", "joint"]);
    expect(names(as(b))).toEqual(["b-only", "joint"]);
    expect(names(sys)).toEqual(["a-only", "b-only", "joint"]);
  });

  it("returns splits, newest first, with the owner as a private split's beneficiary", () => {
    createTransaction(as(a), txn(privateA, "old", "2026-01-01"));
    createTransaction(as(a), txn(shared, "new", "2026-03-01"));
    const rows = listTransactions(as(a));
    expect(rows.map((row) => row.descriptionRaw)).toEqual(["new", "old"]);
    expect(rows[0]?.splits.map((s) => s.beneficiary)).toEqual(["shared"]);
    expect(rows[1]?.splits.map((s) => s.beneficiary)).toEqual([a]);
    expect(rows[1]?.splits[0]?.amountCents).toBe(-1250);
  });

  it("answers NotFound when B creates in A's private account, writing nothing", () => {
    const auditBefore = db.prepare("SELECT count(*) FROM audit_log").pluck().get();
    expect(() => createTransaction(as(b), txn(privateA, "nope"))).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    expect(db.prepare('SELECT count(*) FROM "transaction"').pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM audit_log").pluck().get()).toBe(auditBefore);
  });

  it("audits the account and transaction creates with their account id", () => {
    const id = createTransaction(as(a), txn(shared, "joint"));
    const rows = db
      .prepare(
        "SELECT entity, entity_id, account_id, action, actor FROM audit_log WHERE account_id IS NOT NULL ORDER BY at, id",
      )
      .all();
    expect(rows).toContainEqual({
      entity: "transaction",
      entity_id: id,
      account_id: shared,
      action: "create",
      actor: `person:${a}`,
    });
    expect(rows).toContainEqual({
      entity: "account",
      entity_id: privateA,
      account_id: privateA,
      action: "create",
      actor: "cli:test",
    });
  });

  it("creates STRICT tables with their constraints", () => {
    const strict = db
      .prepare(
        "SELECT name FROM pragma_table_list WHERE name IN ('account','account_owner','transaction','split') AND strict = 1 ORDER BY name",
      )
      .pluck()
      .all();
    expect(strict).toEqual(["account", "account_owner", "split", "transaction"]);
    expect(() =>
      db
        .prepare(
          "INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at) VALUES ('x','n','bogus','AUD',0,'t','t')",
        )
        .run(),
    ).toThrow(/account_type/);
  });
});
