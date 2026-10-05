// Test support: the pieces of a backup and restore-drill run that more than one test file needs
// (the backup job tests and the privacy suite's failed-drill world). A rig wraps a live database
// file under `dataDir`, a stub restic repository under `stubDir` and the job runner over them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BACKUP_CHECK_JOB,
  type BACKUP_DRILL_JOB,
  BACKUP_PUSH_JOB,
  backupProgress,
  type Clock,
  enqueueJob,
  type IdGenerator,
  requestBackup,
  type UnitOfWork,
  type Viewer,
} from "@pangolin/app";
import { packageMigrationsDir } from "@pangolin/db";
import { DEFAULT_BACKUP_CONFIG } from "../config.ts";
import { createJobs } from "../jobs/index.ts";
import { createRunner, type Runner } from "../jobs/runner.ts";
import { type StubRestic, stubRestic } from "./restic.ts";

export interface DrillRigDeps {
  /** The directory holding the live `pangolin.sqlite` (the backup jobs read it by path). */
  readonly dataDir: string;
  /** Where the stub restic and its repository live. */
  readonly stubDir: string;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  /**
   * The system viewer the CLI's backup request runs as (`systemViewer("cli:backup")`). The caller
   * builds it: only the jobs, the admin entry and test files may import the factory (AD-6).
   */
  readonly viewer: Viewer;
}

export interface DrillRig {
  readonly stub: StubRestic;
  /** A job runner; `configured` false gives it no repository, `pushTimeoutMs` shortens the push. */
  readonly runner: (configured?: boolean, pushTimeoutMs?: number) => Runner;
  /** The context the CLI's backup request runs under. */
  readonly cli: () => {
    viewer: Viewer;
    clock: Clock;
    newId: IdGenerator;
    uow: UnitOfWork;
  };
  /** A completed backup in the stub repository; returns its restic snapshot ID. */
  readonly backUp: (runner: Runner) => Promise<string>;
  /** Enqueues one check or drill and gives the runner a turn. */
  readonly run: (
    runner: Runner,
    kind: typeof BACKUP_CHECK_JOB | typeof BACKUP_DRILL_JOB,
  ) => Promise<void>;
  /** The snapshot's database file inside the stub repository. */
  readonly storedDatabase: (snapshotId: string) => string;
}

export function createDrillRig(deps: DrillRigDeps): DrillRig {
  const { dataDir, uow, clock, newId, viewer } = deps;
  const stub = stubRestic(deps.stubDir);
  const cli = () => ({ viewer, clock, newId, uow });

  const runner = (configured = true, pushTimeoutMs?: number): Runner => {
    const jobs = createJobs({
      timezone: "Australia/Sydney",
      dataDir,
      backup: configured ? stub.config : DEFAULT_BACKUP_CONFIG,
      migrationsDir: packageMigrationsDir,
    });
    // A copy of the push kind with a short timeout, for the abort test.
    const kinds = jobs.kinds.map((registration) =>
      pushTimeoutMs !== undefined && registration.kind.kind === BACKUP_PUSH_JOB.kind
        ? { ...registration, kind: { ...registration.kind, timeoutMs: pushTimeoutMs } }
        : registration,
    );
    return createRunner({
      uow,
      clock,
      newId,
      kinds,
      schedules: jobs.schedules,
      leaseMs: 60_000,
      log: () => {},
    });
  };

  const backUp = async (r: Runner): Promise<string> => {
    const jobId = requestBackup(cli());
    await r.tick();
    await r.tick();
    const progress = backupProgress({ uow }, { jobId });
    if (progress.state !== "done") throw new Error(`backup ${progress.state}`);
    return progress.snapshotId;
  };

  const run: DrillRig["run"] = async (r, kind) => {
    uow.transaction((tx) => enqueueJob(tx, { clock, newId }, kind, {}));
    await r.tick();
  };

  const storedDatabase = (snapshotId: string): string => {
    const meta = JSON.parse(
      readFileSync(join(stub.repoDir, "snapshots", snapshotId, "meta.json"), "utf8"),
    ) as { paths: string[] };
    return join(
      stub.repoDir,
      "snapshots",
      snapshotId,
      "tree",
      meta.paths[0] as string,
      "pangolin.sqlite",
    );
  };

  return { stub, runner, cli, backUp, run, storedDatabase };
}
