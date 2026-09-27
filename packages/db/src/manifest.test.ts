import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildManifest,
  compareManifests,
  MANIFEST_FILE,
  type Manifest,
  manifestSha256,
  parseManifest,
  SNAPSHOT_FILE,
  serializeManifest,
  verifySnapshot,
  writeSnapshot,
} from "./manifest.ts";
import { loadMigrations, type Migration, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";

let dir: string;
let db: Db;
let dbFile: string;
let migrations: Migration[];

function addPeople(n: number, from = 0): void {
  const insert = db.prepare(
    "INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at) VALUES (?, NULL, ?, '#112233', 't', 't')",
  );
  for (let i = from; i < from + n; i++) insert.run(`P${String(i).padStart(4, "0")}`, `Person ${i}`);
}

/** Writes a snapshot of the live database; returns its directory, file and manifest. */
function snapshot(name = "snap") {
  const outDir = join(dir, name);
  const written = writeSnapshot(dbFile, outDir);
  return { outDir, file: join(outDir, SNAPSHOT_FILE), manifest: written.manifest };
}

/** Runs `sql` on the snapshot file behind the manifest's back. */
function tamper(file: string, sql: string): void {
  const raw = new Database(file);
  raw.exec(sql);
  raw.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-manifest-"));
  dbFile = join(dir, "pangolin.sqlite");
  db = openDatabase(dbFile);
  migrations = loadMigrations(packageMigrationsDir);
  migrate(db, migrations);
  addPeople(20);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("buildManifest", () => {
  it("lists every table with its row count and a checksum, and the applied migrations", () => {
    const manifest = buildManifest(db);
    expect(manifest.format).toBe(1);
    expect(manifest.schemaVersion).toBe(migrations.length);
    expect(manifest.migrations).toEqual(migrations.map((m) => m.name));
    const names = manifest.tables.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(expect.arrayContaining(["person", "job", "backup_snapshot"]));
    expect(names.some((n) => n.startsWith("sqlite_"))).toBe(false);
    expect(manifest.tables.find((t) => t.name === "person")).toMatchObject({ rows: 20 });
    expect(manifest.tables.find((t) => t.name === "schema_migration")).toMatchObject({
      rows: migrations.length,
    });
    for (const table of manifest.tables) expect(table.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on insertion order, and changes with any value", () => {
    const before = buildManifest(db);
    // The same rows inserted in reverse order in another database.
    const other = openDatabase(join(dir, "other.sqlite"));
    migrate(other, migrations);
    const insert = other.prepare(
      "INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at) VALUES (?, NULL, ?, '#112233', 't', 't')",
    );
    for (let i = 19; i >= 0; i--) insert.run(`P${String(i).padStart(4, "0")}`, `Person ${i}`);
    const person = (m: Manifest) => m.tables.find((t) => t.name === "person");
    expect(person(buildManifest(other))).toEqual(person(before));
    other.prepare("UPDATE person SET colour = '#112234' WHERE id = 'P0007'").run();
    expect(person(buildManifest(other))?.sha256).not.toBe(person(before)?.sha256);
    other.close();
  });

  it("orders a table without a primary key by every column, so VACUUM cannot reorder it", () => {
    db.exec("CREATE TABLE loose (a TEXT, b INTEGER) STRICT");
    const insert = db.prepare("INSERT INTO loose (a, b) VALUES (?, ?)");
    for (const [a, b] of [
      ["b", 2],
      ["a", 1],
      ["b", 1],
      ["a", 2],
    ] as const)
      insert.run(a, b);
    db.exec("DELETE FROM loose WHERE a = 'a' AND b = 1");
    insert.run("a", 1);
    const { manifest } = snapshot();
    expect(manifest.tables.find((t) => t.name === "loose")).toEqual(
      buildManifest(db).tables.find((t) => t.name === "loose"),
    );
  });
});

describe("writeSnapshot and verifySnapshot", () => {
  it("writes a consistent copy whose manifest matches the live database", () => {
    const { outDir, file, manifest } = snapshot();
    expect(manifest).toEqual(buildManifest(db));
    const text = readFileSync(join(outDir, MANIFEST_FILE), "utf8");
    expect(text).toBe(serializeManifest(manifest));
    expect(parseManifest(text)).toEqual(manifest);
    expect(writeSnapshot(dbFile, outDir).manifestSha256).toBe(manifestSha256(text));
    expect(verifySnapshot(file, manifest, migrations)).toEqual({
      ok: true,
      tables: manifest.tables.length,
      rows: manifest.tables.reduce((sum, t) => sum + t.rows, 0),
    });
  });

  it("fails integrity on a corrupt file", () => {
    const { file, manifest } = snapshot();
    const bytes = readFileSync(file);
    // Scribble over every page after the first: the header still says SQLite.
    for (let i = 4096; i < bytes.length; i++) bytes[i] = 0x5a;
    writeFileSync(file, bytes);
    expect(verifySnapshot(file, manifest, migrations)).toMatchObject({
      ok: false,
      check: "integrity",
    });
    writeFileSync(file, "not a database at all");
    expect(verifySnapshot(file, manifest, migrations)).toMatchObject({
      ok: false,
      check: "integrity",
    });
    expect(verifySnapshot(join(dir, "missing"), manifest, migrations)).toMatchObject({
      ok: false,
      check: "integrity",
    });
  });

  it("fails the manifest on a row count or checksum mismatch, or a missing or extra table", () => {
    const counts = snapshot("counts");
    tamper(counts.file, "DELETE FROM person WHERE id = 'P0003'");
    expect(verifySnapshot(counts.file, counts.manifest, migrations)).toEqual({
      ok: false,
      check: "manifest",
      message: "table person has 19 rows; the manifest says 20",
    });

    const values = snapshot("values");
    tamper(values.file, "UPDATE person SET display_name = 'Mallory' WHERE id = 'P0003'");
    expect(verifySnapshot(values.file, values.manifest, migrations)).toEqual({
      ok: false,
      check: "manifest",
      message: "table person's checksum differs from the manifest",
    });

    const extra = snapshot("extra");
    tamper(extra.file, "CREATE TABLE stray (x TEXT) STRICT");
    expect(verifySnapshot(extra.file, extra.manifest, migrations)).toMatchObject({
      ok: false,
      check: "manifest",
      message: "table stray is not in the manifest",
    });
    const missing = {
      ...extra.manifest,
      tables: [
        ...extra.manifest.tables,
        { ...extra.manifest.tables[0], name: "gone" } as Manifest["tables"][number],
      ],
    };
    expect(compareManifests(missing, buildManifest(db))).toContain("table gone is missing");
  });

  it("fails the schema check when the snapshot is newer than this build or diverges from it", () => {
    const { file, manifest } = snapshot();
    const older = migrations.slice(0, -1);
    expect(verifySnapshot(file, manifest, older)).toEqual({
      ok: false,
      check: "schema",
      message: `the snapshot is at schema version ${migrations.length}, newer than this build (${older.length})`,
    });
    const renamed = migrations.map((m, i) => (i === 1 ? { ...m, name: "0001_other" } : m));
    expect(verifySnapshot(file, manifest, renamed)).toMatchObject({
      ok: false,
      check: "schema",
      message: expect.stringContaining("but this build expects 0001_other"),
    });
    // An older snapshot is fine: the server migrates it when it starts.
    expect(
      verifySnapshot(file, manifest, [...migrations, { name: "9999_next", sql: "" }]),
    ).toMatchObject({
      ok: true,
    });
  });
});

describe("parseManifest", () => {
  it("refuses anything but a well-formed manifest", () => {
    const good = serializeManifest(buildManifest(db));
    expect(() => parseManifest("{")).toThrow("not JSON");
    expect(() => parseManifest("[]")).toThrow("not format 1");
    const raw = JSON.parse(good) as Record<string, unknown>;
    expect(() => parseManifest(JSON.stringify({ ...raw, schemaVersion: -1 }))).toThrow(
      "no schema version",
    );
    expect(() => parseManifest(JSON.stringify({ ...raw, migrations: [1] }))).toThrow(
      "no migration list",
    );
    expect(() =>
      parseManifest(JSON.stringify({ ...raw, tables: [{ name: "x", rows: 1, sha256: "nope" }] })),
    ).toThrow("table list is malformed");
  });
});
