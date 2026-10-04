// The backup manifest (story 1.10): per table, its row count and a SHA-256 of its rows in key
// order, written beside every database snapshot and checked before a restore swaps a snapshot in.
// Format 2 adds, per account, the transaction count, the sum of amounts and the balance (AD-19).
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { balanceAsOf } from "./balance.ts";
import type { Migration } from "./migrate.ts";
import type { Db } from "./open.ts";

export const MANIFEST_FORMAT = 2;
/** The formats `parseManifest` reads: 1 has no accounts; 2 carries them. */
const SUPPORTED_FORMATS: readonly number[] = [1, 2];
/**
 * The account types whose balance is a snapshot plus later transactions. A mirror of the app's
 * `CASH_ACCOUNT_TYPES` (this package cannot import it); a test keeps the two equal.
 */
export const MANIFEST_CASH_TYPES: readonly string[] = [
  "transaction",
  "savings",
  "offset",
  "credit_card",
  "home_loan",
];
/** The manifest's file name beside the snapshot. */
export const MANIFEST_FILE = "manifest.json";
/** The snapshot's file name. */
export const SNAPSHOT_FILE = "pangolin.sqlite";

export interface TableManifest {
  readonly name: string;
  readonly rows: number;
  /** SHA-256, hex, of the column names and then every row in key order. */
  readonly sha256: string;
}

export interface AccountManifest {
  readonly id: string;
  /** Every transaction of the account, soft-deleted rows included. */
  readonly transactionCount: number;
  /** The sum of `amount_cents` of the live transactions. */
  readonly amountSumCents: number;
  /** `balanceAsOf` on the manifest's `balanceDate` for a cash type; `null` for the others. */
  readonly balanceCents: number | null;
}

export interface Manifest {
  /** 1 (no accounts) or 2; `buildManifest` writes 2. */
  readonly format: number;
  /** The number of applied migrations. */
  readonly schemaVersion: number;
  /** The applied migrations' names, in order. */
  readonly migrations: readonly string[];
  /** Every table, by name. */
  readonly tables: readonly TableManifest[];
  /** When the snapshot was taken (`formatInstant` text), when the backup job recorded it. */
  readonly takenAt?: string;
  /** Format 2: the `YYYY-MM-DD` day the account balances are taken on. */
  readonly balanceDate?: string;
  /** Format 2: every account (soft-deleted included), by id. */
  readonly accounts?: readonly AccountManifest[];
}

