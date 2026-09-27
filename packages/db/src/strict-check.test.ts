import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { assertAllTablesStrict, findNonStrictTables } from "./strict-check.ts";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-strict-"));
  db = openDatabase(join(dir, "test.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("STRICT check", () => {
  it("passes on a freshly migrated database", () => {
    migrate(db, loadMigrations(packageMigrationsDir));
    expect(findNonStrictTables(db)).toEqual([]);
  });

  it("lists tables created without STRICT, ignoring sqlite internals and FTS5 shadows", () => {
    db.exec(`
      CREATE TABLE good (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE bad_b (id INTEGER PRIMARY KEY);
      CREATE TABLE bad_a (id INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE VIRTUAL TABLE search USING fts5(body);
    `);
    expect(findNonStrictTables(db)).toEqual(["bad_a", "bad_b"]);
    expect(() => assertAllTablesStrict(db)).toThrow("bad_a, bad_b");
  });
});

describe("check-strict CLI", () => {
  const cli = fileURLToPath(new URL("./cli/check-strict.ts", import.meta.url));

  function runCli(args: string[]): { status: number; output: string } {
    try {
      const output = execFileSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        stdio: "pipe",
      });
      return { status: 0, output };
    } catch (error) {
      const e = error as { status: number; stdout: string; stderr: string };
      return { status: e.status, output: e.stdout + e.stderr };
    }
  }

  it("exits 0 on a freshly migrated database", () => {
    expect(runCli([]).status).toBe(0);
  });

  it("exits non-zero and names a non-STRICT table", () => {
    db.exec("CREATE TABLE loose (id INTEGER)");
    const result = runCli([join(dir, "test.sqlite")]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("loose");
  });
});
