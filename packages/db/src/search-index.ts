import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * Merges the `txn_fts` segments. An FTS5 DELETE only marks a row gone: the words stay readable in
 * the `txn_fts_data` shadow table until a merge, so an erase (the household leave) runs this after
 * its deletes to leave no erased text behind.
 */
export function optimizeSearchIndex(orm: BetterSQLite3Database): void {
  orm.run(sql`INSERT INTO txn_fts (txn_fts) VALUES ('optimize')`);
}
