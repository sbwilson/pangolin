// The schema of story 2.2 on real SQLite: STRICT tables, real foreign keys, and the 0008 to
// 0009 upgrade. The repositories' answers, and their parity with the memory unit of work, are
// in packages/app/src/testing/repo-parity.test.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-classify-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ledger and classification schema on SQLite", () => {
  it("makes every new table STRICT", () => {
    const names = [
      "institution",
      "balance_snapshot",
      "transfer_group",
      "category_group",
      "category",
      "tag",
      "split_tag",
      "activity",
      "payee",
      "payee_alias",
      "tax_category",
    ];
    const strict = db
      .prepare(
        "SELECT name FROM pragma_table_list WHERE strict = 1 AND name IN (SELECT value FROM json_each(?)) ORDER BY name",
      )
      .pluck()
      .all(JSON.stringify(names));
    expect(strict).toEqual([...names].sort());
  });

  it("has real foreign keys where the plan says, and none on logo and property", () => {
    const fks = (table: string) =>
      db
        .prepare(`SELECT "from" FROM pragma_foreign_key_list('${table}') ORDER BY "from"`)
        .pluck()
        .all();
    expect(fks("transaction")).toEqual(
      ["account_id", "name_hidden_by", "payee_id", "performed_by", "transfer_group_id"].sort(),
    );
    expect(fks("split")).toEqual(
      ["activity_id", "category_id", "tax_category_id", "transaction_id"].sort(),
    );
    expect(fks("review_item")).toEqual(["account_id", "person_id"]);
    expect(fks("payee")).toEqual(["default_category_id", "origin_account_id", "scope_person_id"]);
  });

  it("keeps rows when 0008 upgrades to 0009", () => {
    const old = openDatabase(join(dir, "old.sqlite"));
    const migrations = loadMigrations(packageMigrationsDir);
    migrate(old, migrations.slice(0, 9));
    old.exec(`
      INSERT INTO person (id, display_name, colour, created_at, updated_at) VALUES ('P1','A','#000000','t','t');
      INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at) VALUES ('A1','Joint','transaction','AUD',0,'t','t');
      INSERT INTO "transaction" (id, account_id, posted_on, amount_cents, description_raw, status, created_at, updated_at) VALUES ('T1','A1','2026-09-01',-100,'same','posted','t','t'), ('T2','A1','2026-09-01',-100,'same','posted','t','t');
      INSERT INTO split (id, transaction_id, amount_cents, beneficiary, created_at, updated_at) VALUES ('S1','T1',-100,'shared','t','t');
      INSERT INTO review_item (id, kind, account_id, entity_ref, dedupe_key, created_at) VALUES ('R1','k','A1','e','d','t');
    `);
    expect(migrate(old, migrations.slice(0, 10)).applied).toEqual([
      "0009_ledger_classification_schema",
    ]);
    expect(old.pragma("foreign_key_check")).toEqual([]);
    expect(
      old
        .prepare(
          'SELECT id, fingerprint, fingerprint_version, needs_review, is_hidden FROM "transaction" ORDER BY id',
        )
        .all(),
    ).toEqual([
      { id: "T1", fingerprint: "T1", fingerprint_version: 0, needs_review: 0, is_hidden: 0 },
      { id: "T2", fingerprint: "T2", fingerprint_version: 0, needs_review: 0, is_hidden: 0 },
    ]);
    expect(old.prepare("SELECT id, account_id FROM review_item").all()).toEqual([
      { id: "R1", account_id: "A1" },
    ]);
    expect(old.prepare("SELECT count(*) FROM split").pluck().get()).toBe(1);
    expect(migrate(old, migrations.slice(0, 11)).applied).toEqual(["0010_split_provenance"]);
    expect(old.pragma("foreign_key_check")).toEqual([]);
    expect(
      old
        .prepare(
          "SELECT id, amount_cents, beneficiary, category_source, activity_source, tax_category_source, beneficiary_source, deductible_bp_source FROM split",
        )
        .all(),
    ).toEqual([
      {
        id: "S1",
        amount_cents: -100,
        beneficiary: "shared",
        category_source: null,
        activity_source: null,
        tax_category_source: null,
        beneficiary_source: null,
        deductible_bp_source: null,
      },
    ]);
    expect(old.prepare("SELECT is_savings FROM account").pluck().get()).toBe(0);
    expect(
      old
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'review_item_dedupe_key_open_idx'",
        )
        .pluck()
        .get(),
    ).toBe("review_item_dedupe_key_open_idx");
    expect(() =>
      old.exec(
        "INSERT INTO review_item (id, kind, account_id, person_id, entity_ref, dedupe_key, created_at) VALUES ('R2','k','A1','P1','e','d2','t')",
      ),
    ).toThrow(/review_item_scope/);
    old.close();
  });
});