export interface BuildManifestOptions {
  /** The day balances are taken on; today's UTC date when omitted. */
  readonly balanceDate?: string;
  /** False builds a format-1 shape (no account scan); true by default. */
  readonly accounts?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Ordinary and virtual tables in `main`, SQLite's own excluded, by name. */
function tableNames(db: Db): string[] {
  return db
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       ORDER BY name`,
    )
    .pluck()
    .all() as string[];
}

function appliedMigrations(db: Db): string[] {
  const tracked = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migration'")
    .get();
  if (tracked === undefined) return [];
  return db.prepare("SELECT name FROM schema_migration ORDER BY version").pluck().all() as string[];
}

/** One value, typed, so `1`, `1.0`, `'1'` and a blob of `0x31` all hash differently. */
function encode(value: unknown): string {
  if (value === null) return "n";
  if (typeof value === "bigint") return `i${value.toString()}`;
  if (typeof value === "number") return `r${Object.is(value, -0) ? "-0" : String(value)}`;
  if (typeof value === "string") return `s${JSON.stringify(value)}`;
  if (Buffer.isBuffer(value)) return `b${value.toString("hex")}`;
  throw new TypeError(`manifest: unexpected SQLite value of type ${typeof value}`);
}

function tableManifest(db: Db, name: string): TableManifest {
  const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all() as {
    name: string;
    pk: number;
  }[];
  // Key order: the primary key, else every column. Never the rowid, which VACUUM may renumber.
  // BINARY collation, so values equal under a column's own collation still have one order.
  const key = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  const order = (key.length > 0 ? key : columns)
    .map((c) => `${quote(c.name)} COLLATE BINARY`)
    .join(", ");
  const list = columns.map((c) => quote(c.name)).join(", ");
  const hash = createHash("sha256");
  hash.update(`${JSON.stringify(columns.map((c) => c.name))}\n`);
  let rows = 0;
  if (columns.length > 0) {
    const select = db
      .prepare(`SELECT ${list} FROM ${quote(name)} ORDER BY ${order}`)
      .raw(true)
      .safeIntegers(true);
    for (const row of select.iterate() as Iterable<unknown[]>) {
      hash.update(`${row.map(encode).join(",")}\n`);
      rows++;
    }
  }
  return { name, rows, sha256: hash.digest("hex") };
}

/** Every account's figures as the system sees them: no viewer filter. */
function accountManifests(db: Db, balanceDate: string): AccountManifest[] {
  const rows = db
    .prepare(
      `SELECT a.id AS id, a.type AS type,
         (SELECT COUNT(*) FROM "transaction" t WHERE t.account_id = a.id) AS count,
         (SELECT COALESCE(SUM(t.amount_cents), 0) FROM "transaction" t
            WHERE t.account_id = a.id AND t.deleted_at IS NULL) AS sum
       FROM account a ORDER BY a.id COLLATE BINARY`,
    )
    .all() as { id: string; type: string; count: number; sum: number }[];
  return rows.map((row) => ({
    id: row.id,
    transactionCount: row.count,
    amountSumCents: row.sum,
    balanceCents: MANIFEST_CASH_TYPES.includes(row.type)
      ? balanceAsOf(db, row.id, balanceDate)
      : null,
  }));
}

/** Builds the manifest of `db` inside one read transaction, so it is one consistent state. */
export function buildManifest(db: Db, options: BuildManifestOptions = {}): Manifest {
  const withAccounts = options.accounts ?? true;
  const balanceDate = options.balanceDate ?? new Date().toISOString().slice(0, 10);
  if (withAccounts && !DAY.test(balanceDate)) {
    throw new TypeError("buildManifest: balanceDate must be a YYYY-MM-DD string");
  }
  return db
    .transaction((): Manifest => {
      const migrations = appliedMigrations(db);
      const base = {
        schemaVersion: migrations.length,
        migrations,
        tables: tableNames(db).map((name) => tableManifest(db, name)),
      };
      if (!withAccounts) return { format: 1, ...base };
      return {
        format: MANIFEST_FORMAT,
        ...base,
        balanceDate,
        accounts: accountManifests(db, balanceDate),
      };
    })
    .deferred();
}

/** The manifest as written to disk: stable JSON with a trailing newline. */
export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** SHA-256, hex, of a manifest file's text. */
export function manifestSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/** Parses a manifest file's text. Throws `Error` naming what is wrong. */
export function parseManifest(text: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("the manifest is not JSON");
  }
  if (!isRecord(raw) || typeof raw.format !== "number" || !SUPPORTED_FORMATS.includes(raw.format)) {
    throw new Error(`the manifest is not format ${SUPPORTED_FORMATS.join(" or ")}`);
  }
  const format = raw.format;
  const { schemaVersion, migrations, tables, takenAt } = raw;
  if (takenAt !== undefined && typeof takenAt !== "string") {
    throw new Error("the manifest's snapshot time is malformed");
  }
  if (!count(schemaVersion)) throw new Error("the manifest has no schema version");
  if (!Array.isArray(migrations) || !migrations.every((m) => typeof m === "string")) {
    throw new Error("the manifest has no migration list");
  }
  if (
    !Array.isArray(tables) ||
    !tables.every(
      (t) =>
        isRecord(t) &&
        typeof t.name === "string" &&
        count(t.rows) &&
        typeof t.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(t.sha256),
    )
  ) {
    throw new Error("the manifest's table list is malformed");
  }
  let account: { balanceDate: string; accounts: AccountManifest[] } | undefined;
  if (format === 2) {
    const { balanceDate, accounts } = raw;
    if (typeof balanceDate !== "string" || !DAY.test(balanceDate)) {
      throw new Error("the manifest's balance date is malformed");
    }
    const ids = new Set<string>();
    if (
      !Array.isArray(accounts) ||
      !accounts.every(
        (a) =>
          isRecord(a) &&
          typeof a.id === "string" &&
          !ids.has(a.id) &&
          !!ids.add(a.id) &&
          count(a.transactionCount) &&
          Number.isSafeInteger(a.amountSumCents) &&
          (a.balanceCents === null || Number.isSafeInteger(a.balanceCents)),
      )
    ) {
      throw new Error("the manifest's accounts list is malformed");
    }
    account = {
      balanceDate,
      accounts: (accounts as Record<string, unknown>[]).map((a) => ({
        id: a.id as string,
        transactionCount: a.transactionCount as number,
        amountSumCents: a.amountSumCents as number,
        balanceCents: a.balanceCents as number | null,
      })),
    };
  }
  return {
    format,
    schemaVersion: schemaVersion as number,
    migrations: migrations as string[],
    tables: (tables as Record<string, unknown>[]).map((t) => ({
      name: t.name as string,
      rows: t.rows as number,
      sha256: t.sha256 as string,
    })),
    ...(takenAt === undefined ? {} : { takenAt }),
    ...(account ?? {}),
  };
}

/** The differences between an expected and an actual manifest, as sentences; empty when equal. */
export function compareManifests(expected: Manifest, actual: Manifest): string[] {
  const problems: string[] = [];
  const found = new Map(actual.tables.map((t) => [t.name, t]));
  const wanted = new Set(expected.tables.map((t) => t.name));
  for (const table of expected.tables) {
    const got = found.get(table.name);
    if (got === undefined) problems.push(`table ${table.name} is missing`);
    else if (got.rows !== table.rows) {
      problems.push(`table ${table.name} has ${got.rows} rows; the manifest says ${table.rows}`);
    } else if (got.sha256 !== table.sha256) {
      problems.push(`table ${table.name}'s checksum differs from the manifest`);
    }
  }
  for (const table of actual.tables) {
    if (!wanted.has(table.name)) problems.push(`table ${table.name} is not in the manifest`);
  }
  if (
    expected.schemaVersion !== actual.schemaVersion ||
    expected.migrations.join("\n") !== actual.migrations.join("\n")
  ) {
    problems.push(
      `the schema is at version ${actual.schemaVersion}; the manifest says ${expected.schemaVersion}`,
    );
  }
  if (expected.format === 2) problems.push(...compareAccounts(expected, actual));
  return problems;
}

