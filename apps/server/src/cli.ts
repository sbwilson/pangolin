// Entry point of the bundled admin CLI (dist/cli.js), which the host's `pangolin` wrapper runs in
// the container (story 1.9, AD-16). It reaches a running server over the admin socket and never
// opens SQLite beside it. `reset-user` also has a stopped-stack path: under the data-directory
// lock it runs the same command in-process. `restore` runs only on a stopped stack, under that
// lock (story 1.10). `status` and `backup` on a stopped stack open nothing but the lock file, to
// tell "stopped" from "running without a reachable socket".
//
// Exit codes: 0 done (status: ready), 1 failed (status: not ready), 2 usage, 3 not running.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKUP_TIME,
  type BackupProgress,
  type BackupVerification,
  newId,
  systemClock,
} from "@pangolin/app";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  openDatabase,
  schemaVersion,
} from "@pangolin/db";
import {
  AdminUnreachable,
  acquireDataDirLock,
  BACKUPS_NOT_CONFIGURED,
  type BackupStarted,
  callAdmin,
  type DataDirLock,
  DataDirLocked,
  type LoginChoice,
  type ResetUserOutput,
  resetUserCommand,
  restoreStopped,
  type StatusResult,
} from "./admin/index.ts";
import type { AdminResponse } from "./admin/socket.ts";
import { nodeTokens } from "./auth/secret.ts";
import { checkRepositoryReachable } from "./backup/reachable.ts";
import type { Restic } from "./backup/restic.ts";
import { type Config, loadConfig } from "./config.ts";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_RUNNING = 3;

export const USAGE = `Usage: pangolin <command>

Commands:
  status                        version, schema, readiness and job state of the running server;
                                exits 0 when ready, 1 when not, 3 when the server is not running
  reset-user <email|person-id>  clear a person's sign-in (passkeys, authenticator, sessions,
                                recovery codes and password) and print a 24-hour re-enrolment
                                link; with no person, lists the people with a login
  backup                        back up now (a snapshot pushed with restic) and print the
                                snapshot ID; joins a manual backup already running
  restore [snapshot|latest]     on a stopped stack: fetch the snapshot (default latest), verify
                                it, swap it in and cancel pending jobs with external effects
                                (the host's pangolin stops and starts the stack around it)
  --help                        show this help`;

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The migrations this build ships (dist/migrations next to the bundle). */
  readonly migrationsDir: string;
  readonly io: CliIo;
  /** How often `backup` polls the server, in milliseconds. Defaults to 1 s. */
  readonly pollMs?: number;
  /** How long `backup` waits for the backup to finish, in milliseconds. Defaults to 1 hour. */
  readonly backupWaitMs?: number;
  /** Replaces restic for `restore`, for tests. */
  readonly restic?: Restic;
  /** Replaces the backup server reachability check `backup` makes first, for tests. */
  readonly checkReachable?: (repository: string) => Promise<void>;
}

function printError(io: CliIo, error: { code: string; message: string; details?: unknown }) {
  io.err(`pangolin: ${error.message}`);
  const people = (error.details as { people?: unknown } | undefined)?.people;
  if (Array.isArray(people)) {
    if (people.length === 0) {
      io.err("Nobody has a login yet.");
    } else {
      io.err("People with a login:");
      for (const person of people as LoginChoice[]) {
        io.err(`  ${person.displayName}  ${person.email}`);
      }
    }
  }
}

function verificationLine(result: BackupVerification | null, none: string): string {
  if (result === null) return none;
  return `${result.ok ? "passed" : "FAILED"} at ${result.at}: ${result.summary}`;
}

