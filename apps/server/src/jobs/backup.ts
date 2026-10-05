// The backup job handlers (story 1.10): `backup-snapshot` (local) writes a consistent snapshot
// and its manifest to the staging directory, then records it, which enqueues `backup-push` (net),
// which pushes it with restic and empties its staging directory. Both are idempotent per job.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  BACKUP_CHECK_JOB,
  BACKUP_DRILL_JOB,
  BACKUP_PUSH_JOB,
  BACKUP_SNAPSHOT_JOB,
  backupsAwaitingPush,
  getBackupSnapshot,
  type JobRegistration,
  jobHandler,
  lastBackup,
  recordBackupPush,
  recordBackupSnapshot,
  recordBackupVerification,
} from "@pangolin/app";
import { loadMigrations, type SnapshotCheck } from "@pangolin/db";
import {
  type BackupPaths,
  backupPaths,
  fileStamp,
  PARTIAL_SUFFIX,
  stagingDir,
} from "../backup/paths.ts";
import { createRestic, type Restic, ResticError } from "../backup/restic.ts";
import { fetchSnapshot, SnapshotNotFound, verifyFetched } from "../backup/restore.ts";
import {
  type SnapshotSummary,
  type TakeSnapshotOptions,
  takeSnapshot,
} from "../backup/snapshot.ts";
import type { BackupConfig } from "../config.ts";

export interface BackupJobDeps {
  readonly dataDir: string;
  /** This build's migrations, which the restore drill verifies the snapshot against. */
  readonly migrationsDir: string;
  readonly backup: BackupConfig;
  /** Replaces restic, for tests. */
  readonly restic?: Restic;
  /** Replaces the snapshot worker, for tests. */
  readonly snapshot?: (options: TakeSnapshotOptions) => Promise<SnapshotSummary>;
}

