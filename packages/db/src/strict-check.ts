import type { Db } from "./open.ts";

/** Names of ordinary tables in `main` that were not created `STRICT`. */
export function findNonStrictTables(db: Db): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM pragma_table_list
       WHERE schema = 'main' AND type = 'table' AND strict = 0 AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       ORDER BY name`,
    )
    .pluck()
    .all() as string[];
  return rows;
}

/** Invariant for the migration runner: every table is STRICT. */
export function assertAllTablesStrict(db: Db): void {
  const tables = findNonStrictTables(db);
  if (tables.length > 0) {
    throw new Error(`Tables not created STRICT: ${tables.join(", ")}`);
  }
}
