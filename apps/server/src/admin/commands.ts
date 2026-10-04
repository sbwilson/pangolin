// The admin commands (story 1.9, AD-16): the fixed set the admin socket accepts, and the stopped
// stack's `reset-user`. Each runs `app` use cases as `systemViewer("cli:<command>")`; no command
// reads or writes a repository itself, and there is no generic query, export or eval command.
import { readFileSync } from "node:fs";
import {
  AppError,
  type BackupProgress,
  type BackupStatus,
  backupProgress,
  backupStatus,
  type Clock,
  type ConfirmedRecoveryBundle,
  confirmRecoveryBundle,
  type DeadJob,
  deadJobs,
  health,
  type IdGenerator,
  type JobCounts,
  jobCounts,
  listLogins,
  type PendingJob,
  pendingJobs,
  type ReadinessOutput,
  type RunnerLiveness,
  type RunningJob,
  readiness,
  recoveryBundleConfirmed,
  reEnrolmentUrl,
  requestBackup,
  resetUser,
  runningJobs,
  type SystemHealthPort,
  type TokenPort,
  type UnitOfWork,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { z } from "zod";
import { linkSeed } from "./seed.ts";

export const ADMIN_COMMANDS = [
  "status",
  "reset-user",
  "backup",
  "backup-status",
  "confirm-bundle",
  "seed",
] as const;
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
  /**
   * The current recovery bundle's id (`PANGOLIN_RECOVERY_BUNDLE_ID`); undefined when unset, when
   * there is nothing to confirm and `confirm-bundle` refuses.
   */
  readonly bundleId?: string;
  /** The seed file the `seed` command reads (`dist/demo-seed.json`); undefined: it refuses. */
  readonly seedFile?: string;
  /**
   * Whether the `seed` command may run (`PANGOLIN_ENABLE_SEED`). It is a dev and e2e tool, off
   * unless the stack opts in; undefined or false: it refuses.
   */
  readonly seedEnabled?: boolean;
}

/** What `reset-user` needs: enough to run on a stopped stack, without the runner. */
export type ResetUserDeps = Pick<AdminDeps, "uow" | "clock" | "newId" | "tokens" | "publicUrl">;

export interface StatusResult {
  readonly version: string;
  readonly schemaVersion: number;
  readonly expectedSchemaVersion: number;
  /**
   * Readiness, with its warnings: `recovery-bundle-unconfirmed` while the current recovery
   * bundle's safe storage is not confirmed. A warning never makes it (or the exit code) fail.
   */
  readonly readiness: ReadinessOutput;
  readonly jobs: JobCounts;
  /** Dead jobs by kind and failure time only, newest first (AD-9). */
  readonly deadJobs: readonly DeadJob[];
  /** Pending jobs by kind and due time only, soonest first, at most 10 (AD-9). */
  readonly pendingJobs: readonly PendingJob[];
  /** Running jobs by kind and lease end only, soonest first, at most 10 (AD-9). */
  readonly runningJobs: readonly RunningJob[];
  readonly backup: BackupStatus;
}

export type { BackupStatus, ConfirmedRecoveryBundle };

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
const confirmBundleArgs = z.object({}).strict();
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
      {
        expectedSchemaVersion: deps.expectedSchemaVersion,
        runner: deps.runner() ?? null,
        bundleUnconfirmed: !recoveryBundleConfirmed(deps.uow, deps.bundleId),
      },
    ),
    jobs: jobCounts(ctx),
    deadJobs: deadJobs(ctx),
    pendingJobs: pendingJobs(ctx),
    runningJobs: runningJobs(ctx),
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
 * `confirm-bundle`: records that the current recovery bundle (`PANGOLIN_RECOVERY_BUNDLE_ID`) is
 * stored safely (`system.confirmRecoveryBundle`, audited as `cli:confirm-bundle`), which ends the
 * warning. Confirming it again writes nothing. `Validation` when there is no bundle id.
 */
export function confirmBundleCommand(deps: AdminDeps, args: unknown = {}): ConfirmedRecoveryBundle {
  parseArgs(confirmBundleArgs, args);
  return confirmRecoveryBundle(context(deps, "confirm-bundle"), {
    ...(deps.bundleId === undefined ? {} : { bundleId: deps.bundleId }),
  });
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

/** What `seed` answers: how much it added. */
export interface SeedResult {
  readonly accounts: number;
  readonly transactions: number;
  readonly events: number;
}

/** The message `seed` refuses with unless the stack enables it. */
export const SEED_DISABLED =
  "The seed command is disabled: it is a dev and e2e tool; set PANGOLIN_ENABLE_SEED=true to allow it";

const seedArgs = z.object({}).strict();

/**
 * `seed`: loads the seed's institutions, accounts, classification, transactions and balances
 * onto the signed-up people: the seed's `person-a` and `person-b` become the first two logins,
 * by sign-up order. For the e2e run and dev installs, so it refuses unless `PANGOLIN_ENABLE_SEED`
 * is set; it needs both partners signed up and an empty ledger (`Conflict` otherwise, writing
 * nothing), and takes no path (it reads the build's `demo-seed.json`).
 */
export function seedCommand(deps: AdminDeps, args: unknown = {}): SeedResult {
  parseArgs(seedArgs, args);
  if (deps.seedEnabled !== true) throw new AppError("Validation", SEED_DISABLED);
  if (deps.seedFile === undefined) throw new AppError("Validation", "There is no seed file");
  let seedJson: string;
  try {
    seedJson = readFileSync(deps.seedFile, "utf8");
  } catch {
    throw new AppError("Validation", "The seed file could not be read");
  }
  const { accounts, transactions, events } = linkSeed(deps.uow, deps, seedJson);
  return { accounts, transactions, events };
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
    case "confirm-bundle":
      return confirmBundleCommand(deps, args);
    case "seed":
      return seedCommand(deps, args);
  }
}
