// The jobs entry (AD-8): the runner and the production registry of kinds and schedules.
import {
  BACKUP_PUSH_JOB,
  BACKUP_SNAPSHOT_JOB,
  type JobKind,
  type JobRegistration,
  nightlyBackupSchedule,
  type Schedule,
} from "@pangolin/app";
import { type BackupJobDeps, backupJobs } from "./backup.ts";

export { type BackupJobDeps, backupJobs } from "./backup.ts";
export {
  createRunner,
  DEFAULT_CONCURRENCY,
  DEFAULT_LEASE_MS,
  JobTimeout,
  type LaneConcurrency,
  type Runner,
  type RunnerLog,
  type RunnerOptions,
  RunnerStopped,
} from "./runner.ts";

/** Every job kind this build defines. Later stories add theirs here and in `createJobs`. */
export const JOB_KINDS: readonly JobKind[] = [BACKUP_SNAPSHOT_JOB, BACKUP_PUSH_JOB];

/** The kinds that reach outside the process; a restore cancels their pending jobs (AD-16). */
export const EXTERNAL_EFFECT_KINDS: readonly string[] = JOB_KINDS.filter(
  (kind) => kind.externalEffects,
).map((kind) => kind.kind);

export interface JobsDeps extends BackupJobDeps {
  /** The household time zone, for schedules at a time of day. */
  readonly timezone: string;
}

export interface Jobs {
  readonly kinds: readonly JobRegistration[];
  readonly schedules: readonly Schedule[];
}

/**
 * The production registry: every kind with its handler, and the schedules. The nightly backup
 * is scheduled only when a backup repository is configured; its kinds are always registered, so
 * jobs left from a configured past still run (and do nothing).
 */
export function createJobs(deps: JobsDeps): Jobs {
  return {
    kinds: [...backupJobs(deps)],
    schedules: deps.backup.repository === null ? [] : [nightlyBackupSchedule(deps.timezone)],
  };
}
