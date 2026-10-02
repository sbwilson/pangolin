import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir, schemaVersion } from "../migrate.ts";
import { openDatabase } from "../open.ts";

const CLI = fileURLToPath(new URL("./check-upgrade.ts", import.meta.url));
const migrations = loadMigrations(packageMigrationsDir);

let dir: string;
let dbFile: string;

function checkUpgrade(...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-check-upgrade-"));
  dbFile = join(dir, "pangolin.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("check-upgrade", () => {
  it("migrates a database from an earlier schema and passes the snapshot checks", () => {
    expect(migrations.length).toBeGreaterThan(2);
    const db = openDatabase(dbFile);
    migrate(db, migrations.slice(0, 2));
    db.prepare(
      "INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at) VALUES ('P1', NULL, 'Ann', '#112233', 't', 't')",
    ).run();
    db.close();

    const result = checkUpgrade(dbFile);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `migrated 2 -> ${migrations.length}; integrity, manifest, schema ok`,
    );
    const after = openDatabase(dbFile, { readonly: true });
    expect(schemaVersion(after)).toBe(migrations.length);
    expect(after.prepare("SELECT display_name FROM person").pluck().all()).toEqual(["Ann"]);
    after.close();
  });

  it("passes a database already at this build's schema", () => {
    const db = openDatabase(dbFile);
    migrate(db, migrations);
    db.close();

    const result = checkUpgrade(dbFile);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`migrated ${migrations.length} -> ${migrations.length}`);
  });

  it("fails a file that is not a SQLite database", () => {
    writeFileSync(dbFile, "this is not a database, just some text padded out ".repeat(200));

    const result = checkUpgrade(dbFile);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the open check failed");
  });

  it("fails a database newer than this build", () => {
    const db = openDatabase(dbFile);
    migrate(db, migrations);
    db.prepare("INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)").run(
      migrations.length + 1,
      "9999_from_the_future",
      new Date().toISOString(),
    );
    db.close();

    const result = checkUpgrade(dbFile);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the migrate check failed");
    expect(result.stderr).toContain("newer than this build");
  });

  it("fails a path with no database rather than creating one", () => {
    const result = checkUpgrade(join(dir, "missing.sqlite"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the open check failed");
  });

  it("refuses anything but exactly one argument", () => {
    const db = openDatabase(dbFile);
    migrate(db, migrations);
    db.close();

    for (const args of [[], [dbFile, "extra"]]) {
      const result = checkUpgrade(...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Usage: check-upgrade <db-path>");
    }
  });
});
