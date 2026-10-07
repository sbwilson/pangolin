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

  it("migrates a fresh database to version 13, then re-applies nothing", () => {
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
      "0011_backup_snapshot_drop_figures",
      "0012_search_index",
    ];
    expect(migrate(db, migrations)).toEqual({ applied: names, schemaVersion: 13 });
    expect(migrate(db, migrations)).toEqual({ applied: [], schemaVersion: 13 });
    expect(schemaVersion(db)).toBe(13);
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
    expect(migrate(db, migrations.slice(0, 11)).applied).toEqual(["0010_split_provenance"]);
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

  it("drops the backup figures from 0010's rows, audit rows and drill summaries when 0010 upgrades to 0011", () => {
    const migrations = loadMigrations(packageMigrationsDir);
    migrate(db, migrations.slice(0, 11));
    const figures = { tableCount: 15, rowCount: 100, manifestSha256: "d".repeat(64) };
    const restic = "a".repeat(8) + "b".repeat(56);
    const row = (id: string, pushed: boolean) => ({
      id,
      takenAt: "2026-09-27T00:00:00.000Z",
      schemaVersion: 11,
      ...figures,
      pushJobId: `push-${id}`,
      resticSnapshotId: pushed ? restic : null,
      pushedAt: pushed ? "2026-09-27T00:05:00.000Z" : null,
      createdAt: "t",
      updatedAt: "t",
    });
    const insertSnapshot = db.prepare(
      `INSERT INTO backup_snapshot (id, taken_at, schema_version, table_count, row_count,
         manifest_sha256, push_job_id, restic_snapshot_id, pushed_at, created_at, updated_at)
       VALUES (?, '2026-09-27T00:00:00.000Z', 11, 15, 100, ?, ?, ?, ?, 't', 't')`,
    );
    insertSnapshot.run("S1", figures.manifestSha256, "push-S1", restic, "2026-09-27T00:05:00.000Z");
    insertSnapshot.run("S2", figures.manifestSha256, "push-S2", null, null);
    const audit = db.prepare(
      `INSERT INTO audit_log (id, at, actor, entity, entity_id, action, before, after)
       VALUES (?, 't', 'system', ?, ?, ?, ?, ?)`,
    );
    audit.run("L1", "backup_snapshot", "S1", "create", null, JSON.stringify(row("S1", false)));
    audit.run(
      "L2",
      "backup_snapshot",
      "S1",
      "push",
      JSON.stringify(row("S1", false)),
      JSON.stringify(row("S1", true)),
    );
    audit.run("L3", "person", "P1", "create", null, JSON.stringify({ tableCount: 1 }));
    const drill = db.prepare(
      "INSERT INTO backup_verification (id, kind, at, ok, summary) VALUES (?, ?, 't', ?, ?)",
    );
    const okSummary = `restored snapshot ${restic.slice(0, 8)} and verified 15 tables, 100 rows`;
    const failSummary = `the manifest check failed on snapshot ${restic.slice(0, 8)}`;
    drill.run("V1", "drill", 1, okSummary);
    drill.run("V2", "drill", 0, failSummary);
    drill.run("V3", "check", 1, "the repository check found no errors");
    // A failed drill and a check whose summaries happen to hold the phrase are not rewritten.
    const oddFail = "the restore check failed and verified nothing";
    const oddCheck = "the repository check ran and verified 3 packs";
    drill.run("V4", "drill", 0, oddFail);
    drill.run("V5", "check", 1, oddCheck);
    const auditVerification = (id: string, kind: string, ok: boolean, summary: string) =>
      audit.run(
        `L${id}`,
        "backup_verification",
        id,
        "record",
        null,
        JSON.stringify({ id, kind, at: "t", ok, summary }),
      );
    auditVerification("V1", "drill", true, okSummary);
    auditVerification("V4", "drill", false, oddFail);
    auditVerification("V5", "check", true, oddCheck);

    expect(migrate(db, migrations.slice(0, 12)).applied).toEqual([
      "0011_backup_snapshot_drop_figures",
    ]);
    expect(schemaVersion(db)).toBe(12);
    expect(db.pragma("foreign_key_check")).toEqual([]);

    // The rows are kept, the three columns and their check are gone, the pushed check stays.
    expect(db.prepare("SELECT * FROM backup_snapshot ORDER BY id").all()).toEqual([
      {
        id: "S1",
        taken_at: "2026-09-27T00:00:00.000Z",
        schema_version: 11,
        push_job_id: "push-S1",
        restic_snapshot_id: restic,
        pushed_at: "2026-09-27T00:05:00.000Z",
        created_at: "t",
        updated_at: "t",
      },
      {
        id: "S2",
        taken_at: "2026-09-27T00:00:00.000Z",
        schema_version: 11,
        push_job_id: "push-S2",
        restic_snapshot_id: null,
        pushed_at: null,
        created_at: "t",
        updated_at: "t",
      },
    ]);
    expect(
      db
        .prepare("SELECT strict FROM pragma_table_list WHERE name = 'backup_snapshot'")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE tbl_name = 'backup_snapshot' AND type = 'index'",
        )
        .pluck()
        .all(),
    ).toContain("backup_snapshot_pushed_idx");
    expect(() =>
      db.exec(
        "INSERT INTO backup_snapshot (id, taken_at, schema_version, push_job_id, restic_snapshot_id, created_at, updated_at) VALUES ('x','t',1,'j','r','t','t')",
      ),
    ).toThrow(/CHECK constraint failed: backup_snapshot_pushed/);

    // The audit rows of backup snapshots hold none of the three keys, and nothing else changed.
    const kept: Record<string, unknown> = { ...row("S1", true) };
    for (const key of Object.keys(figures)) delete kept[key];
    const audited = db
      .prepare(
        "SELECT id, before, after FROM audit_log WHERE entity = 'backup_snapshot' ORDER BY id",
      )
      .all() as { id: string; before: string | null; after: string }[];
    expect(audited.map((r) => r.id)).toEqual(["L1", "L2"]);
    expect(audited[0]?.before).toBeNull();
    expect(JSON.parse(audited[1]?.after ?? "null")).toEqual(kept);
    for (const r of audited) {
      const text = `${r.before} ${r.after}`;
      expect(text).not.toMatch(/tableCount|rowCount|manifestSha256/);
      // The only 64-hex string left is the restic snapshot id.
      for (const hex of text.match(/\b[0-9a-f]{64}\b/g) ?? []) expect(hex).toBe(restic);
    }
    expect(db.prepare("SELECT after FROM audit_log WHERE id = 'L3'").pluck().get()).toBe(
      '{"tableCount":1}',
    );

    // A successful drill's summary loses its figures, so it reads as a new one does; a failed
    // drill's and a check's stay as they were, even when they hold the phrase.
    expect(db.prepare("SELECT id, summary FROM backup_verification ORDER BY id").all()).toEqual([
      { id: "V1", summary: `restored snapshot ${restic.slice(0, 8)} and verified the restore` },
      { id: "V2", summary: failSummary },
      { id: "V3", summary: "the repository check found no errors" },
      { id: "V4", summary: oddFail },
      { id: "V5", summary: oddCheck },
    ]);
    const auditedSummary = (id: string) =>
      JSON.parse(
        db.prepare("SELECT after FROM audit_log WHERE id = ?").pluck().get(`L${id}`) as string,
      ).summary;
    expect(auditedSummary("V1")).toBe(
      `restored snapshot ${restic.slice(0, 8)} and verified the restore`,
    );
    expect(auditedSummary("V4")).toBe(oddFail);
    expect(auditedSummary("V5")).toBe(oddCheck);
  });

  describe("0012 search index", () => {
    const seed = `
      INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at) VALUES ('A1','Joint','transaction','AUD',0,'t','t');
      INSERT INTO payee (id, name, created_at, updated_at) VALUES ('P1','Bunnings','t','t');
      INSERT INTO "transaction" (id, account_id, posted_on, amount_cents, description_raw, payee_id, notes, status, fingerprint, fingerprint_version, created_at, updated_at)
        VALUES ('T1','A1','2026-09-01',-100,'Hardware run','P1','for the shed','posted','fp1',1,'t','t');
      INSERT INTO "transaction" (id, account_id, posted_on, amount_cents, description_raw, status, fingerprint, fingerprint_version, created_at, updated_at)
        VALUES ('T2','A1','2026-09-02',-200,'Groceries','posted','fp2',1,'t','t');
      INSERT INTO split (id, transaction_id, amount_cents, beneficiary, memo, created_at, updated_at) VALUES ('S1','T1',-100,'shared','screws','t','t');
      INSERT INTO split (id, transaction_id, amount_cents, beneficiary, created_at, updated_at) VALUES ('S2','T2',-200,'shared','t','t');
      INSERT INTO tag (id, name, created_at, updated_at) VALUES ('G1','renovation','t','t');
      INSERT INTO split_tag (split_id, tag_id, created_at, updated_at) VALUES ('S1','G1','t','t');
    `;
    const find = (term: string, column = "txn_fts"): string[] =>
      db
        .prepare(
          `SELECT t.id FROM txn_fts JOIN "transaction" t ON t.search_id = txn_fts.rowid
           WHERE ${column} MATCH ? ORDER BY t.id`,
        )
        .pluck()
        .all(`"${term}"*`) as string[];

    it("indexes the rows already there when 0011 upgrades to 0012", () => {
      const migrations = loadMigrations(packageMigrationsDir);
      migrate(db, migrations.slice(0, 12));
      db.exec(seed);
      expect(migrate(db, migrations).applied).toEqual(["0012_search_index"]);
      expect(
        db.prepare('SELECT count(*) FROM "transaction" WHERE search_id IS NULL').pluck().get(),
      ).toBe(0);
      expect(find("hardware")).toEqual(["T1"]);
      expect(find("bunn")).toEqual(["T1"]);
      expect(find("shed")).toEqual(["T1"]);
      expect(find("screws")).toEqual(["T1"]);
      expect(find("renovation")).toEqual(["T1"]);
      expect(find("groceries")).toEqual(["T2"]);
    });

    it("follows inserts, edits and deletes of a transaction, its payee, splits and tags", () => {
      migrate(db, loadMigrations(packageMigrationsDir));
      db.exec(seed);
      const ids = db.prepare('SELECT id, search_id FROM "transaction" ORDER BY id').all();
      expect(ids).toEqual([
        { id: "T1", search_id: 1 },
        { id: "T2", search_id: 2 },
      ]);
      expect(find("hardware")).toEqual(["T1"]);

      db.exec(
        "UPDATE \"transaction\" SET description_raw = 'Timber', notes = NULL WHERE id = 'T1'",
      );
      expect(find("hardware")).toEqual([]);
      expect(find("shed")).toEqual([]);
      expect(find("timber")).toEqual(["T1"]);

      db.exec("UPDATE payee SET name = 'Mitre 10' WHERE id = 'P1'");
      expect(find("bunnings")).toEqual([]);
      expect(find("mitre")).toEqual(["T1"]);

      db.exec("UPDATE tag SET name = 'garden' WHERE id = 'G1'");
      expect(find("renovation")).toEqual([]);
      expect(find("garden")).toEqual(["T1"]);

      db.exec("UPDATE split SET memo = 'bolts' WHERE id = 'S1'");
      expect(find("screws")).toEqual([]);
      expect(find("bolts")).toEqual(["T1"]);

      db.exec(
        "INSERT INTO split_tag (split_id, tag_id, created_at, updated_at) VALUES ('S2','G1','t','t')",
      );
      expect(find("garden")).toEqual(["T1", "T2"]);
      db.exec("DELETE FROM split_tag WHERE split_id = 'S1'");
      expect(find("garden")).toEqual(["T2"]);

      db.exec("DELETE FROM split WHERE id = 'S1'");
      expect(find("bolts")).toEqual([]);

      db.exec("UPDATE tag SET deleted_at = 't' WHERE id = 'G1'");
      expect(find("garden")).toEqual([]);

      db.exec("DELETE FROM split_tag WHERE split_id = 'S2'");
      db.exec("DELETE FROM split WHERE transaction_id = 'T2'");
      db.exec("DELETE FROM \"transaction\" WHERE id = 'T2'");
      expect(find("groceries")).toEqual([]);
      db.exec(
        "INSERT INTO \"transaction\" (id, account_id, posted_on, amount_cents, description_raw, status, fingerprint, fingerprint_version, created_at, updated_at) VALUES ('T3','A1','2026-09-03',-5,'Bakery','posted','fp3',1,'t','t')",
      );
      expect(
        db.prepare("SELECT search_id FROM \"transaction\" WHERE id = 'T3'").pluck().get(),
      ).toBe(2);
      expect(find("bakery")).toEqual(["T3"]);
    });

    it("follows a payee reassignment, a split_tag update and a split moved to another transaction", () => {
      migrate(db, loadMigrations(packageMigrationsDir));
      db.exec(seed);
      db.exec(`
        INSERT INTO payee (id, name, created_at, updated_at) VALUES ('P2','Kmart','t','t');
        INSERT INTO tag (id, name, created_at, updated_at) VALUES ('G2','birthday','t','t');
      `);
      db.exec("UPDATE \"transaction\" SET payee_id = 'P2' WHERE id = 'T1'");
      expect(find("bunnings")).toEqual([]);
      expect(find("kmart")).toEqual(["T1"]);

      db.exec("UPDATE split_tag SET tag_id = 'G2' WHERE split_id = 'S1'");
      expect(find("renovation")).toEqual([]);
      expect(find("birthday")).toEqual(["T1"]);

      db.exec("UPDATE split SET transaction_id = 'T2' WHERE id = 'S1'");
      expect(find("screws")).toEqual(["T2"]);
      expect(find("birthday")).toEqual(["T2"]);
    });

    it("indexes shared and scoped payee and tag names in separate columns", () => {
      migrate(db, loadMigrations(packageMigrationsDir));
      db.exec(seed);
      db.exec(`
        INSERT INTO person (id, display_name, colour, created_at, updated_at) VALUES ('U1','Una','#fff','t','t');
        UPDATE payee SET scope_person_id = 'U1' WHERE id = 'P1';
        UPDATE tag SET scope_person_id = 'U1' WHERE id = 'G1';
      `);
      expect(find("bunnings", "payee")).toEqual([]);
      expect(find("bunnings", "payee_scoped")).toEqual(["T1"]);
      expect(find("renovation", "tags")).toEqual([]);
      expect(find("renovation", "tags_scoped")).toEqual(["T1"]);
    });

    it("keeps the index and its triggers working after a table rebuild that carries search_id", () => {
      migrate(db, loadMigrations(packageMigrationsDir));
      db.exec(seed);
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec("BEGIN");
      // The documented rebuild: save and drop the txn_fts triggers (a RENAME fails while one names
      // a missing table), rebuild, then re-create them.
      const triggers = db
        .prepare(
          "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'txn\\_fts\\_%' ESCAPE '\\'",
        )
        .all() as { name: string; sql: string }[];
      expect(triggers.length).toBeGreaterThan(8);
      for (const t of triggers) db.exec(`DROP TRIGGER ${t.name}`);
      const indexes = db
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'transaction' AND sql IS NOT NULL",
        )
        .pluck()
        .all() as string[];
      const ddl = db
        .prepare("SELECT sql FROM sqlite_schema WHERE name = 'transaction'")
        .pluck()
        .get() as string;
      db.exec(
        ddl
          .replace(/^CREATE TABLE \W?transaction\W?/, "CREATE TABLE __new_transaction")
          .replaceAll('"transaction".', '"__new_transaction".'),
      );
      // Reverse order, so the table rowids no longer match search_id.
      db.exec('INSERT INTO __new_transaction SELECT * FROM "transaction" ORDER BY rowid DESC');
      db.exec('DROP TABLE "transaction"');
      db.exec('ALTER TABLE __new_transaction RENAME TO "transaction"');
      for (const sql of indexes) db.exec(sql);
      for (const t of triggers) db.exec(t.sql);
      db.exec("COMMIT");
      db.exec("PRAGMA foreign_keys = ON");

      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(
        db.prepare('SELECT rowid, id, search_id FROM "transaction" ORDER BY id').all(),
      ).toEqual([
        { rowid: 2, id: "T1", search_id: 1 },
        { rowid: 1, id: "T2", search_id: 2 },
      ]);
      expect(find("hardware")).toEqual(["T1"]);
      expect(find("groceries")).toEqual(["T2"]);
      db.exec("UPDATE \"transaction\" SET description_raw = 'Timber' WHERE id = 'T1'");
      expect(find("hardware")).toEqual([]);
      expect(find("timber")).toEqual(["T1"]);
      db.exec(
        "INSERT INTO \"transaction\" (id, account_id, posted_on, amount_cents, description_raw, status, fingerprint, fingerprint_version, created_at, updated_at) VALUES ('T3','A1','2026-09-03',-5,'Bakery','posted','fp3',1,'t','t')",
      );
      expect(find("bakery")).toEqual(["T3"]);
      db.exec("UPDATE payee SET name = 'Mitre 10' WHERE id = 'P1'");
      expect(find("mitre")).toEqual(["T1"]);
      db.exec("DELETE FROM split WHERE transaction_id = 'T3'");
      db.exec("DELETE FROM \"transaction\" WHERE id = 'T3'");
      expect(find("bakery")).toEqual([]);
    });
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
