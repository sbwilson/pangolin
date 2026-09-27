// Usage: check-strict [db-path]
// With a path, checks that database as it is. Without one, migrates a fresh
// temporary database with the committed migrations and checks that.
// Exits non-zero, listing the tables, when any table is not STRICT.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadMigrations, migrate, packageMigrationsDir } from "../migrate.ts";
import { openDatabase } from "../open.ts";
import { findNonStrictTables } from "../strict-check.ts";

function run(path: string | undefined): number {
  let tempDir: string | undefined;
  let dbPath = path;
  if (dbPath === undefined) {
    tempDir = mkdtempSync(join(tmpdir(), "pangolin-strict-"));
    dbPath = join(tempDir, "pangolin.sqlite");
  }
  const db = openDatabase(dbPath, { readonly: path !== undefined });
  try {
    if (path === undefined) {
      // Invariants off here so a miss is reported as a list below, not as a migration failure.
      migrate(db, loadMigrations(packageMigrationsDir), { invariants: [] });
    }
    const tables = findNonStrictTables(db);
    if (tables.length > 0) {
      console.error(`Tables not created STRICT (${tables.length}):`);
      for (const table of tables) console.error(`  ${table}`);
      return 1;
    }
    console.log(`All tables are STRICT (${dbPath}).`);
    return 0;
  } finally {
    db.close();
    if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
  }
}

// Resolve a relative path against where the user ran `pnpm`, not this package.
const arg = process.argv[2];
process.exitCode = run(
  arg === undefined ? undefined : resolve(process.env.INIT_CWD ?? process.cwd(), arg),
);