function printStatus(io: CliIo, status: StatusResult): void {
  const { readiness, jobs } = status;
  io.out(`Pangolin Money ${status.version}`);
  io.out(`Schema:    ${status.schemaVersion} (this build expects ${status.expectedSchemaVersion})`);
  io.out(
    `Readiness: ${readiness.ok ? "ok" : `not ready (failing: ${readiness.failing.join(", ")})`}`,
  );
  io.out(`Jobs:      ${jobs.pending} pending, ${jobs.running} running, ${jobs.dead} dead`);
  const { backup } = status;
  if (!backup.configured) {
    io.out("Backups:   not configured (PANGOLIN_BACKUP_REPOSITORY is empty)");
  } else if (backup.last === null) {
    const at = `${String(BACKUP_TIME.hour).padStart(2, "0")}:${String(BACKUP_TIME.minute).padStart(2, "0")}`;
    io.out(`Backups:   none yet (nightly at ${at}, household time)`);
  } else {
    io.out(`Backups:   last at ${backup.last.pushedAt}, snapshot ${backup.last.snapshotId}`);
  }
  if (backup.configured) {
    if (backup.stale) {
      io.out("Warning:   no good backup in the last 48 hours; check the backup server");
    }
    io.out(`Check:     ${verificationLine(backup.check, "no check yet (weekly, Sundays 03:30)")}`);
    io.out(
      `Drill:     ${verificationLine(backup.drill, "no restore drill yet (monthly, the 1st at 04:00)")}`,
    );
  }
  if (status.deadJobs.length > 0) {
    const shown = status.deadJobs.length;
    io.out(
      jobs.dead > shown
        ? `Dead jobs (newest ${shown} of ${jobs.dead}):`
        : "Dead jobs (newest first):",
    );
    for (const job of status.deadJobs) io.out(`  ${job.failedAt}  ${job.kind}`);
  }
}

function printReset(io: CliIo, reset: ResetUserOutput): void {
  io.out(`Reset ${reset.displayName} <${reset.email}>: their passkeys, authenticator, sessions,`);
  io.out("recovery codes and password are cleared, and they have a notice in the app.");
  io.out(`Give them this one-time link; it works until ${reset.expiresAt}:`);
  io.out(`  ${reset.url}`);
}

/** Runs a command on the running server; undefined when no server answers on the socket. */
async function viaSocket(
  config: Config,
  command: string,
  args: Record<string, unknown>,
): Promise<AdminResponse | undefined> {
  if (config.adminSocket === null) return undefined;
  try {
    return await callAdmin(config.adminSocket, command, args);
  } catch (error) {
    if (error instanceof AdminUnreachable) return undefined;
    throw error;
  }
}

async function status(config: Config, io: CliIo): Promise<number> {
  if (config.adminSocket === null) {
    io.err("pangolin: the admin socket is disabled (PANGOLIN_ADMIN_SOCKET is empty)");
    return EXIT_FAILED;
  }
  const response = await viaSocket(config, "status", {});
  // No answer, but a server may still hold the data directory (starting up, or its socket
  // failed). Probe only the lock file, never the database.
  if (response === undefined) return notAnswering(config, io);
  if (!response.ok) {
    printError(io, response.error);
    return EXIT_FAILED;
  }
  const result = response.result as StatusResult;
  printStatus(io, result);
  return result.readiness.ok ? EXIT_OK : EXIT_FAILED;
}

/**
 * `reset-user` on a stopped stack: under the data-directory lock, on a database this build has
 * fully migrated, runs the same command in-process. Refuses, opening nothing, while the lock is
 * held (a server is running whose socket this process cannot reach).
 */
function resetStopped(
  config: Config,
  options: CliOptions,
  args: Record<string, unknown>,
): ResetUserOutput | number {
  const { io } = options;
  const dbPath = join(config.dataDir, "pangolin.sqlite");
  if (!existsSync(dbPath)) {
    io.err(`pangolin: there is no database at ${dbPath}: the server has never run here`);
    return EXIT_FAILED;
  }
  let lock: DataDirLock;
  try {
    lock = acquireDataDirLock(config.dataDir);
  } catch (error) {
    if (!(error instanceof DataDirLocked)) throw error;
    io.err("pangolin: the server is running but its admin socket is unreachable");
    return EXIT_FAILED;
  }
  let db: Db | undefined;
  try {
    db = openDatabase(dbPath);
    const current = schemaVersion(db);
    const expected = loadMigrations(options.migrationsDir).length;
    if (current < expected) {
      io.err(
        `pangolin: the database is at schema ${current} and this build needs ${expected}: start the server once to migrate`,
      );
      return EXIT_FAILED;
    }
    if (current > expected) {
      io.err(
        `pangolin: the database is at schema ${current}, newer than this build (${expected}): use the newer release`,
      );
      return EXIT_FAILED;
    }
    const uow = createUnitOfWork(db);
    const timezone = uow.read((repos) => repos.householdSettings.get().timezone);
    return resetUserCommand(
      {
        uow,
        clock: systemClock(timezone),
        newId,
        tokens: nodeTokens,
        publicUrl: config.auth.publicUrl,
      },
      args,
    );
  } finally {
    try {
      db?.close();
    } finally {
      lock.release();
    }
  }
}

