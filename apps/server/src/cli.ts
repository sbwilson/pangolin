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
import { createInterface } from "node:readline";
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
  type ConfirmedRecoveryBundle,
  type CredentialChoice,
  callAdmin,
  type DataDirLock,
  DataDirLocked,
  type LoginChoice,
  type ResetUserOutput,
  resetUserCommand,
  restoreStopped,
  type SeedResult,
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
  confirm-bundle                confirm the recovery bundle install.sh wrote (its id is in
                                .env as PANGOLIN_RECOVERY_BUNDLE_ID) is stored safely offline;
                                first check that id matches the "Bundle id:" line of the
                                bundle you stored. Ends status's warning until a new bundle is
                                written; needs the server running (exits 3 when it is not)
  seed                          load the demo seed's accounts and transactions onto the first two
                                signed-up people (shared and private accounts), for dev installs
                                and the end-to-end run; needs both partners signed up and an
                                empty ledger, and the server running (exits 3 when it is not)
  restore [snapshot|latest]     on a stopped stack: fetch the snapshot (default latest), verify
    [--restore-credentials |    it, ask whether to restore the snapshot's sign-in details (sessions,
     --keep-credentials]        passkeys, authenticator, recovery codes) or keep the current ones
                                (default: keep), swap it in and cancel pending jobs with external
                                effects; a flag answers without the question, and with no
                                terminal and no flag it refuses (the host's pangolin stops and
                                starts the stack around it)
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
  /** Whether a person can answer a question on the terminal. Defaults to `stdin.isTTY`. */
  readonly interactive?: boolean;
  /** Asks a question and returns the line typed; undefined when the input closed. For tests. */
  readonly ask?: (question: string) => Promise<string | undefined>;
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
  if (readiness.warnings?.includes("recovery-bundle-unconfirmed")) {
    io.out(
      "Warning:   recovery bundle not confirmed stored safely (run sudo pangolin confirm-bundle)",
    );
  }
  io.out(`Jobs:      ${jobs.pending} pending, ${jobs.running} running, ${jobs.dead} dead`);
  if (status.pendingJobs.length > 0) {
    const shown = status.pendingJobs.length;
    io.out(
      jobs.pending > shown
        ? `Pending jobs (next ${shown} of ${jobs.pending}):`
        : "Pending jobs (soonest first):",
    );
    for (const job of status.pendingJobs) io.out(`  ${job.runAt}  ${job.kind}`);
  }
  if (status.runningJobs.length > 0) {
    const shown = status.runningJobs.length;
    io.out(jobs.running > shown ? `Running jobs (${shown} of ${jobs.running}):` : "Running jobs:");
    for (const job of status.runningJobs) {
      io.out(`  ${job.leaseExpiresAt}  ${job.kind}  (lease until)`);
    }
  }
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

/** `confirm-bundle`: over the admin socket only. Exit 0 when confirmed (now or before). */
async function confirmBundleCli(config: Config, io: CliIo): Promise<number> {
  if (config.adminSocket === null) {
    io.err("pangolin: the admin socket is disabled (PANGOLIN_ADMIN_SOCKET is empty)");
    return EXIT_FAILED;
  }
  const response = await viaSocket(config, "confirm-bundle", {});
  if (response === undefined) return notAnswering(config, io);
  if (!response.ok) {
    printError(io, response.error);
    return EXIT_FAILED;
  }
  const result = response.result as ConfirmedRecoveryBundle;
  io.out(
    result.alreadyConfirmed
      ? `Recovery bundle ${result.bundleId} was already confirmed stored safely (at ${result.confirmedAt})`
      : `Recovery bundle ${result.bundleId} confirmed stored safely`,
  );
  return EXIT_OK;
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

/** `seed`: over the admin socket only. */
async function seedCli(config: Config, io: CliIo): Promise<number> {
  if (config.adminSocket === null) {
    io.err("pangolin: the admin socket is disabled (PANGOLIN_ADMIN_SOCKET is empty)");
    return EXIT_FAILED;
  }
  const response = await viaSocket(config, "seed", {});
  if (response === undefined) return notAnswering(config, io);
  if (!response.ok) {
    printError(io, response.error);
    return EXIT_FAILED;
  }
  const result = response.result as SeedResult;
  io.out(`Seeded ${result.accounts} accounts (${result.events} events) onto the signed-up people`);
  return EXIT_OK;
}

const VERIFY_CHECKS = new Set(["integrity", "manifest", "schema"]);

/** One line from the terminal; undefined when the input ends or Ctrl-C closes it. */
function askOnTerminal(question: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.on("close", () => {
      if (!answered) resolve(undefined);
    });
    rl.on("SIGINT", () => rl.close());
    rl.question(question, (line) => {
      answered = true;
      rl.close();
      resolve(line);
    });
  });
}

