// The backup job handlers (story 1.10): `backup-snapshot` (local) writes a consistent snapshot
// and its manifest to the staging directory, then records it, which enqueues `backup-push` (net),
// which pushes it with restic and empties its staging directory. Both are idempotent per job.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import {
  BACKUP_PUSH_JOB,
  BACKUP_SNAPSHOT_JOB,
  getBackupSnapshot,
  type JobRegistration,
  jobHandler,
  recordBackupPush,
  recordBackupSnapshot,
} from "@pangolin/app";
import { type BackupPaths, backupPaths, PARTIAL_SUFFIX, stagingDir } from "../backup/paths.ts";
import { createRestic, type Restic } from "../backup/restic.ts";
import {
  type SnapshotSummary,
  type TakeSnapshotOptions,
  takeSnapshot,
} from "../backup/snapshot.ts";
import type { BackupConfig } from "../config.ts";

export interface BackupJobDeps {
  readonly dataDir: string;
  readonly backup: BackupConfig;
  /** Replaces restic, for tests. */
  readonly restic?: Restic;
  /** Replaces the snapshot worker, for tests. */
  readonly snapshot?: (options: TakeSnapshotOptions) => Promise<SnapshotSummary>;
}

/** The snapshots staged now: one directory each, partial ones (still being written) left out. */
function listStaged(paths: BackupPaths): string[] {
  if (!existsSync(paths.stagingRoot)) return [];
  return readdirSync(paths.stagingRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(PARTIAL_SUFFIX))
    .map((entry) => entry.name);
}

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
    const takenAt = ctx.clock.now().toString({ fractionalSecondDigits: 3 });
    const summary = await snapshot({ dbFile: paths.dbFile, outDir: partial, signal: ctx.signal });
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
      if (!existsSync(dir)) throw new Error(`The staged snapshot ${backupId} is missing`);
      const client = resticFor(repository);
      await client.ensureRepository(ctx.signal);
      // The database snapshot first, then the attachments (AD-21), in one restic snapshot.
      const targets = existsSync(paths.attachmentsDir) ? [dir, paths.attachmentsDir] : [dir];
      const resticSnapshotId = await client.backup(targets, ctx.signal);
      const { removable } = recordBackupPush(ctx, {
        id: backupId,
        resticSnapshotId,
        staged: listStaged(paths),
      });
      for (const done of removable)
        rmSync(stagingDir(paths, done), { recursive: true, force: true });
    } else {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  return [snapshotHandler, pushHandler];
}
