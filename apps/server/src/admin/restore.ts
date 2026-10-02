// `pangolin restore [snapshot|latest]` (story 1.10, AD-16): the one exception to the single write
// path. It runs only on a stopped stack (the host's `pangolin` stops it first and starts it
// after), under the exclusive data-directory lock:
//   1. restore the restic snapshot into a fresh `<dataDir>/restore-<stamp>/`;
//   2. verify it: `PRAGMA integrity_check`, every table against its manifest, and a schema no
//      newer than this build;
//   3. ask whether to restore the snapshot's credentials or keep the current ones (story 1.16);
//      an interrupt or no answer here changes nothing;
//   4. swap it in, moving the replaced files to `<dataDir>/pre-restore-<stamp>/`;
//   5. before the server starts, migrate it, apply the credential choice, raise the household
//      review item that the data was rolled back, and make every pending or running job with
//      external effects `dead` (reason `restored`); the server re-seeds the schedules when it starts.
//   6. record the restored snapshot as the last backup, so status shows where the data came from.
// A failed check swaps nothing. A lock held by anyone refuses before anything is touched.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import {
  cancelJobsForRestore,
  clearCredentials,
  newId,
  type PersonRow,
  RESTORED_REVIEW,
  raiseReviewItem,
  recordBackupPush,
  recordBackupSnapshot,
  systemClock,
  type UseCaseContext,
  write,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  MANIFEST_FILE,
  manifestSha256,
  migrate,
  openDatabase,
  parseManifest,
} from "@pangolin/db";
import { backupPaths, fileStamp } from "../backup/paths.ts";
import { createRestic, type Restic } from "../backup/restic.ts";
import { type FetchedSnapshot, fetchSnapshot, swapIn, verifyFetched } from "../backup/restore.ts";
import type { Config } from "../config.ts";
import { EXTERNAL_EFFECT_KINDS } from "../jobs/index.ts";
import { BACKUPS_NOT_CONFIGURED } from "./commands.ts";
import { acquireDataDirLock, type DataDirLock, DataDirLocked } from "./lock.ts";

/** Whose sign-in details the restored database keeps: the snapshot's, or the current ones. */
export type CredentialChoice = "restore" | "keep";

export interface RestoreDeps {
  readonly config: Config;
  /**
   * Answers the credential question. Called after verification and before the swap, only when
   * there is a current database to keep credentials from. Rejecting (no answer) fails the
   * restore with nothing swapped in.
   */
  readonly credentials: () => Promise<CredentialChoice>;
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
      /** What happened to the credentials. */
      readonly credentials: CredentialOutcome;
    }
  | {
      readonly ok: false;
      /** `lock`, `config`, `fetch`, `credentials` (no answer), a verification check (`integrity`, `manifest`, `schema`), or `swap`. */
      readonly failed: string;
      readonly message: string;
    };

/** What the credential step did, as audited and printed. */
export interface CredentialOutcome {
  readonly choice: CredentialChoice;
  /** `keep` only: whether a current database was there to carry credentials from. */
  readonly carried: boolean;
  /** Logins whose current credentials were carried onto the restored database. */
  readonly keptLogins: number;
  /** Logins only the snapshot had, whose credentials were cleared. */
  readonly clearedLogins: number;
}

/** [table, the column that owns a row: a login (`auth_user.id`) or a person]. */
const CREDENTIAL_TABLES = [
  ["auth_account", "user_id"],
  ["auth_passkey", "user_id"],
  ["auth_session", "user_id"],
  ["auth_two_factor", "user_id"],
  ["recovery_code", "person_id"],
  ["re_enrolment_link", "person_id"],
] as const;