const CREDENTIAL_QUESTION = `The snapshot has its own sign-in details (sessions, passkeys, authenticator, recovery
codes, re-enrolment links); the current database has others, which may include a reset since.
  [k] keep the current ones (the snapshot's are dropped; anyone only in the snapshot must re-enrol)
  [r] restore the snapshot's
Keep or restore? [K/r] `;

/** Asks until it has an answer; three bad answers or no answer fail with nothing swapped in. */
async function askCredentials(
  ask: (question: string) => Promise<string | undefined>,
  io: CliIo,
): Promise<CredentialChoice> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const line = await ask(attempt === 0 ? CREDENTIAL_QUESTION : "Keep or restore? [K/r] ");
    if (line === undefined) throw new Error("no answer to the credentials question");
    const answer = line.trim().toLowerCase();
    if (answer === "" || answer === "k" || answer === "keep") return "keep";
    if (answer === "r" || answer === "restore") return "restore";
    io.err(`pangolin: ${JSON.stringify(line.trim())} is not k or r`);
  }
  throw new Error("no valid answer to the credentials question");
}

/** `restore [snapshot|latest]` on a stopped stack. Exit 0 when swapped in, 1 when not. */
async function restoreCli(
  config: Config,
  options: CliOptions,
  ref: string,
  flag: CredentialChoice | undefined,
): Promise<number> {
  const { io } = options;
  const result = await restoreStopped(ref, {
    config,
    credentials:
      flag !== undefined
        ? async () => flag
        : () => askCredentials(options.ask ?? askOnTerminal, io),
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
  const { credentials } = result;
  if (credentials.choice === "restore") {
    io.out("Credentials: the snapshot's sessions, passkeys, authenticator and recovery codes");
  } else if (!credentials.carried) {
    io.out("Credentials: the snapshot's (there was no current database to keep them from)");
  } else {
    io.out(
      `Credentials: the current ones kept for ${credentials.keptLogins} login${credentials.keptLogins === 1 ? "" : "s"}; cleared for ${credentials.clearedLogins} only in the snapshot`,
    );
  }
  io.out("A review item records that the data was rolled back to the snapshot");
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
  if (!["status", "reset-user", "backup", "restore", "confirm-bundle", "seed"].includes(command)) {
    return usage(`unknown command ${JSON.stringify(command)}`);
  }
  if (command === "status" && rest.length > 0) return usage("status takes no arguments");
  if (command === "reset-user" && rest.length > 1) return usage("reset-user takes one person");
  if (command === "backup" && rest.length > 0) return usage("backup takes no arguments");
  if (command === "confirm-bundle" && rest.length > 0) {
    return usage("confirm-bundle takes no arguments");
  }
  if (command === "seed" && rest.length > 0) return usage("seed takes no arguments");
  const flags = rest.filter((arg) => arg.startsWith("--"));
  const operands = rest.filter((arg) => !arg.startsWith("--"));
  if (command === "restore") {
    const known = ["--restore-credentials", "--keep-credentials"];
    const unknown = flags.find((flag) => !known.includes(flag));
    if (unknown !== undefined) return usage(`unknown option ${JSON.stringify(unknown)}`);
    if (flags.includes(known[0] as string) && flags.includes(known[1] as string)) {
      return usage("choose one of --restore-credentials and --keep-credentials");
    }
    if (flags.length > 1 && new Set(flags).size === 1) return usage(`repeated option ${flags[0]}`);
    if (operands.length > 1) return usage("restore takes one snapshot");
  }
  const ref = operands[0] ?? "latest";
  if (command === "restore" && !SNAPSHOT_REF.test(ref)) {
    return usage("name a snapshot by its ID (hex) or latest");
  }
  const flag: CredentialChoice | undefined = flags.includes("--restore-credentials")
    ? "restore"
    : flags.includes("--keep-credentials")
      ? "keep"
      : undefined;
  if (
    command === "restore" &&
    flag === undefined &&
    !(options.interactive ?? process.stdin.isTTY)
  ) {
    return usage(
      "restore asks whether to restore the snapshot's credentials or keep the current ones, and there is no terminal to ask on: pass --restore-credentials or --keep-credentials",
    );
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
        return await restoreCli(config, options, ref, flag);
      case "confirm-bundle":
        return await confirmBundleCli(config, io);
      case "seed":
        return await seedCli(config, io);
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
