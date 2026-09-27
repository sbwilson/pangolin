// Entry point of the bundled admin CLI (dist/cli.js), which the host's `pangolin` wrapper runs in
// the container (story 1.9, AD-16). It reaches a running server over the admin socket and never
// opens SQLite beside it. Only `reset-user` has a stopped-stack path: under the data-directory
// lock it runs the same command in-process. `status` on a stopped stack opens nothing.
//
// Exit codes: 0 done (status: ready), 1 failed (status: not ready), 2 usage, 3 not running.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newId, systemClock } from "@pangolin/app";
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
  callAdmin,
  type DataDirLock,
  DataDirLocked,
  type LoginChoice,
  type ResetUserOutput,
  resetUserCommand,
  type StatusResult,
} from "./admin/index.ts";
import type { AdminResponse } from "./admin/socket.ts";
import { nodeTokens } from "./auth/secret.ts";
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

function printStatus(io: CliIo, status: StatusResult): void {
  const { readiness, jobs } = status;
  io.out(`Pangolin Money ${status.version}`);
  io.out(`Schema:    ${status.schemaVersion} (this build expects ${status.expectedSchemaVersion})`);
  io.out(
    `Readiness: ${readiness.ok ? "ok" : `not ready (failing: ${readiness.failing.join(", ")})`}`,
  );
  io.out(`Jobs:      ${jobs.pending} pending, ${jobs.running} running, ${jobs.dead} dead`);
  if (status.deadJobs.length > 0) {
    io.out("Dead jobs (newest first):");
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
  if (response === undefined) {
    io.out("Pangolin is not running");
    return EXIT_NOT_RUNNING;
  }
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
  if (command !== "status" && command !== "reset-user") {
    return usage(`unknown command ${JSON.stringify(command)}`);
  }
  if (command === "status" && rest.length > 0) return usage("status takes no arguments");
  if (command === "reset-user" && rest.length > 1) return usage("reset-user takes one person");

  let config: Config;
  try {
    config = loadConfig(options.env);
  } catch (error) {
    io.err(`pangolin: bad configuration: ${error instanceof Error ? error.message : error}`);
    return EXIT_FAILED;
  }
  try {
    return command === "status"
      ? await status(config, io)
      : await resetUserCli(config, options, rest[0]);
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
