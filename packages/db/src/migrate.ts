import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./open.ts";
import { assertAllTablesStrict } from "./strict-check.ts";

/** One committed `.sql` migration. Its version is its 1-based position in the journal. */
export interface Migration {
  readonly name: string;
  readonly sql: string;
}

/** A check that must hold after every migration, inside its transaction. Throws on failure. */
export type Invariant = (db: Db) => void;

export interface MigrateOptions {
  readonly invariants?: readonly Invariant[];
  readonly now?: () => Date;
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly schemaVersion: number;
}

export class MigrationError extends Error {
  readonly migration: string;

  constructor(migration: string, message: string, options?: ErrorOptions) {
    super(`Migration ${migration} failed: ${message}`, options);
    this.name = "MigrationError";
    this.migration = migration;
  }
}

/** The invariant suite run after every migration. */
export const defaultInvariants: readonly Invariant[] = [assertAllTablesStrict];

/** The migrations committed in this package, when running from source. */
export const packageMigrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

interface Journal {
  readonly entries: readonly { readonly idx: number; readonly tag: string }[];
}

/**
 * Loads migrations in journal order from a drizzle-kit `out` directory.
 * Every `.sql` file must be in the journal and every journal entry must have a file.
 */
export function loadMigrations(dir: string): Migration[] {
  const journalPath = join(dir, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`No migration journal at ${journalPath}`);
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const tags = new Set(entries.map((entry) => entry.tag));
  const stray = readdirSync(dir).filter(
    (file) => file.endsWith(".sql") && !tags.has(file.slice(0, -4)),
  );
  if (stray.length > 0) {
    throw new Error(`Migration files missing from the journal: ${stray.join(", ")}`);
  }
  return entries.map((entry) => ({
    name: entry.tag,
    sql: readFileSync(join(dir, `${entry.tag}.sql`), "utf8"),
  }));
}

function trackingTableExists(db: Db): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migration'")
      .get() !== undefined
  );
}

function ensureTrackingTable(db: Db): void {
  if (trackingTableExists(db)) return;
  db.exec(`CREATE TABLE schema_migration (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  ) STRICT`);
}

function appliedNames(db: Db): string[] {
  if (!trackingTableExists(db)) return [];
  return db.prepare("SELECT name FROM schema_migration ORDER BY version").pluck().all() as string[];
}

/** Schema version = the number of applied migrations. */
export function schemaVersion(db: Db): number {
  return appliedNames(db).length;
}

function applyOne(
  db: Db,
  migration: Migration,
  version: number,
  invariants: readonly Invariant[],
  now: () => Date,
): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      if (!db.inTransaction) {
        throw new Error(
          "the migration ended the runner's transaction; remove BEGIN/COMMIT from it",
        );
      }
      db.prepare("INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)").run(
        version,
        migration.name,
        now().toISOString(),
      );
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length > 0) {
        throw new Error(`foreign_key_check found violations: ${JSON.stringify(violations)}`);
      }
      for (const invariant of invariants) invariant(db);
      db.exec("COMMIT");
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MigrationError(migration.name, message, { cause: error });
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * Applies pending migrations in order, forward-only, each in its own transaction
 * (see the spine's Migrations convention).
 */
export function migrate(
  db: Db,
  migrations: readonly Migration[],
  options: MigrateOptions = {},
): MigrateResult {
  const invariants = options.invariants ?? defaultInvariants;
  const now = options.now ?? (() => new Date());

  const applied = appliedNames(db);
  if (applied.length > migrations.length) {
    throw new Error(
      `Database is at schema version ${applied.length}, newer than this build (${migrations.length} migrations)`,
    );
  }
  applied.forEach((name, index) => {
    const expected = migrations[index]?.name;
    if (name !== expected) {
      throw new Error(
        `Database has migration ${name} at version ${index + 1}, but this build expects ${expected}`,
      );
    }
  });

  const pending = migrations.slice(applied.length);
  if (pending.length === 0) return { applied: [], schemaVersion: applied.length };

  ensureTrackingTable(db);
  const done: string[] = [];
  pending.forEach((migration, offset) => {
    applyOne(db, migration, applied.length + offset + 1, invariants, now);
    done.push(migration.name);
  });
  return { applied: done, schemaVersion: applied.length + done.length };
}
