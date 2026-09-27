import Database from "better-sqlite3";

export type Db = Database.Database;

export interface OpenOptions {
  readonly readonly?: boolean;
}

/** Opens a SQLite database in WAL mode with `foreign_keys = ON`. */
export function openDatabase(path: string, options: OpenOptions = {}): Db {
  const readonly = options.readonly ?? false;
  const db = new Database(path, { readonly, fileMustExist: readonly });
  try {
    db.pragma("busy_timeout = 5000");
    // A read-only connection cannot switch journal mode; it keeps whatever the file has.
    if (!readonly && !db.readonly) {
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
    }
    db.pragma("foreign_keys = ON");
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
