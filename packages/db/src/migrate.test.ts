import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadMigrations,
  type Migration,
  MigrationError,
  migrate,
  packageMigrationsDir,
  schemaVersion,
} from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-migrate-"));
  db = openDatabase(join(dir, "test.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function rows(): unknown[] {
  return db.prepare("SELECT version, name FROM schema_migration ORDER BY version").all();
}

function foreignKeysOn(): boolean {
  return db.pragma("foreign_keys", { simple: true }) === 1;
}

const createParent: Migration = {
  name: "0001_parent",
  sql: "CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;",
};

describe("committed migrations", () => {
  it("loads 0000_baseline first", () => {
    expect(loadMigrations(packageMigrationsDir)[0]?.name).toBe("0000_baseline");
  });

  it("migrates a fresh database to version 11, then re-applies nothing", () => {
    const migrations = loadMigrations(packageMigrationsDir);
    const names = [
      "0000_baseline",
      "0001_person_settings_audit",
      "0002_jobs_review_items",
      "0003_auth_setup_links",
      "0004_recovery",
      "0005_backup_snapshot",
      "0006_backup_verification",
      "0007_recovery_bundle",
      "0008_ledger_accounts",
      "0009_ledger_classification_schema",
      "0010_split_provenance",
    ];
    expect(migrate(db, migrations)).toEqual({ applied: names, schemaVersion: 11 });
    expect(migrate(db, migrations)).toEqual({ applied: [], schemaVersion: 11 });
    expect(schemaVersion(db)).toBe(11);
    expect(rows()).toEqual(names.map((name, i) => ({ version: i + 1, name })));
    expect(foreignKeysOn()).toBe(true);
  });

  it("keeps tagged splits and their split_tag rows when 0009 upgrades to 0010", () => {
    const migrations = loadMigrations(packageMigrationsDir);
    migrate(db, migrations.slice(0, 10));
    db.exec(`
      INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at) VALUES ('A1','Joint','transaction','AUD',0,'t','t');
      INSERT INTO "transaction" (id, account_id, posted_on, amount_cents, description_raw, status, fingerprint, fingerprint_version, created_at, updated_at) VALUES ('T1','A1','2026-09-01',-100,'x','posted','fp',1,'t','t');
      INSERT INTO split (id, transaction_id, amount_cents, beneficiary, created_at, updated_at) VALUES ('S1','T1',-100,'shared','t','t');
      INSERT INTO tag (id, name, created_at, updated_at) VALUES ('G1','holiday','t','t');
      INSERT INTO split_tag (split_id, tag_id, created_at, updated_at) VALUES ('S1','G1','t','t');
    `);
    expect(migrate(db, migrations).applied).toEqual(["0010_split_provenance"]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT split_id, tag_id FROM split_tag").all()).toEqual([
      { split_id: "S1", tag_id: "G1" },
    ]);
    expect(db.prepare("SELECT id, category_source FROM split").all()).toEqual([
      { id: "S1", category_source: null },
    ]);
    // The foreign key from split_tag still points at the rebuilt table.
    expect(() =>
      db.exec(
        "INSERT INTO split_tag (split_id, tag_id, created_at, updated_at) VALUES ('nope','G1','t','t')",
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it("opens in WAL mode with foreign keys on", () => {
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(foreignKeysOn()).toBe(true);
  });
});

describe("migrate", () => {
  const baseline: Migration = { name: "0000_baseline", sql: "-- empty" };

  it("records the time each migration was applied", () => {
    migrate(db, [baseline], { now: () => new Date("2026-09-27T00:00:00.000Z") });
    expect(db.prepare("SELECT applied_at FROM schema_migration").pluck().get()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
  });

  it("rolls back a migration whose SQL fails and names it", () => {
    migrate(db, [baseline]);
    const bad: Migration = {
      name: "0001_bad",
      sql: "CREATE TABLE ok_so_far (id INTEGER PRIMARY KEY) STRICT; SELECT * FROM missing_table;",
    };
    const run = () => migrate(db, [baseline, bad]);
    expect(run).toThrow(MigrationError);
    expect(run).toThrow(/0001_bad/);
    expect(rows()).toEqual([{ version: 1, name: "0000_baseline" }]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'ok_so_far'").get()).toBe(
      undefined,
    );
    expect(foreignKeysOn()).toBe(true);
  });

  it("rolls back a migration that leaves a foreign-key violation", () => {
    const child: Migration = {
      name: "0002_orphan",
      sql: `CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id)) STRICT;
            INSERT INTO child (id, parent_id) VALUES (1, 42);`,
    };
    migrate(db, [baseline, createParent]);
    expect(() => migrate(db, [baseline, createParent, child])).toThrow(
      /0002_orphan failed: foreign_key_check/,
    );
    expect(schemaVersion(db)).toBe(2);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'child'").get()).toBe(undefined);
    expect(foreignKeysOn()).toBe(true);
  });

  it("rolls back a migration that creates a non-STRICT table", () => {
    const loose: Migration = { name: "0001_loose", sql: "CREATE TABLE loose (id INTEGER);" };
    expect(() => migrate(db, [baseline, loose])).toThrow(/0001_loose failed: .*STRICT: loose/);
    // The baseline committed in its own transaction; only 0001_loose was rolled back.
    expect(rows()).toEqual([{ version: 1, name: "0000_baseline" }]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'loose'").get()).toBe(undefined);
    expect(foreignKeysOn()).toBe(true);
  });

  it("runs migrations with foreign keys off so table rebuilds work", () => {
    const seen: unknown[] = [];
    migrate(db, [baseline], {
      invariants: [(d) => seen.push(d.pragma("foreign_keys", { simple: true }))],
    });
    expect(seen).toEqual([0]);
    expect(foreignKeysOn()).toBe(true);
  });

  it("refuses a database newer than the build", () => {
    migrate(db, [baseline, createParent]);
    expect(() => migrate(db, [baseline])).toThrow(/newer than this build/);
  });

  it("refuses a database whose history differs from the build", () => {
    migrate(db, [baseline, createParent]);
    const other: Migration = { name: "0001_other", sql: "-- other" };
    expect(() => migrate(db, [baseline, other])).toThrow(/0001_parent at version 2/);
  });
});

describe("loadMigrations", () => {
  function writeJournal(migrationsDir: string, tags: string[]): void {
    mkdirSync(join(migrationsDir, "meta"), { recursive: true });
    const entries = tags.map((tag, idx) => ({ idx, tag }));
    writeFileSync(join(migrationsDir, "meta", "_journal.json"), JSON.stringify({ entries }));
  }

  it("orders by journal index", () => {
    const migrationsDir = join(dir, "m");
    writeJournal(migrationsDir, ["0000_a", "0001_b"]);
    writeFileSync(join(migrationsDir, "0000_a.sql"), "-- a");
    writeFileSync(join(migrationsDir, "0001_b.sql"), "-- b");
    expect(loadMigrations(migrationsDir).map((m) => m.name)).toEqual(["0000_a", "0001_b"]);
  });

  it("rejects a .sql file that is not in the journal", () => {
    const migrationsDir = join(dir, "m");
    writeJournal(migrationsDir, ["0000_a"]);
    writeFileSync(join(migrationsDir, "0000_a.sql"), "-- a");
    writeFileSync(join(migrationsDir, "0001_stray.sql"), "-- stray");
    expect(() => loadMigrations(migrationsDir)).toThrow(/0001_stray\.sql/);
  });
});
