// A cross-process lock made of SQLite's own file locking (story 1.9, AD-16): an `EXCLUSIVE`
// transaction held open on a tiny database file in rollback-journal mode. The kernel drops the
// POSIX locks when the process dies, so a crash never leaves the lock stuck, and it works between
// containers that share the file through a bind mount or volume.
import Database from "better-sqlite3";

export interface ExclusiveLock {
  /** Ends the transaction and closes the file, releasing the lock. Safe to call twice. */
  release(): void;
}

function isBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
}

/**
 * Takes the exclusive lock on the SQLite file at `path` (created when missing) without waiting
 * (`busy_timeout` 0). Returns undefined when another connection, in this process or another,
 * holds it. The caller must keep the returned object: the lock lasts until `release()`.
 */
export function tryExclusiveLock(path: string): ExclusiveLock | undefined {
  const db = new Database(path, { timeout: 0 });
  try {
    db.pragma("busy_timeout = 0");
    db.pragma("journal_mode = DELETE");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if (isBusy(error)) return undefined;
    throw error;
  }
  let held = true;
  return {
    release: () => {
      if (!held) return;
      held = false;
      try {
        db.exec("ROLLBACK");
      } finally {
        db.close();
      }
    },
  };
}
