import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManifest,
  type Db,
  loadMigrations,
  MANIFEST_FILE,
  manifestSha256,
  migrate,
  openDatabase,
  packageMigrationsDir,
  parseManifest,
  SNAPSHOT_FILE,
  verifySnapshot,
} from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeSnapshot } from "./snapshot.ts";

let dir: string;
let db: Db;
let dbFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-snapshot-"));
  dbFile = join(dir, "pangolin.sqlite");
  db = openDatabase(dbFile);
  migrate(db, loadMigrations(packageMigrationsDir));
  const insert = db.prepare(
    "INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at) VALUES (?, NULL, ?, '#112233', 't', 't')",
  );
  for (let i = 0; i < 50; i++) insert.run(`P${String(i).padStart(3, "0")}`, `Person ${i}`);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("takeSnapshot", () => {
  it("writes a VACUUM INTO copy and its manifest in a worker while the live database stays open", async () => {
    const outDir = join(dir, "backup", "staging", "01TEST");
    const summary = await takeSnapshot({ dbFile, outDir });
    const text = readFileSync(join(outDir, MANIFEST_FILE), "utf8");
    const manifest = parseManifest(text);
    expect(manifest).toEqual(buildManifest(db));
    const migrations = loadMigrations(packageMigrationsDir);
    expect(summary).toEqual({
      schemaVersion: migrations.length,
      tableCount: manifest.tables.length,
      rowCount: manifest.tables.reduce((sum, t) => sum + t.rows, 0),
      manifestSha256: manifestSha256(text),
    });
    expect(manifest.tables.find((t) => t.name === "person")?.rows).toBe(50);
    expect(verifySnapshot(join(outDir, SNAPSHOT_FILE), manifest, migrations)).toMatchObject({
      ok: true,
    });
    // A rollback-journal file: no WAL beside it.
    expect(existsSync(join(outDir, `${SNAPSHOT_FILE}-wal`))).toBe(false);
    // The live database still takes writes.
    db.prepare("UPDATE person SET display_name = 'Changed' WHERE id = 'P000'").run();
  });

  it("replaces an existing output directory, and rejects when the database is missing", async () => {
    const outDir = join(dir, "out");
    await takeSnapshot({ dbFile, outDir });
    await takeSnapshot({ dbFile, outDir });
    expect(existsSync(join(outDir, SNAPSHOT_FILE))).toBe(true);
    await expect(takeSnapshot({ dbFile: join(dir, "missing.sqlite"), outDir })).rejects.toThrow();
  });

  it("rejects with the signal's reason when aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(
      takeSnapshot({ dbFile, outDir: join(dir, "x"), signal: controller.signal }),
    ).rejects.toBe(reason);
    const running = new AbortController();
    const pending = takeSnapshot({ dbFile, outDir: join(dir, "y"), signal: running.signal });
    running.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
