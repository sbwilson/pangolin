// Where backups and restores live in the data directory (story 1.10). Everything stays on the
// data volume (the encrypted disk), never `/tmp`: a snapshot is a full copy of the household.
import { join } from "node:path";

/** The live database's file name in the data directory. */
export const DB_FILE = "pangolin.sqlite";
/** SQLite's side files, moved with the database. */
export const DB_SIDE_FILES = ["-wal", "-shm", "-journal"] as const;
/** A staged snapshot still being written; never pushed or cleaned by anyone but its own job. */
export const PARTIAL_SUFFIX = ".partial";

export interface BackupPaths {
  readonly dataDir: string;
  /** The live database. */
  readonly dbFile: string;
  /** `/data/attachments`, pushed when it exists. */
  readonly attachmentsDir: string;
  /** `/data/backup`. */
  readonly backupDir: string;
  /** `/data/backup/staging`: one directory per snapshot, removed once pushed. */
  readonly stagingRoot: string;
  /** `/data/backup/cache`: restic's cache. */
  readonly cacheDir: string;
  /** `/data/backup/tmp`: restic's temporary files (the container's `/tmp` is a small tmpfs). */
  readonly tmpDir: string;
}

export function backupPaths(dataDir: string): BackupPaths {
  const backupDir = join(dataDir, "backup");
  return {
    dataDir,
    dbFile: join(dataDir, DB_FILE),
    attachmentsDir: join(dataDir, "attachments"),
    backupDir,
    stagingRoot: join(backupDir, "staging"),
    cacheDir: join(backupDir, "cache"),
    tmpDir: join(backupDir, "tmp"),
  };
}

const ID_RE = /^[0-9A-Za-z]{1,64}$/;

/** The staging directory of snapshot `id` (a job ID). Throws for anything that is not an ID. */
export function stagingDir(paths: BackupPaths, id: string): string {
  if (!ID_RE.test(id)) throw new Error(`Not a snapshot ID: ${JSON.stringify(id)}`);
  return join(paths.stagingRoot, id);
}

/** `2026-09-27T02-30-00Z`: an instant as a file-name-safe stamp, to the second. */
export function fileStamp(epochMs: number): string {
  return new Date(epochMs)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-");
}