/** The staging directory's subdirectories, by name. */
function stagingEntries(paths: BackupPaths): string[] {
  if (!existsSync(paths.stagingRoot)) return [];
  return readdirSync(paths.stagingRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The snapshots staged now: one directory each, partial ones (still being written) left out. */
function listStaged(paths: BackupPaths): string[] {
  return stagingEntries(paths).filter((name) => !name.endsWith(PARTIAL_SUFFIX));
}

function removeStaged(paths: BackupPaths, name: string): void {
  rmSync(join(paths.stagingRoot, name), { recursive: true, force: true });
}

/**
 * What a failed check or drill is stored, returned and audited as: the kind of check and, when a
 * snapshot was fetched, its short ID. Never the verdict's or restic's own text: a manifest
 * mismatch names private account IDs with their counts and sums, and the summary reaches the
 * backup status and the unscoped audit log. The detailed message stays on the operator paths.
 */
function failureSummary(
  check: SnapshotCheck | "restore" | "repository",
  snapshotId?: string,
): string {
  return `the ${check} check failed${snapshotId === undefined ? "" : ` on snapshot ${snapshotId.slice(0, 8)}`}`;
}

/** The restore drill's directory names, under `<dataDir>/backup`. */
const DRILL_PREFIX = "drill-";

export function backupJobs(deps: BackupJobDeps): JobRegistration[] {
  const paths = backupPaths(deps.dataDir);
  const { repository } = deps.backup;
  const snapshot = deps.snapshot ?? takeSnapshot;
  let restic = deps.restic;
  const resticFor = (url: string): Restic => {
    restic ??= createRestic({
      bin: deps.backup.resticBin,
      repository: url,
      passwordFile: deps.backup.passwordFile,
      cacheDir: paths.cacheDir,
      tmpDir: paths.tmpDir,
    });
    return restic;
  };

  const snapshotHandler = jobHandler(BACKUP_SNAPSHOT_JOB, async (ctx) => {
    // Backups were turned off after this was enqueued: nothing to do.
    if (repository === null) return;
    const id = ctx.job.id;
    // An earlier attempt got as far as recording it.
    if (getBackupSnapshot(ctx, { id }) !== undefined) return;
    const dir = stagingDir(paths, id);
    const partial = `${dir}${PARTIAL_SUFFIX}`;
    mkdirSync(paths.stagingRoot, { recursive: true, mode: 0o700 });
    // Bound the staging area: at most one earlier snapshot waits for its push, beside this one.
    // Partial snapshots are left by attempts that died or timed out; older staged ones are
    // superseded by this one (a push that finds its directory gone completes as superseded).
    const awaiting = backupsAwaitingPush(ctx, { ids: listStaged(paths) }).sort();
    const keep = awaiting.at(-1);
    for (const name of stagingEntries(paths)) if (name !== keep) removeStaged(paths, name);
    const takenAt = ctx.clock.now().toString({ fractionalSecondDigits: 3 });
    const summary = await snapshot({
      dbFile: paths.dbFile,
      outDir: partial,
      takenAt,
      balanceDate: ctx.clock.today().toString(),
      signal: ctx.signal,
    });
    rmSync(dir, { recursive: true, force: true });
    renameSync(partial, dir);
    recordBackupSnapshot(ctx, { id, takenAt, ...summary });
  });

  const pushHandler = jobHandler(BACKUP_PUSH_JOB, async (ctx, { backupId }) => {
    if (repository === null) return;
    const row = getBackupSnapshot(ctx, { id: backupId });
    if (row === undefined) throw new Error(`No backup snapshot ${backupId}`);
    const dir = stagingDir(paths, backupId);
    if (row.pushedAt === null) {
      if (!existsSync(dir)) {
        // A newer snapshot was pushed, or is staged and pruned this one: nothing left to do.
        const last = lastBackup(ctx);
        if (last !== null && last.takenAt >= row.takenAt) return;
        const newer = listStaged(paths).some((name) => name > backupId);
        if (newer) return;
        throw new Error(`The staged snapshot ${backupId} is missing`);
      }
      const client = resticFor(repository);
      await client.ensureRepository(ctx.signal);
      // The database snapshot first, then the attachments (AD-21), in one restic snapshot.
      const targets = existsSync(paths.attachmentsDir) ? [dir, paths.attachmentsDir] : [dir];
      const resticSnapshotId = await client.backup(targets, {
        time: row.takenAt,
        signal: ctx.signal,
      });
      const staged = listStaged(paths);
      const { removable } = recordBackupPush(ctx, { id: backupId, resticSnapshotId, staged });
      // Snapshot IDs are job IDs (ULIDs), so name order is the order they were taken: anything
      // staged before this one is superseded by it.
      for (const name of staged) {
        if (removable.includes(name) || name < backupId) removeStaged(paths, name);
      }
    } else {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const checkHandler = jobHandler(BACKUP_CHECK_JOB, async (ctx) => {
    if (repository === null) return;
    // Nothing pushed yet: the repository may not exist, and there is nothing to check.
    if (lastBackup(ctx) === null) return;
    try {
      await resticFor(repository).check(ctx.signal);
    } catch (error) {
      // restic ran and found a problem. Anything else (could not run, no answer, aborted) is
      // not a verdict: the runner retries it, and a dead job raises its own review item.
      if (!(error instanceof ResticError) || error.exitCode === null) throw error;
      recordBackupVerification(ctx, {
        kind: "check",
        ok: false,
        summary: failureSummary("repository"),
      });
      return;
    }
    recordBackupVerification(ctx, {
      kind: "check",
      ok: true,
      summary: "the repository check found no errors",
    });
  });

  const drillHandler = jobHandler(BACKUP_DRILL_JOB, async (ctx) => {
    if (repository === null) return;
    if (lastBackup(ctx) === null) return;
    const client = resticFor(repository);
    // On the data volume, not `/tmp`; never anywhere the live files are. A directory an earlier
    // attempt left when it died is removed first.
    for (const name of existsSync(paths.backupDir) ? readdirSync(paths.backupDir) : []) {
      if (name.startsWith(DRILL_PREFIX)) {
        rmSync(join(paths.backupDir, name), { recursive: true, force: true });
      }
    }
    const dir = join(
      paths.backupDir,
      `${DRILL_PREFIX}${fileStamp(ctx.clock.now().epochMilliseconds)}`,
    );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      let summary: string;
      let ok: boolean;
      try {
        const fetched = await fetchSnapshot(client, "latest", dir, ctx.signal);
        const verdict = verifyFetched(fetched, loadMigrations(deps.migrationsDir));
        ok = verdict.ok;
        summary = verdict.ok
          ? `restored snapshot ${fetched.snapshot.id.slice(0, 8)} and verified ${verdict.tables} tables, ${verdict.rows} rows`
          : failureSummary(verdict.check, fetched.snapshot.id);
      } catch (error) {
        if (error instanceof SnapshotNotFound) return;
        if (error instanceof ResticError && error.exitCode === null) throw error;
        if (ctx.signal.aborted) throw error;
        // restic ran and failed, or the snapshot is not a Pangolin backup.
        ok = false;
        summary = failureSummary("restore");
      }
      recordBackupVerification(ctx, { kind: "drill", ok, summary });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  return [snapshotHandler, pushHandler, checkHandler, drillHandler];
}