function columns(db: Db, schema: "main" | "cur", table: string): string[] {
  return (db.pragma(`${schema}.table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * `keep`: ATTACHes the replaced database as `cur` and, for every login in both (same
 * `auth_user.id`), replaces the restored rows of the six credential tables with the current ones
 * (shared columns only, so an older schema still works; a table or column the replaced database
 * lacks carries nothing, and the snapshot's rows for that login are dropped). Re-enrolment links
 * of a login only the snapshot has are removed. Returns the people of the logins only the
 * snapshot has, for `clearCredentials`, and how many logins were kept.
 */
function carryCredentials(
  db: Db,
  previousDb: string,
): { kept: number; snapshotOnly: (PersonRow & { userId: string })[] } {
  db.prepare("ATTACH DATABASE ? AS cur").run(previousDb);
  try {
    return db.transaction(() => {
      db.exec(
        "CREATE TEMP TABLE keep_user (id TEXT PRIMARY KEY); CREATE TEMP TABLE keep_person (id TEXT PRIMARY KEY)",
      );
      const hasCurrentLogins = columns(db, "cur", "auth_user").includes("id");
      if (hasCurrentLogins) {
        db.exec(
          "INSERT INTO keep_user SELECT m.id FROM main.auth_user m JOIN cur.auth_user c ON c.id = m.id",
        );
      }
      db.exec(
        "INSERT INTO keep_person SELECT id FROM main.person WHERE user_id IN (SELECT id FROM keep_user)",
      );
      for (const [table, owner] of CREDENTIAL_TABLES) {
        const set = owner === "user_id" ? "keep_user" : "keep_person";
        db.exec(
          `DELETE FROM main.${ident(table)} WHERE ${ident(owner)} IN (SELECT id FROM ${set})`,
        );
        const current = new Set(columns(db, "cur", table));
        const shared = columns(db, "main", table).filter((name) => current.has(name));
        if (!shared.includes(owner)) continue;
        const list = shared.map(ident).join(", ");
        db.exec(
          `INSERT INTO main.${ident(table)} (${list}) SELECT ${list} FROM cur.${ident(table)} WHERE ${ident(owner)} IN (SELECT id FROM ${set})`,
        );
      }
      if (
        columns(db, "main", "auth_user").includes("two_factor_enabled") &&
        columns(db, "cur", "auth_user").includes("two_factor_enabled")
      ) {
        db.exec(
          `UPDATE main.auth_user SET two_factor_enabled =
             (SELECT c.two_factor_enabled FROM cur.auth_user c WHERE c.id = main.auth_user.id)
           WHERE id IN (SELECT id FROM keep_user)`,
        );
      }
      const snapshotOnly = db
        .prepare(
          `SELECT id, user_id AS userId, display_name AS displayName, colour,
                  created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
           FROM main.person
           WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM keep_user)`,
        )
        .all() as (PersonRow & { userId: string })[];
      for (const person of snapshotOnly) {
        db.prepare("DELETE FROM main.re_enrolment_link WHERE person_id = ?").run(person.id);
      }
      const kept = db.prepare("SELECT count(*) FROM keep_user").pluck().get() as number;
      db.exec("DROP TABLE keep_user; DROP TABLE keep_person");
      return { kept, snapshotOnly };
    })();
  } finally {
    db.exec("DETACH DATABASE cur");
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Migrates the swapped-in database, cancels jobs with external effects, then records the
 * restored snapshot as pushed (the database was copied before its own row was written), all as
 * `cli:restore`. The push job that recording enqueues finds it pushed and does nothing.
 */
function afterSwap(
  dbFile: string,
  migrationsDir: string,
  fetched: FetchedSnapshot,
  choice: CredentialChoice,
  previousDb: string | undefined,
): { schemaVersion: number; cancelled: number; credentials: CredentialOutcome } {
  const snapshotId = fetched.snapshot.id;
  const text = readFileSync(join(fetched.dbDir, MANIFEST_FILE), "utf8");
  const manifest = parseManifest(text);
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
    // `keep` with no replaced database (a restore onto an empty data directory) has nothing to
    // keep: the snapshot's credentials stand.
    const carry =
      choice === "keep" && previousDb !== undefined ? carryCredentials(db, previousDb) : undefined;
    const credentials: CredentialOutcome = {
      choice,
      carried: carry !== undefined,
      keptLogins: carry?.kept ?? 0,
      clearedLogins: carry?.snapshotOnly.length ?? 0,
    };
    write(ctx, (tx, audit) => {
      for (const person of carry?.snapshotOnly ?? []) {
        clearCredentials(ctx, tx, audit, person, "restore");
      }
      audit({
        entity: "restore",
        entityId: snapshotId,
        action: "credentials",
        before: null,
        after: credentials,
      });
      raiseReviewItem(tx, audit, ctx, {
        kind: RESTORED_REVIEW,
        entityRef: `backup_snapshot:${snapshotId}`,
        dedupeKey: `system.restored:${snapshotId}`,
      });
    });
    const cancelled = cancelJobsForRestore(ctx, {
      kinds: EXTERNAL_EFFECT_KINDS,
      snapshot: snapshotId,
    });
    // The staged directory's name is the snapshot job's ID, the row's ID.
    const id = basename(fetched.dbDir);
    recordBackupSnapshot(ctx, {
      id,
      takenAt: manifest.takenAt ?? new Date(fetched.snapshot.time).toISOString(),
      schemaVersion: manifest.schemaVersion,
      tableCount: manifest.tables.length,
      rowCount: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
      manifestSha256: manifestSha256(text),
    });
    recordBackupPush(ctx, { id, resticSnapshotId: snapshotId });
    return { schemaVersion, cancelled, credentials };
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
  // Only a directory this call created is ever removed.
  let created = false;
  const cleanUp = () => {
    if (created) rmSync(dir, { recursive: true, force: true });
  };
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
      mkdirSync(dir, { mode: 0o700 });
      created = true;
      fetched = await fetchSnapshot(restic, ref, dir);
    } catch (error) {
      cleanUp();
      return { ok: false, failed: "fetch", message: message(error) };
    }
    const { snapshot } = fetched;
    out(`Restored snapshot ${snapshot.id.slice(0, 8)} (taken ${snapshot.time}); verifying …`);
    const verdict = verifyFetched(fetched, loadMigrations(deps.migrationsDir));
    if (!verdict.ok) {
      cleanUp();
      return { ok: false, failed: verdict.check, message: verdict.message };
    }
    out("integrity_check: ok");
    out(`Manifest: all ${verdict.tables} tables match (${verdict.rows} rows)`);

    // Ask before anything moves, so an interrupt or a closed input changes nothing. With no
    // current database there is nothing to keep, and nothing to ask.
    let choice: CredentialChoice = "restore";
    const hasCurrent = existsSync(paths.dbFile);
    if (hasCurrent) {
      try {
        choice = await deps.credentials();
      } catch (error) {
        cleanUp();
        return {
          ok: false,
          failed: "credentials",
          message: `${message(error)}; nothing was swapped in`,
        };
      }
    } else {
      out("No current database: the snapshot's sign-in details are restored.");
    }

    let swapped: ReturnType<typeof swapIn>;
    try {
      swapped = swapIn(config.dataDir, fetched, stamp);
    } catch (error) {
      // swapIn has already moved back whatever it had moved.
      cleanUp();
      return { ok: false, failed: "swap", message: `${message(error)}; nothing was swapped in` };
    }
    let after: ReturnType<typeof afterSwap>;
    try {
      const previousDb = join(swapped.preRestoreDir, basename(paths.dbFile));
      after = afterSwap(
        paths.dbFile,
        deps.migrationsDir,
        fetched,
        choice,
        existsSync(previousDb) ? previousDb : undefined,
      );
    } catch (error) {
      try {
        swapped.undo();
      } catch (undoError) {
        // Delete nothing: the previous files are still in the pre-restore directory.
        created = false;
        return {
          ok: false,
          failed: "swap",
          message: `${message(error)}; putting the previous database back also failed (${message(undoError)}): the previous database and attachments are in ${swapped.preRestoreDir}`,
        };
      }
      cleanUp();
      return {
        ok: false,
        failed: "swap",
        message: `${message(error)}; the previous database is back in place`,
      };
    }
    cleanUp();
    return {
      ok: true,
      snapshotId: snapshot.id,
      tables: verdict.tables,
      rows: verdict.rows,
      schemaVersion: after.schemaVersion,
      cancelled: after.cancelled,
      preRestoreDir: swapped.preRestoreDir,
      credentials: after.credentials,
    };
  } catch (error) {
    cleanUp();
    throw error;
  } finally {
    lock.release();
  }
}
