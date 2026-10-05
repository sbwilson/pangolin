// Usage: check-upgrade <db-path>
// Migrates the database at <db-path> in place with this build's migrations (every invariant on),
// then snapshots it and checks the snapshot as a restore would: integrity, manifest and schema.
// The release workflow runs it on the database the previous release's image creates (story 1.18).
// Exits 1 naming the failing check (open, migrate, integrity, manifest or schema); 2 on bad usage.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SNAPSHOT_FILE, verifySnapshot, writeSnapshot } from "../manifest.ts";
import {
  defaultInvariants,
  loadMigrations,
  migrate,
  packageMigrationsDir,
  schemaVersion,
} from "../migrate.ts";
import { type Db, openDatabase } from "../open.ts";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(check: string, detail: string): number {
  console.error(`check-upgrade: the ${check} check failed: ${detail}`);
  return 1;
}

function run(args: readonly string[]): number {
  const [arg] = args;
  if (args.length !== 1 || arg === undefined) {
    console.error("Usage: check-upgrade <db-path>");
    return 2;
  }
  // Resolve a relative path against where the user ran `pnpm`, not this package.
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
  const migrations = loadMigrations(packageMigrationsDir);

  let db: Db;
  try {
    // Must exist: never create an empty database and call it upgraded.
    openDatabase(path, { readonly: true }).close();
    db = openDatabase(path);
  } catch (error) {
    return fail("open", `cannot open ${path}: ${message(error)}`);
  }
  try {
    // A file that is not SQLite opens lazily; reading the schema is what rejects it.
    db.prepare("SELECT count(*) FROM sqlite_schema").get();
  } catch (error) {
    db.close();
    return fail("open", `cannot read ${path} as a database: ${message(error)}`);
  }
  let from: number;
  let to: number;
  try {
    from = schemaVersion(db);
    to = migrate(db, migrations, { invariants: defaultInvariants }).schemaVersion;
    // Fold the WAL back into the file so the snapshot's read-only connection sees one file.
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (error) {
    return fail("migrate", message(error));
  } finally {
    db.close();
  }

  const tempDir = mkdtempSync(join(tmpdir(), "pangolin-upgrade-"));
  try {
    let written: ReturnType<typeof writeSnapshot>;
    try {
      // No household here: the UTC date, as decision 83 allows for this tool.
      written = writeSnapshot(path, join(tempDir, "snapshot"), {
        balanceDate: new Date().toISOString().slice(0, 10),
      });
    } catch (error) {
      return fail("manifest", `cannot write the snapshot: ${message(error)}`);
    }
    const verdict = verifySnapshot(
      join(tempDir, "snapshot", SNAPSHOT_FILE),
      written.manifest,
      migrations,
    );
    if (!verdict.ok) return fail(verdict.check, verdict.message);
    if (to !== migrations.length) {
      return fail("schema", `migrated to version ${to}; this build has ${migrations.length}`);
    }
    console.log(`migrated ${from} -> ${to}; integrity, manifest, schema ok (${path})`);
    return 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

process.exitCode = run(process.argv.slice(2));
