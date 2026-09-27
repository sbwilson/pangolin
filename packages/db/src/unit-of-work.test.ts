import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  createIdGenerator,
  createPerson,
  fixedClock,
  getHouseholdSettings,
  type IdGenerator,
  personViewer,
  type UnitOfWork,
  type UseCaseContext,
  updateHouseholdSettings,
  write,
} from "@pangolin/app";
import { idSchema } from "@pangolin/shared";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const personId = idSchema("Person").parse("01J0000000000000000000000A");
const now = Temporal.Instant.from("2026-09-27T01:02:03Z");

let dir: string;
let path: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-uow-"));
  path = join(dir, "test.sqlite");
  db = openDatabase(path);
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function context(uow: UnitOfWork = createUnitOfWork(db), newId?: IdGenerator): UseCaseContext {
  return {
    viewer: personViewer(personId, now),
    clock: fixedClock(parseDate("2026-09-27"), now),
    newId: newId ?? createIdGenerator({ now: () => now.epochMilliseconds, random: Math.random }),
    uow,
  };
}

interface SettingsRecord {
  id: number;
  base_currency: string;
  fy_start: string;
  timezone: string;
  shared_attribution: string;
  updated_at: string;
}

function settingsRows(): SettingsRecord[] {
  return db.prepare("SELECT * FROM household_settings").all() as SettingsRecord[];
}

function auditRows(): Record<string, unknown>[] {
  return db.prepare("SELECT * FROM audit_log ORDER BY id").all() as Record<string, unknown>[];
}

/** A unit of work whose audit append always throws, on the real database. */
function failingAudit(real: UnitOfWork): UnitOfWork {
  return {
    read: real.read,
    transaction: (fn) =>
      real.transaction((tx) =>
        fn({
          ...tx,
          audit: {
            append: () => {
              throw new Error("audit append failed");
            },
          },
        }),
      ),
  };
}

describe("migration 0001", () => {
  it("inserts the one household_settings row with the v1 defaults", () => {
    const rows = settingsRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      base_currency: "AUD",
      fy_start: "07-01",
      timezone: "Australia/Sydney",
      shared_attribution: "contribution",
    });
    expect(rows[0]?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("allows no second settings row and no unknown attribution", () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO household_settings VALUES (2, 'AUD', '07-01', 'UTC', 'even', '2026-01-01T00:00:00Z')",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.prepare("UPDATE household_settings SET shared_attribution = 'half'").run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it("allows only JSON or NULL in audit before/after", () => {
    const insert = db.prepare(
      "INSERT INTO audit_log (id, at, actor, entity, entity_id, action, before, after) VALUES (?, 'x', 'x', 'x', 'x', 'x', ?, ?)",
    );
    insert.run("a", null, '{"ok":true}');
    expect(() => insert.run("b", "not json", null)).toThrow(/CHECK constraint failed/);
  });

  it("creates the person table with a unique, nullable user_id", () => {
    const insert = db.prepare(
      "INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at) VALUES (?, ?, 'P', '#000', 'x', 'x')",
    );
    insert.run("p1", null);
    insert.run("p2", null);
    insert.run("p3", "u1");
    expect(() => insert.run("p4", "u1")).toThrow(/UNIQUE constraint failed/);
  });

  it("indexes audit_log by entity and by time", () => {
    const indexes = db
      .prepare("SELECT name FROM pragma_index_list('audit_log') WHERE origin = 'c' ORDER BY name")
      .pluck()
      .all();
    expect(indexes).toEqual(["audit_log_at_idx", "audit_log_entity_idx"]);
  });
});

