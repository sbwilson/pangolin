// The data-directory lock (story 1.9, AD-16): one writer per data directory. The server takes it
// before opening `pangolin.sqlite` and holds it until it closes; `pangolin reset-user` on a
// stopped stack takes the same lock before it opens the database. It is a kernel lock (SQLite's
// POSIX locks on `<dataDir>/pangolin.lock`), so it is released when its process dies.
import { join } from "node:path";
import { tryExclusiveLock } from "@pangolin/db";

export const LOCK_FILE = "pangolin.lock";

/** Another process (or another holder in this one) holds the data directory. */
export class DataDirLocked extends Error {
  readonly dataDir: string;

  constructor(dataDir: string) {
    super(`another process holds ${dataDir}`);
    this.name = "DataDirLocked";
    this.dataDir = dataDir;
  }
}

export interface DataDirLock {
  /** Releases the lock. Safe to call twice. */
  release(): void;
}

/**
 * Takes the exclusive lock on the existing directory `dataDir` without waiting (creating the lock
 * file when missing). Throws `DataDirLocked` when it is held.
 */
export function acquireDataDirLock(dataDir: string): DataDirLock {
  const lock = tryExclusiveLock(join(dataDir, LOCK_FILE));
  if (lock === undefined) throw new DataDirLocked(dataDir);
  return lock;
}
