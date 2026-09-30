// The admin commands (story 1.9, AD-16): the fixed set the admin socket accepts, and the stopped
// stack's `reset-user`. Each runs `app` use cases as `systemViewer("cli:<command>")`; no command
// reads or writes a repository itself, and there is no generic query, export or eval command.
import {
  AppError,
  type BackupProgress,
  type BackupStatus,
  backupProgress,
  backupStatus,
  type Clock,
  type DeadJob,
  deadJobs,
  health,
  type IdGenerator,
  type JobCounts,
  jobCounts,
  listLogins,
  type ReadinessOutput,
  type RunnerLiveness,
  readiness,
  reEnrolmentUrl,
  requestBackup,
  resetUser,
  type SystemHealthPort,
  type TokenPort,
  type UnitOfWork,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { z } from "zod";

export const ADMIN_COMMANDS = ["status", "reset-user", "backup", "backup-status"] as const;
export type AdminCommand = (typeof ADMIN_COMMANDS)[number];

/** Everything the commands run with; the server builds it once at startup. */
export interface AdminDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  readonly tokens: TokenPort;
  /** The public URL with no trailing slash; re-enrolment links point at it. */
  readonly publicUrl: string;
  readonly systemHealth: SystemHealthPort;
  /** The number of migrations this build ships. */
  readonly expectedSchemaVersion: number;
  /** The job runner's liveness; undefined while it has not started. */
  readonly runner: () => RunnerLiveness | undefined;
  /** The release (`PANGOLIN_VERSION`), `dev` for local builds. */
  readonly version: string;
  /** Whether a backup repository is configured (`PANGOLIN_BACKUP_REPOSITORY`). */
  readonly backupConfigured: boolean;
}

/** What `reset-user` needs: enough to run on a stopped stack, without the runner. */
export type ResetUserDeps = Pick<AdminDeps, "uow" | "clock" | "newId" | "tokens" | "publicUrl">;

export interface StatusResult {
  readonly version: string;
  readonly schemaVersion: number;
  readonly expectedSchemaVersion: number;
  readonly readiness: ReadinessOutput;
  readonly jobs: JobCounts;
  /** Dead jobs by kind and failure time only, newest first (AD-9). */
  readonly deadJobs: readonly DeadJob[];
  readonly backup: BackupStatus;
}

export type { BackupStatus };

/** What `backup` answers: the manual backup's snapshot job, which `backup-status` follows. */
export interface BackupStarted {
  readonly jobId: string;
}

/** The message `backup` refuses with when no repository is configured. */
export const BACKUPS_NOT_CONFIGURED =
  "Backups are not configured: set PANGOLIN_BACKUP_REPOSITORY (install.sh --backup-server)";

export interface ResetUserOutput {
  readonly displayName: string;
  readonly email: string;
  /** The re-enrolment URL. Printed on the console only; never logged or stored. */
  readonly url: string;
  readonly expiresAt: string;
}

/** A person as a refused `reset-user` lists them: display name and login email only. */
export interface LoginChoice {
  readonly displayName: string;
  readonly email: string;
}

const statusArgs = z.object({}).strict();
const backupArgs = z.object({}).strict();
const backupStatusArgs = z.object({ jobId: z.string().min(1).max(64) }).strict();
const resetUserArgs = z
  .object({
    /** A login email (any case) or a person ID. */
    person: z.string().trim().min(1).max(320).optional(),
  })
  .strict();

function context(deps: Pick<AdminDeps, "uow" | "clock" | "newId">, command: AdminCommand) {
  const ctx: UseCaseContext = {
    viewer: systemViewer(`cli:${command}`),
    clock: deps.clock,
    newId: deps.newId,
    uow: deps.uow,
  };
  return ctx;
}

function parseArgs<S extends z.ZodType>(schema: S, args: unknown): z.output<S> {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) throw new AppError("Validation", "Invalid arguments", parsed.error.issues);
  return parsed.data;
}

/** `status`: version, schema, readiness and job counts. A read: it writes no audit row. */
export function statusCommand(deps: AdminDeps, args: unknown = {}): StatusResult {
  parseArgs(statusArgs, args);
  const ctx = context(deps, "status");
  const { schemaVersion } = health({ systemHealth: deps.systemHealth }, {});
  return {
    version: deps.version,
    schemaVersion,
    expectedSchemaVersion: deps.expectedSchemaVersion,
    readiness: readiness(
      { systemHealth: deps.systemHealth, clock: deps.clock },
      { expectedSchemaVersion: deps.expectedSchemaVersion, runner: deps.runner() ?? null },
    ),
    jobs: jobCounts(ctx),
    deadJobs: deadJobs(ctx),
    // Staleness is a warning: it never makes the status (or its exit code) fail.
    backup: backupStatus(ctx, deps.backupConfigured),
  };
}

/**
 * `backup`: enqueues a manual backup (or joins the one already waiting or running) and answers
 * at once with its snapshot job; the CLI then polls `backup-status`. Nothing long runs on the
 * socket. `Validation` when backups are not configured.
 */
export function backupCommand(deps: AdminDeps, args: unknown = {}): BackupStarted {
  parseArgs(backupArgs, args);
  if (!deps.backupConfigured) throw new AppError("Validation", BACKUPS_NOT_CONFIGURED);
  return { jobId: requestBackup(context(deps, "backup")) };
}

/** `backup-status { jobId }`: how far that backup has got. A read: no audit row. */
export function backupStatusCommand(deps: AdminDeps, args: unknown = {}): BackupProgress {
  const { jobId } = parseArgs(backupStatusArgs, args);
  return backupProgress({ uow: deps.uow }, { jobId });
}

/**
 * `reset-user <email|person-id>`: clears the person's sign-in and issues a 24-hour re-enrolment
 * link (`identity.resetUser`, audited as `cli:reset-user`). With no person, or one that matches
 * nobody, it throws listing the active people with a login (display name and email only).
 */
export function resetUserCommand(deps: ResetUserDeps, args: unknown = {}): ResetUserOutput {
  const { person } = parseArgs(resetUserArgs, args);
  const ctx = context(deps, "reset-user");
  const logins = listLogins(ctx);
  const choices: LoginChoice[] = logins.map(({ displayName, email }) => ({ displayName, email }));
  if (person === undefined) {
    throw new AppError("Validation", "Name the person to reset by login email or person ID", {
      people: choices,
    });
  }
  const wanted = person.toLowerCase();
  const match = logins.find(
    (login) => login.email.toLowerCase() === wanted || login.personId === person,
  );
  if (match === undefined) {
    throw new AppError("NotFound", "No person with a login matches that email or ID", {
      people: choices,
    });
  }
  const { link } = resetUser({ ...ctx, tokens: deps.tokens }, { personId: match.personId });
  return {
    displayName: match.displayName,
    email: match.email,
    url: reEnrolmentUrl(deps.publicUrl, link.token),
    expiresAt: link.expiresAt,
  };
}

export function isAdminCommand(command: string): command is AdminCommand {
  return (ADMIN_COMMANDS as readonly string[]).includes(command);
}

/** Runs one command of the fixed set; any other name is refused as `Validation`. */
export function runAdminCommand(deps: AdminDeps, command: string, args: unknown): unknown {
  if (!isAdminCommand(command)) throw new AppError("Validation", "Unknown command");
  switch (command) {
    case "status":
      return statusCommand(deps, args);
    case "reset-user":
      return resetUserCommand(deps, args);
    case "backup":
      return backupCommand(deps, args);
    case "backup-status":
      return backupStatusCommand(deps, args);
  }
}