describe("updateHouseholdSettings on SQLite", () => {
  it("updates the row and writes exactly one matching audit row", () => {
    const before = getHouseholdSettings(context(), {});
    const after = updateHouseholdSettings(context(), { timezone: "Australia/Brisbane" });

    expect(after).toEqual({
      ...before,
      timezone: "Australia/Brisbane",
      updatedAt: "2026-09-27T01:02:03.000Z",
    });
    expect(getHouseholdSettings(context(), {})).toEqual(after);
    expect(settingsRows()[0]).toMatchObject({
      timezone: "Australia/Brisbane",
      updated_at: "2026-09-27T01:02:03.000Z",
    });

    const audit = auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: `person:${personId}`,
      at: "2026-09-27T01:02:03.000Z",
      entity: "household_settings",
      entity_id: "1",
      action: "update",
      account_id: null,
      person_id: null,
    });
    expect(audit[0]?.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(JSON.parse(audit[0]?.before as string)).toEqual(before);
    expect(JSON.parse(audit[0]?.after as string)).toEqual(after);
  });

  it("writes neither the settings nor an audit row when the audit append throws", () => {
    const before = settingsRows();
    const ctx = context(failingAudit(createUnitOfWork(db)));
    expect(() => updateHouseholdSettings(ctx, { timezone: "Australia/Brisbane" })).toThrow(
      "audit append failed",
    );
    expect(settingsRows()).toEqual(before);
    expect(auditRows()).toEqual([]);
    expect(db.inTransaction).toBe(false);
  });

  it("rolls back the settings when SQLite rejects the audit row", () => {
    // A generator that always returns the same ID: the second audit insert breaks the PK.
    const sameId = (() => "01J00000000000000000000001") as unknown as IdGenerator;
    updateHouseholdSettings(context(undefined, sameId), { timezone: "Australia/Brisbane" });
    expect(() =>
      updateHouseholdSettings(context(undefined, sameId), { timezone: "Australia/Perth" }),
    ).toThrow(/UNIQUE constraint failed: audit_log.id/);
    expect(settingsRows()[0]?.timezone).toBe("Australia/Brisbane");
    expect(auditRows()).toHaveLength(1);
  });

  it("writes nothing for invalid input", () => {
    const before = settingsRows();
    expect(() => updateHouseholdSettings(context(), { timezone: "Not/A_Zone" })).toThrow(AppError);
    expect(settingsRows()).toEqual(before);
    expect(auditRows()).toEqual([]);
  });
});

describe("createPerson on SQLite", () => {
  it("inserts the person row and its audit row in one transaction", () => {
    const id = createPerson(context(), { displayName: "Alex", colour: "#2563EB" });
    expect(db.prepare("SELECT * FROM person").all()).toEqual([
      {
        id,
        user_id: null,
        display_name: "Alex",
        colour: "#2563EB",
        created_at: "2026-09-27T01:02:03.000Z",
        updated_at: "2026-09-27T01:02:03.000Z",
        deleted_at: null,
      },
    ]);
    expect(auditRows()).toEqual([
      expect.objectContaining({ entity: "person", entity_id: id, action: "create", before: null }),
    ]);
  });

  it("writes no person when the audit append throws", () => {
    const ctx = context(failingAudit(createUnitOfWork(db)));
    expect(() => createPerson(ctx, { displayName: "Alex", colour: "#2563EB" })).toThrow(
      "audit append failed",
    );
    expect(db.prepare("SELECT count(*) FROM person").pluck().get()).toBe(0);
  });

  it("refuses the person repository after the transaction ended", () => {
    const tx = createUnitOfWork(db).transaction((repos) => repos);
    expect(() => tx.person.insert({} as never)).toThrow(/outside its transaction/);
  });
});

describe("createUnitOfWork", () => {
  it("runs the callback inside a write transaction that holds the lock", () => {
    const other = openDatabase(path);
    other.pragma("busy_timeout = 0");
    try {
      createUnitOfWork(db).transaction(() => {
        expect(db.inTransaction).toBe(true);
        // BEGIN IMMEDIATE took the write lock up front, so another writer is refused.
        expect(() => other.exec("BEGIN IMMEDIATE")).toThrow(/database is locked/);
      });
    } finally {
      other.close();
    }
    expect(db.inTransaction).toBe(false);
  });

  it("reads without taking the write lock", () => {
    const other = openDatabase(path);
    other.pragma("busy_timeout = 0");
    try {
      createUnitOfWork(db).read((repos) => {
        repos.householdSettings.get();
        expect(db.inTransaction).toBe(true);
        // A deferred read holds only a shared lock, so another writer can still begin.
        other.exec("BEGIN IMMEDIATE");
        other.exec("ROLLBACK");
      });
    } finally {
      other.close();
    }
    expect(db.inTransaction).toBe(false);
  });

  it("rolls back when the callback returns a promise", () => {
    const uow = createUnitOfWork(db);
    const before = settingsRows();
    expect(() =>
      write(context(uow), async (tx) => {
        tx.householdSettings.update({ ...tx.householdSettings.get(), timezone: "UTC" });
      }),
    ).toThrow(/promise/);
    expect(settingsRows()).toEqual(before);
    expect(db.inTransaction).toBe(false);
  });

  it("refuses repository calls after the transaction ended", () => {
    const uow = createUnitOfWork(db);
    const tx = uow.transaction((repos) => repos);
    expect(() => tx.householdSettings.get()).toThrow(/outside its transaction/);
    expect(() => tx.audit.append({} as never)).toThrow(/outside its transaction/);
    const read = uow.read((repos) => repos);
    expect(() => read.householdSettings.get()).toThrow(/outside its transaction/);
  });

  it("reads inside a read transaction", () => {
    const uow = createUnitOfWork(db);
    const settings = uow.read((repos) => {
      expect(db.inTransaction).toBe(true);
      return repos.householdSettings.get();
    });
    expect(settings.baseCurrency).toBe("AUD");
    expect(db.inTransaction).toBe(false);
  });
});
