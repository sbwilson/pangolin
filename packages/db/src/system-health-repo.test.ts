import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { openDatabase } from "./open.ts";
import { createSystemHealthRepo } from "./system-health-repo.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-health-"));
  path = join(dir, "test.sqlite");
  const db = openDatabase(path);
  migrate(db, loadMigrations(packageMigrationsDir));
  db.close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("system health repository", () => {
  it("reports the schema version and a writable database", () => {
    const db = openDatabase(path);
    const repo = createSystemHealthRepo(db);
    expect(repo.schemaVersion()).toBe(11);
    // A value unlike the real schema version, so a probe that changed it would show.
    db.pragma("user_version = 99");
    expect(repo.probeWrite()).toBe(true);
    expect(db.inTransaction).toBe(false);
    expect(db.pragma("user_version", { simple: true })).toBe(99);
    db.close();
  });

  it("reports a read-only database as not writable", () => {
    const db = openDatabase(path, { readonly: true });
    const repo = createSystemHealthRepo(db);
    expect(repo.schemaVersion()).toBe(11);
    expect(repo.probeWrite()).toBe(false);
    db.close();
  });

  it("reports 0 before any migration", () => {
    const db = openDatabase(join(dir, "empty.sqlite"));
    expect(createSystemHealthRepo(db).schemaVersion()).toBe(0);
    db.close();
  });
});