function compareAccounts(expected: Manifest, actual: Manifest): string[] {
  const problems: string[] = [];
  const found = new Map((actual.accounts ?? []).map((a) => [a.id, a]));
  const wanted = new Set((expected.accounts ?? []).map((a) => a.id));
  for (const account of expected.accounts ?? []) {
    const got = found.get(account.id);
    if (got === undefined) {
      problems.push(`account ${account.id} is missing`);
      continue;
    }
    if (got.transactionCount !== account.transactionCount) {
      problems.push(
        `account ${account.id} has ${got.transactionCount} transactions; the manifest says ${account.transactionCount}`,
      );
    }
    if (got.amountSumCents !== account.amountSumCents) {
      problems.push(
        `account ${account.id}'s transactions sum to ${got.amountSumCents} cents; the manifest says ${account.amountSumCents}`,
      );
    }
    if (got.balanceCents !== account.balanceCents) {
      problems.push(
        `account ${account.id}'s balance is ${got.balanceCents ?? "none"} cents; the manifest says ${account.balanceCents ?? "none"}`,
      );
    }
  }
  for (const account of actual.accounts ?? []) {
    if (!wanted.has(account.id)) problems.push(`account ${account.id} is not in the manifest`);
  }
  return problems;
}

/** The checks a snapshot must pass before a restore swaps it in, by the names it reports. */
export type SnapshotCheck = "integrity" | "manifest" | "schema";

export type SnapshotVerdict =
  | { readonly ok: true; readonly tables: number; readonly rows: number }
  | { readonly ok: false; readonly check: SnapshotCheck; readonly message: string };

