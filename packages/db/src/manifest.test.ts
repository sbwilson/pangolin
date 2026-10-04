import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CASH_ACCOUNT_TYPES } from "@pangolin/app";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildManifest,
  compareManifests,
  MANIFEST_CASH_TYPES,
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

function addAccount(id: string, type: string, deleted = false): void {
  db.prepare(
    "INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'AUD', 0, 't', 't', ?)",
  ).run(id, `Name ${id}`, type, deleted ? "t" : null);
}

function addTx(id: string, account: string, posted: string, cents: number, deleted = false): void {
  db.prepare(
    `INSERT INTO "transaction" (id, account_id, posted_on, amount_cents, description_raw, status, fingerprint, fingerprint_version, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'd', 'posted', ?, 1, 't', 't', ?)`,
  ).run(id, account, posted, cents, id, deleted ? "t" : null);
}

function addBalance(id: string, account: string, asOf: string, cents: number): void {
  db.prepare(
    "INSERT INTO balance_snapshot (id, account_id, as_of, balance_cents, source, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual', 't', 't')",
  ).run(id, account, asOf, cents);
}

/** A small ledger: cash with a snapshot and a deleted row, a brokerage, a deleted account. */
function addLedger(): void {
  addAccount("A1", "transaction");
  addAccount("A2", "brokerage");
  addAccount("A3", "savings", true);
  addBalance("S1", "A1", "2026-01-31", 10_000);
  addTx("T1", "A1", "2026-01-15", 500); // before the snapshot: not in the balance
  addTx("T2", "A1", "2026-02-10", -250);
  addTx("T3", "A1", "2026-02-11", 9999, true); // soft-deleted
  addTx("T4", "A1", "2099-01-01", 70); // after the balance date
  addTx("T5", "A2", "2026-02-10", 300);
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
    expect(manifest.format).toBe(2);
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

describe("account figures", () => {
  it("lists every account by id with count, live sum and cash balance on the balance date", () => {
    addLedger();
    const manifest = buildManifest(db, { balanceDate: "2026-03-01" });
    expect(manifest.balanceDate).toBe("2026-03-01");
    expect(manifest.accounts).toEqual([
      // Count includes the deleted row; the sum and the balance do not.
      { id: "A1", transactionCount: 4, amountSumCents: 500 - 250 + 70, balanceCents: 9_750 },
      { id: "A2", transactionCount: 1, amountSumCents: 300, balanceCents: null },
      { id: "A3", transactionCount: 0, amountSumCents: 0, balanceCents: 0 },
    ]);
    expect(JSON.stringify(manifest)).not.toContain("Name A1");
  });

  it("defaults the balance date to today's UTC date and refuses a malformed one", () => {
    expect(buildManifest(db).balanceDate).toBe(new Date().toISOString().slice(0, 10));
    expect(() => buildManifest(db, { balanceDate: "yesterday" })).toThrow("balanceDate");
  });

  it("keeps the cash type list equal to the app's", () => {
    expect([...MANIFEST_CASH_TYPES].sort()).toEqual([...CASH_ACCOUNT_TYPES].sort());
  });

  it("verifies an unchanged format-2 snapshot", () => {
    addLedger();
    const { file, manifest } = snapshot();
    expect(manifest.format).toBe(2);
    expect(verifySnapshot(file, manifest, migrations)).toMatchObject({ ok: true });
  });

  it("fails the manifest naming the account when an amount differs", () => {
    addLedger();
    const { file, manifest } = snapshot();
    tamper(file, "UPDATE \"transaction\" SET amount_cents = 301 WHERE id = 'T5'");
    const verdict = verifySnapshot(file, manifest, migrations);
    expect(verdict).toMatchObject({ ok: false, check: "manifest" });
    expect((verdict as { message: string }).message).toBe(
      "table transaction's checksum differs from the manifest; account A2's transactions sum to 301 cents; the manifest says 300",
    );
    // With the table figures matching, the account figure names itself.
    const actual = buildManifest(new Database(file, { readonly: true }), {
      balanceDate: manifest.balanceDate ?? "",
    });
    expect(compareManifests({ ...manifest, tables: actual.tables }, actual)).toEqual([
      "account A2's transactions sum to 301 cents; the manifest says 300",
    ]);
  });

  it("names an account message when the table checksums pass (balance_snapshot is the tamper)", () => {
    addLedger();
    const { file, manifest } = snapshot();
    tamper(file, "UPDATE balance_snapshot SET balance_cents = 1 WHERE id = 'S1'");
    const actual = buildManifest(new Database(file, { readonly: true }), {
      balanceDate: manifest.balanceDate ?? "",
    });
    expect(compareManifests({ ...manifest, tables: actual.tables }, actual)).toEqual([
      "account A1's balance is -249 cents; the manifest says 9750",
    ]);
    // Through verifySnapshot the same account line follows the table line.
    const verdict = verifySnapshot(file, manifest, migrations);
    expect((verdict as { message: string }).message).toContain(
      "account A1's balance is -249 cents; the manifest says 9750",
    );
  });

  it("compares count-only and balance-only differences, and missing and extra accounts", () => {
    addLedger();
    const manifest = buildManifest(db, { balanceDate: "2026-03-01" });
    const accounts = manifest.accounts ?? [];
    const withAccounts = (list: typeof accounts) => ({ ...manifest, accounts: list });
    const [a1] = accounts;
    if (a1 === undefined) throw new Error("no account");
    expect(
      compareManifests(
        manifest,
        withAccounts([{ ...a1, transactionCount: 5 }, ...accounts.slice(1)]),
      ),
    ).toEqual(["account A1 has 5 transactions; the manifest says 4"]);
    expect(
      compareManifests(
        manifest,
        withAccounts([{ ...a1, balanceCents: null }, ...accounts.slice(1)]),
      ),
    ).toEqual(["account A1's balance is none cents; the manifest says 9750"]);
    expect(
      compareManifests(
        withAccounts([{ ...a1, balanceCents: null }, ...accounts.slice(1)]),
        manifest,
      ),
    ).toEqual(["account A1's balance is 9750 cents; the manifest says none"]);
    expect(compareManifests(manifest, withAccounts(accounts.slice(1)))).toEqual([
      "account A1 is missing",
    ]);
    expect(compareManifests(withAccounts(accounts.slice(1)), manifest)).toEqual([
      "account A1 is not in the manifest",
    ]);
  });

  it("verifies on the manifest's own balance date, not today's", () => {
    addLedger();
    // On 2026-02-10 A1 is 10000 - 250 = 9750 and on 2099-02-01 it is 9820: the date matters.
    const outDir = join(dir, "past");
    const { manifest } = writeSnapshot(dbFile, outDir, undefined, "2026-02-10");
    expect(manifest.accounts?.[0]?.balanceCents).toBe(9_750);
    expect(buildManifest(db, { balanceDate: "2099-02-01" }).accounts?.[0]?.balanceCents).toBe(
      9_820,
    );
    expect(verifySnapshot(join(outDir, SNAPSHOT_FILE), manifest, migrations)).toMatchObject({
      ok: true,
    });
  });

  it("verifies a format-1 manifest with no account checks, even without an account table", () => {
    addLedger();
    const { file, manifest } = snapshot();
    const { accounts: _a, balanceDate: _d, ...rest } = manifest;
    const v1 = { ...rest, format: 1 };
    expect(verifySnapshot(file, v1, migrations)).toMatchObject({ ok: true });
    // Account figures changing does not matter to format 1 (only a table it lists would).
    const older = join(dir, "older.sqlite");
    const raw = new Database(older);
    raw.exec("CREATE TABLE schema_migration (version INTEGER PRIMARY KEY, name TEXT) STRICT");
    raw.close();
    const bare = buildManifest(new Database(older, { readonly: true }), { accounts: false });
    expect(bare.format).toBe(1);
    expect(verifySnapshot(older, bare, migrations).ok).toBe(true);
    expect(parseManifest(JSON.stringify(bare))).toEqual(bare);
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
    // With the time it was taken, which a restore records.
    const timed = writeSnapshot(dbFile, outDir, "2026-09-27T02:30:00.000Z");
    const timedText = readFileSync(join(outDir, MANIFEST_FILE), "utf8");
    expect(parseManifest(timedText)).toEqual({ ...manifest, takenAt: "2026-09-27T02:30:00.000Z" });
    expect(timed.manifestSha256).toBe(manifestSha256(timedText));
    expect(verifySnapshot(join(outDir, SNAPSHOT_FILE), timed.manifest, migrations).ok).toBe(true);
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
    expect(() => parseManifest("[]")).toThrow("not format 1 or 2");
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

  it("reads format 1 and validates format 2's balance date and accounts", () => {
    const raw = JSON.parse(serializeManifest(buildManifest(db))) as Record<string, unknown>;
    const { accounts: _a, balanceDate: _b, ...rest } = raw;
    expect(parseManifest(JSON.stringify({ ...rest, format: 1 })).accounts).toBeUndefined();
    expect(() => parseManifest(JSON.stringify({ ...rest, format: 3 }))).toThrow(
      "not format 1 or 2",
    );
    const v2 = { ...rest, format: 2, balanceDate: "2026-03-01" };
    const entry = { id: "A", transactionCount: 1, amountSumCents: -5, balanceCents: null };
    expect(parseManifest(JSON.stringify({ ...v2, accounts: [entry] })).accounts).toEqual([entry]);
    expect(() =>
      parseManifest(JSON.stringify({ ...v2, accounts: [], balanceDate: undefined })),
    ).toThrow("balance date");
    expect(() =>
      parseManifest(JSON.stringify({ ...v2, accounts: [], balanceDate: "1 Mar" })),
    ).toThrow("balance date");
    expect(() => parseManifest(JSON.stringify({ ...v2 }))).toThrow("accounts list");
    for (const bad of [
      { ...entry, amountSumCents: 1.5 },
      { ...entry, transactionCount: -1 },
      { ...entry, balanceCents: "1" },
      { ...entry, id: 1 },
    ]) {
      expect(() => parseManifest(JSON.stringify({ ...v2, accounts: [bad] }))).toThrow(
        "accounts list",
      );
    }
    expect(() => parseManifest(JSON.stringify({ ...v2, accounts: [entry, entry] }))).toThrow(
      "accounts list",
    );
  });
});