async function resetUserCli(
  config: Config,
  options: CliOptions,
  person: string | undefined,
): Promise<number> {
  const { io } = options;
  const args = person === undefined ? {} : { person };
  const response = await viaSocket(config, "reset-user", args);
  let result: ResetUserOutput;
  if (response === undefined) {
    let stopped: ResetUserOutput | number;
    try {
      stopped = resetStopped(config, options, args);
    } catch (error) {
      const body = error as { code?: unknown; message?: unknown; details?: unknown };
      printError(io, {
        code: String(body.code ?? "Internal"),
        message: error instanceof Error ? error.message : String(error),
        details: body.details,
      });
      return EXIT_FAILED;
    }
    if (typeof stopped === "number") return stopped;
    result = stopped;
  } else if (!response.ok) {
    printError(io, response.error);
    return EXIT_FAILED;
  } else {
    result = response.result as ResetUserOutput;
  }
  printReset(io, result);
  return EXIT_OK;
}

/** Where no server answered: tells "stopped" from "running with an unreachable socket". */
function notAnswering(config: Config, io: CliIo): number {
  if (existsSync(config.dataDir)) {
    try {
      acquireDataDirLock(config.dataDir).release();
    } catch (error) {
      if (!(error instanceof DataDirLocked)) throw error;
      io.err("pangolin: the server is running but its admin socket is unreachable");
      return EXIT_FAILED;
    }
  }
  io.out("Pangolin is not running");
  return EXIT_NOT_RUNNING;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function progressLine(progress: BackupProgress & { state: "running" }, seconds: number): string {
  const step = progress.step === "snapshot" ? "Taking the snapshot" : "Pushing it with restic";
  return `${step}${progress.retrying ? " (an attempt failed; it will retry)" : ""} … ${seconds}s`;
}

/**
 * `backup`: asks the running server for a manual backup, which its job runner does; this only
 * polls until the push is done (nothing long runs on the socket). Exit 0 with the snapshot ID,
 * 1 when not configured or failed, 3 when the server is not running.
 */
async function backupCli(config: Config, options: CliOptions): Promise<number> {
  const { io } = options;
  if (config.backup.repository === null) {
    io.err(`pangolin: ${BACKUPS_NOT_CONFIGURED}`);
    return EXIT_FAILED;
  }
  if (config.adminSocket === null) {
    io.err("pangolin: the admin socket is disabled (PANGOLIN_ADMIN_SOCKET is empty)");
    return EXIT_FAILED;
  }
  try {
    await (options.checkReachable ?? checkRepositoryReachable)(config.backup.repository);
  } catch (error) {
    io.err(`pangolin: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }
  const started = await viaSocket(config, "backup", {});
  if (started === undefined) return notAnswering(config, io);
  if (!started.ok) {
    printError(io, started.error);
    return EXIT_FAILED;
  }
  const { jobId } = started.result as BackupStarted;
  io.out(`Backup ${jobId} started`);
  let shown = "";
  let shownAt = 0;
  const startedAt = Date.now();
  const deadline = Date.now() + (options.backupWaitMs ?? 60 * 60_000);
  for (;;) {
    if (Date.now() > deadline) {
      io.err("pangolin: the backup is still running; check `pangolin status`");
      return EXIT_FAILED;
    }
    const response = await viaSocket(config, "backup-status", { jobId });
    if (response === undefined) {
      io.err("pangolin: the server stopped; the backup resumes when it starts again");
      return EXIT_NOT_RUNNING;
    }
    if (!response.ok) {
      printError(io, response.error);
      return EXIT_FAILED;
    }
    const progress = response.result as BackupProgress;
    if (progress.state === "done") {
      io.out(`Backup done at ${progress.pushedAt}: snapshot ${progress.snapshotId}`);
      return EXIT_OK;
    }
    if (progress.state === "failed") {
      io.err(
        `pangolin: the backup failed (${progress.step === "snapshot" ? "taking the snapshot" : "pushing it"}); pangolin status lists the dead job and the server log says why`,
      );
      return EXIT_FAILED;
    }
    // The step and retry state as the change; the seconds tick every 5 s so it is seen working.
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const stage = progressLine(progress, 0);
    if (stage !== shown || seconds - shownAt >= 5) {
      io.out(progressLine(progress, seconds));
      shownAt = seconds;
    }
    shown = stage;
    await sleep(options.pollMs ?? 1000);
  }
}

const VERIFY_CHECKS = new Set(["integrity", "manifest", "schema"]);

/** `restore [snapshot|latest]` on a stopped stack. Exit 0 when swapped in, 1 when not. */
async function restoreCli(config: Config, options: CliOptions, ref: string): Promise<number> {
  const { io } = options;
  const result = await restoreStopped(ref, {
    config,
    migrationsDir: options.migrationsDir,
    out: io.out,
    ...(options.restic === undefined ? {} : { restic: options.restic }),
  });
  if (!result.ok) {
    if (VERIFY_CHECKS.has(result.failed)) {
      io.err(`pangolin: the ${result.failed} check failed: ${result.message}`);
      io.err("Nothing was swapped in; the database is unchanged.");
    } else {
      io.err(`pangolin: ${result.message}`);
    }
    return EXIT_FAILED;
  }
  io.out(`Schema:    version ${result.schemaVersion}`);
  io.out(
    `Swapped in snapshot ${result.snapshotId}; the replaced files are in ${result.preRestoreDir}`,
  );
  io.out(
    `Cancelled ${result.cancelled} pending job${result.cancelled === 1 ? "" : "s"} with external effects`,
  );
  return EXIT_OK;
}

const SNAPSHOT_REF = /^(?:latest|[0-9a-f]{4,64})$/;

/** Runs the CLI with `argv` (the arguments after the script) and returns its exit code. */
export async function runCli(argv: readonly string[], options: CliOptions): Promise<number> {
  const { io } = options;
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    io.out(USAGE);
    return EXIT_OK;
  }
  const usage = (message: string) => {
    io.err(`pangolin: ${message}`);
    io.err(USAGE);
    return EXIT_USAGE;
  };
  if (command === undefined) return usage("name a command");
  if (!["status", "reset-user", "backup", "restore"].includes(command)) {
    return usage(`unknown command ${JSON.stringify(command)}`);
  }
  if (command === "status" && rest.length > 0) return usage("status takes no arguments");
  if (command === "reset-user" && rest.length > 1) return usage("reset-user takes one person");
  if (command === "backup" && rest.length > 0) return usage("backup takes no arguments");
  if (command === "restore" && rest.length > 1) return usage("restore takes one snapshot");
  const ref = rest[0] ?? "latest";
  if (command === "restore" && !SNAPSHOT_REF.test(ref)) {
    return usage("name a snapshot by its ID (hex) or latest");
  }

  let config: Config;
  try {
    config = loadConfig(options.env);
  } catch (error) {
    io.err(`pangolin: bad configuration: ${error instanceof Error ? error.message : error}`);
    return EXIT_FAILED;
  }
  try {
    switch (command) {
      case "status":
        return await status(config, io);
      case "backup":
        return await backupCli(config, options);
      case "restore":
        return await restoreCli(config, options, ref);
      default:
        return await resetUserCli(config, options, rest[0]);
    }
  } catch (error) {
    io.err(`pangolin: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }
}

const here = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await runCli(process.argv.slice(2), {
    env: process.env,
    migrationsDir: join(here, "migrations"),
    io: {
      out: (text) => process.stdout.write(`${text}\n`),
      err: (text) => process.stderr.write(`${text}\n`),
    },
  });
  process.exitCode = code;
}