/**
 * Checks the snapshot at `file` against `manifest` and this build's `migrations`, opening it
 * read-only: `PRAGMA integrity_check` is `ok`; every table's row count and checksum match the
 * manifest (and no table is missing or extra); its applied migrations are a prefix of this
 * build's, so its schema is not newer. Reports the first failing check.
 */
export function verifySnapshot(
  file: string,
  manifest: Manifest,
  migrations: readonly Migration[],
): SnapshotVerdict {
  let db: Db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch (error) {
    return {
      ok: false,
      check: "integrity",
      message: `cannot open the snapshot: ${message(error)}`,
    };
  }
  try {
    let integrity: string[];
    try {
      const rows = db.pragma("integrity_check") as { integrity_check: string }[];
      integrity = rows.map((row) => row.integrity_check);
    } catch (error) {
      return { ok: false, check: "integrity", message: message(error) };
    }
    if (integrity.length !== 1 || integrity[0] !== "ok") {
      return {
        ok: false,
        check: "integrity",
        message: `integrity_check: ${integrity.slice(0, 3).join("; ")}`,
      };
    }

    let actual: Manifest;
    try {
      // Accounts are scanned only for a format-2 manifest, on its own balance date, so a
      // format-1 manifest on an older-schema snapshot verifies as it always did.
      actual =
        manifest.format === 2 && manifest.balanceDate !== undefined
          ? buildManifest(db, { balanceDate: manifest.balanceDate })
          : buildManifest(db, { accounts: false });
    } catch (error) {
      return { ok: false, check: "manifest", message: message(error) };
    }
    const problems = compareManifests(manifest, actual);
    if (problems.length > 0) {
      const more = problems.length > 3 ? ` (and ${problems.length - 3} more)` : "";
      return { ok: false, check: "manifest", message: `${problems.slice(0, 3).join("; ")}${more}` };
    }

    const build = migrations.map((m) => m.name);
    if (actual.schemaVersion > build.length) {
      return {
        ok: false,
        check: "schema",
        message: `the snapshot is at schema version ${actual.schemaVersion}, newer than this build (${build.length})`,
      };
    }
    const stray = actual.migrations.findIndex((name, i) => build[i] !== name);
    if (stray !== -1) {
      return {
        ok: false,
        check: "schema",
        message: `the snapshot has migration ${actual.migrations[stray]} at version ${stray + 1}, but this build expects ${build[stray]}`,
      };
    }
    const rows = actual.tables.reduce((sum, t) => sum + t.rows, 0);
    return { ok: true, tables: actual.tables.length, rows };
  } finally {
    db.close();
  }
}

/** A written snapshot: its manifest and the SHA-256 of the manifest file. */
export interface WrittenSnapshot {
  readonly manifest: Manifest;
  readonly manifestSha256: string;
}

/**
 * Writes a consistent snapshot of the database at `dbFile` into `outDir` (replaced if it
 * exists): `pangolin.sqlite` by `VACUUM INTO` on a read-only connection of its own, switched to a
 * rollback journal so it opens read-only anywhere, and `manifest.json` built from that copy
 * (with `takenAt` when given) and, for the account balances, `balanceDate` (today's UTC date when
 * not given).
 * Synchronous and slow on a large database: run it off the main thread.
 */
export function writeSnapshot(
  dbFile: string,
  outDir: string,
  takenAt?: string,
  balanceDate?: string,
): WrittenSnapshot {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const target = join(outDir, SNAPSHOT_FILE);
  // VACUUM INTO reads one consistent state and never blocks the server's writer (WAL).
  const source = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    source.pragma("busy_timeout = 5000");
    source.prepare("VACUUM INTO ?").run(target);
  } finally {
    source.close();
  }
  const snapshot = new Database(target, { fileMustExist: true });
  let manifest: Manifest;
  try {
    snapshot.pragma("journal_mode = DELETE");
    manifest = buildManifest(snapshot, balanceDate === undefined ? {} : { balanceDate });
    if (takenAt !== undefined) manifest = { ...manifest, takenAt };
  } finally {
    snapshot.close();
  }
  const text = serializeManifest(manifest);
  writeFileSync(join(outDir, MANIFEST_FILE), text, { mode: 0o600 });
  return { manifest, manifestSha256: manifestSha256(text) };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
