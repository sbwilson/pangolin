// `pangolin restore [snapshot|latest]` (story 1.10, AD-16): the one exception to the single write
// path. It runs only on a stopped stack (the host's `pangolin` stops it first and starts it
// after), under the exclusive data-directory lock:
//   1. restore the restic snapshot into a fresh `<dataDir>/restore-<stamp>/`;
//   2. verify it: `PRAGMA integrity_check`, every table against its manifest, and a schema no
//      newer than this build;
//   3. swap it in, moving the replaced files to `<dataDir>/pre-restore-<stamp>/`;
//   4. before the server starts, migrate it and make every pending or running job with external
//      effects `dead` (reason `restored`); the server re-seeds the schedules when it starts.
// A failed check swaps nothing. A lock held by anyone refuses before anything is touched.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cancelJobsForRestore, newId, systemClock, type UseCaseContext } from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { createUnitOfWork, type Db, loadMigrations, migrate, openDatabase } from "@pangolin/db";
import { backupPaths, fileStamp } from "../backup/paths.ts";
import { createRestic, type Restic } from "../backup/restic.ts";
import { type FetchedSnapshot, fetchSnapshot, swapIn, verifyFetched } from "../backup/restore.ts";
import type { Config } from "../config.ts";
import { EXTERNAL_EFFECT_KINDS } from "../jobs/index.ts";
import { BACKUPS_NOT_CONFIGURED } from "./commands.ts";
import { acquireDataDirLock, type DataDirLock, DataDirLocked } from "./lock.ts";

export interface RestoreDeps {
  readonly config: Config;
  /** The migrations this build ships. */
  readonly migrationsDir: string;
  /** Progress lines for the console. */
  readonly out: (line: string) => void;
  /** Replaces restic, for tests. */
  readonly restic?: Restic;
  /** Epoch milliseconds, for the directory stamps. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export type RestoreResult =
  | {
      readonly ok: true;
      readonly snapshotId: string;
      readonly tables: number;
      readonly rows: number;
      readonly schemaVersion: number;
      readonly cancelled: number;
      readonly preRestoreDir: string;
    }
  | {
      readonly ok: false;
      /** `lock`, `config`, `fetch`, a verification check (`integrity`, `manifest`, `schema`), or `swap`. */
      readonly failed: string;
      readonly message: string;
    };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Migrates the swapped-in database and cancels jobs with external effects, as `cli:restore`. */
function afterSwap(
  dbFile: string,
  migrationsDir: string,
  snapshotId: string,
): { schemaVersion: number; cancelled: number } {
  let db: Db | undefined;
  try {
    db = openDatabase(dbFile);
    const { schemaVersion } = migrate(db, loadMigrations(migrationsDir));
    const uow = createUnitOfWork(db);
    const timezone = uow.read((repos) => repos.householdSettings.get().timezone);
    const ctx: UseCaseContext = {
      viewer: systemViewer("cli:restore"),
      clock: systemClock(timezone),
      newId,
      uow,
    };
    const cancelled = cancelJobsForRestore(ctx, {
      kinds: EXTERNAL_EFFECT_KINDS,
      snapshot: snapshotId,
    });
    return { schemaVersion, cancelled };
  } finally {
    db?.close();
  }
}

/**
 * Restores snapshot `ref` (an ID or prefix, or `latest`) over the data directory. Never throws
 * for an expected failure: it answers `{ ok: false }` naming what failed.
 */
export async function restoreStopped(ref: string, deps: RestoreDeps): Promise<RestoreResult> {
  const { config, out } = deps;
  const repository = config.backup.repository;
  if (repository === null) {
    return { ok: false, failed: "config", message: BACKUPS_NOT_CONFIGURED };
  }
  const paths = backupPaths(config.dataDir);
  mkdirSync(config.dataDir, { recursive: true });
  let lock: DataDirLock;
  try {
    lock = acquireDataDirLock(config.dataDir);
  } catch (error) {
    if (!(error instanceof DataDirLocked)) throw error;
    return {
      ok: false,
      failed: "lock",
      message: `Another process holds ${config.dataDir} (is the server running?): stop the stack first; sudo pangolin restore on the host does`,
    };
  }
  const stamp = fileStamp((deps.now ?? Date.now)());
  const dir = join(config.dataDir, `restore-${stamp}`);
  try {
    const restic =
      deps.restic ??
      createRestic({
        bin: config.backup.resticBin,
        repository,
        passwordFile: config.backup.passwordFile,
        cacheDir: paths.cacheDir,
        tmpDir: paths.tmpDir,
      });
    let fetched: FetchedSnapshot;
    try {
      out(`Fetching snapshot ${ref} into ${dir} …`);
      fetched = await fetchSnapshot(restic, ref, dir);
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      return { ok: false, failed: "fetch", message: message(error) };
    }
    const { snapshot } = fetched;
    out(`Restored snapshot ${snapshot.id.slice(0, 8)} (taken ${snapshot.time}); verifying …`);
    const verdict = verifyFetched(fetched, loadMigrations(deps.migrationsDir));
    if (!verdict.ok) {
      rmSync(dir, { recursive: true, force: true });
      return { ok: false, failed: verdict.check, message: verdict.message };
    }
    out("integrity_check: ok");
    out(`Manifest: all ${verdict.tables} tables match (${verdict.rows} rows)`);

    let swapped: ReturnType<typeof swapIn>;
    try {
      swapped = swapIn(config.dataDir, fetched, stamp);
    } catch (error) {
      // swapIn has already moved back whatever it had moved.
      rmSync(dir, { recursive: true, force: true });
      return { ok: false, failed: "swap", message: `${message(error)}; nothing was swapped in` };
    }
    let after: { schemaVersion: number; cancelled: number };
    try {
      after = afterSwap(paths.dbFile, deps.migrationsDir, snapshot.id);
    } catch (error) {
      swapped.undo();
      rmSync(dir, { recursive: true, force: true });
      return {
        ok: false,
        failed: "swap",
        message: `${message(error)}; the previous database is back in place`,
      };
    }
    rmSync(dir, { recursive: true, force: true });
    return {
      ok: true,
      snapshotId: snapshot.id,
      tables: verdict.tables,
      rows: verdict.rows,
      schemaVersion: after.schemaVersion,
      cancelled: after.cancelled,
      preRestoreDir: swapped.preRestoreDir,
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally {
    lock.release();
  }
}
