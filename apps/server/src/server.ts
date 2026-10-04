import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import {
  type Clock,
  type JobRegistration,
  newId,
  type Schedule,
  systemClock,
  type UnitOfWork,
} from "@pangolin/app";
import {
  createSystemHealthRepo,
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
} from "@pangolin/db";
import {
  ADMIN_COMMANDS,
  type AdminLog,
  type AdminSocket,
  acquireDataDirLock,
  type DataDirLock,
  listenAdminSocket,
  raiseUpgradeFailedIfMarked,
  runAdminCommand,
  seedClassifyDefaults,
  writeFirstSetupLink,
} from "./admin/index.ts";
import { createAuth } from "./auth/auth.ts";
import { loadOrCreateAuthSecret, nodeTokens, recoveryCodeHasher } from "./auth/secret.ts";
import type { Config } from "./config.ts";
import { openDemoDatabase } from "./demo.ts";
import { createApp } from "./http/app.ts";
import type { Authn } from "./http/session.ts";
import { createJobs, createRunner, type Runner } from "./jobs/index.ts";

export interface StartOptions {
  readonly config: Config;
  readonly migrationsDir: string;
  readonly webRoot?: string;
  /** The seed file demo mode loads when `config.seedFile` is not set. */
  readonly defaultSeedFile?: string;
  /** The job kinds and schedules to run; the production registry by default. */
  readonly jobs?: {
    readonly kinds: readonly JobRegistration[];
    readonly schedules: readonly Schedule[];
  };
  /** Structured log sink for what happens after startup (the admin socket). */
  readonly log?: AdminLog;
}

export interface RunningServer {
  readonly port: number;
  readonly schemaVersion: number;
  readonly demo: boolean;
  /** The unit of work use cases run on; in demo mode every write throws `Conflict`. */
  readonly uow: UnitOfWork;
  /** The clock use cases run on: the household time zone live, the seed's today in demo mode. */
  readonly clock: Clock;
  /** The job runner; undefined in demo mode, which runs no jobs. */
  readonly runner: Runner | undefined;
  /**
   * The setup-link file written at this boot (first boot, or the previous link expired unused),
   * for the caller to log. Never its contents.
   */
  readonly setupLinkFile: string | undefined;
  /** The admin socket's path while it listens; undefined in demo mode, disabled or failed. */
  readonly adminSocket: string | undefined;
  /**
   * Closes the admin socket, stops the job runner (waiting for running handlers), then the HTTP
   * server and database, and finally releases the data-directory lock.
   */
  close(): Promise<void>;
}

interface Opened {
  readonly db: Db;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly schemaVersion: number;
  /** The number of migrations this build ships, which `/healthz` expects applied. */
  readonly expectedSchemaVersion: number;
  /** The household time zone. */
  readonly timezone: string;
  /** The data-directory lock; none in demo mode, which never touches the data directory. */
  readonly lock?: DataDirLock;
}

function openLive(options: StartOptions): Opened {
  mkdirSync(options.config.dataDir, { recursive: true });
  // One writer per data directory (AD-16): taken before the database is opened, held until close.
  const lock = acquireDataDirLock(options.config.dataDir);
  let db: Db;
  try {
    db = openDatabase(join(options.config.dataDir, "pangolin.sqlite"));
  } catch (error) {
    lock.release();
    throw error;
  }
  try {
    const migrations = loadMigrations(options.migrationsDir);
    const { schemaVersion } = migrate(db, migrations);
    const uow = createUnitOfWork(db);
    const timezone = uow.read((repos) => repos.householdSettings.get().timezone);
    const clock = systemClock(timezone);
    // Default categories on a household that has none yet (idempotent).
    seedClassifyDefaults(uow, { clock, newId });
    return {
      db,
      uow,
      clock,
      schemaVersion,
      expectedSchemaVersion: migrations.length,
      timezone,
      lock,
    };
  } catch (error) {
    db.close();
    lock.release();
    throw error;
  }
}

function openDemo(options: StartOptions): Opened {
  const seedFile = options.config.seedFile ?? options.defaultSeedFile;
  if (seedFile === undefined) throw new Error("Demo mode needs PANGOLIN_SEED_FILE");
  const opened = openDemoDatabase({ migrationsDir: options.migrationsDir, seedFile });
  const timezone = opened.uow.read((repos) => repos.householdSettings.get().timezone);
  return { ...opened, expectedSchemaVersion: opened.schemaVersion, timezone };
}

/**
 * Composition root for the http entry: open SQLite, migrate, then serve. With
 * `config.demo`, the database is in memory, loaded from the seed and read-only, and the data
 * directory is never touched. Live, it first takes the data-directory lock (throwing
 * `DataDirLocked` while another process holds it), and once the job runner runs it listens on the
 * admin socket. Throws (after closing the database) when a migration or the seed fails.
 */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const { config } = options;
  const demo = config.demo;
  const { db, uow, clock, schemaVersion, expectedSchemaVersion, timezone, lock } = demo
    ? openDemo(options)
    : openLive(options);
  // Demo mode runs no jobs and makes no backups.
  const backupConfigured = !demo && config.backup.repository !== null;
  const closeDb = () => {
    try {
      db.close();
    } finally {
      lock?.release();
    }
  };
  const systemHealth = createSystemHealthRepo(db);
  // Created after the HTTP server is listening; `/healthz` reads it per request.
  let runner: Runner | undefined;

  let app: ReturnType<typeof createApp>;
  let setupLinkFile: string | undefined;
  try {
    let authn: Authn;
    // Demo mode never writes, so its recovery-code key is a throwaway.
    let codes = recoveryCodeHasher(randomBytes(32).toString("base64url"));
    if (demo) {
      // Demo mode: no sign-in; every request is the first seeded person, and writes still fail.
      authn = { kind: "demo" };
    } else {
      const identity = { uow, clock, newId, tokens: nodeTokens };
      const secret = loadOrCreateAuthSecret(config.auth.secretFile);
      codes = recoveryCodeHasher(secret);
      authn = {
        kind: "live",
        gateway: createAuth({ ...identity, db, config: config.auth, secret }),
      };
      setupLinkFile = writeFirstSetupLink({
        ...identity,
        dataDir: config.dataDir,
        publicUrl: config.auth.publicUrl,
      });
    }

    if (!demo) raiseUpgradeFailedIfMarked({ uow, clock, newId, dataDir: config.dataDir });

    app = createApp({
      systemHealth,
      uow,
      clock,
      newId,
      tokens: nodeTokens,
      codes,
      publicUrl: config.auth.publicUrl,
      authn,
      trustedProxies: config.trustedProxies,
      recoveryRateLimitPerMinute: config.auth.rateLimitPerMinute,
      backupConfigured,
      // Demo mode has no install and no bundle to confirm.
      ...(demo || config.recoveryBundleId === undefined
        ? {}
        : { bundleId: config.recoveryBundleId }),
      healthz: {
        expectedSchemaVersion,
        forceUnhealthy: Boolean(process.env.PANGOLIN_TEST_FORCE_UNHEALTHY),
        runner: demo ? "skip" : () => runner?.liveness(),
      },
      ...(options.webRoot === undefined ? {} : { webRoot: options.webRoot }),
    });
  } catch (error) {
    closeDb();
    throw error;
  }

  const server = serve({ fetch: app.fetch, port: options.config.port });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (error) {
    closeDb();
    throw error;
  }

  const closeHttp = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => {
        closeDb();
        if (error) reject(error);
        else resolve();
      });
    });

  // Demo mode is read-only and runs no jobs.
  if (!demo) {
    try {
      const jobs =
        options.jobs ??
        createJobs({
          timezone,
          dataDir: config.dataDir,
          backup: config.backup,
          migrationsDir: options.migrationsDir,
        });
      runner = createRunner({
        uow,
        clock,
        newId,
        kinds: jobs.kinds,
        schedules: jobs.schedules,
        concurrency: options.config.jobs.concurrency,
        leaseMs: options.config.jobs.leaseMs,
      });
      runner.start();
    } catch (error) {
      await closeHttp();
      throw error;
    }
  }

  // The admin socket (AD-16), once the runner is up. Demo mode opens none. A socket that cannot
  // be created costs only the CLI: the server logs a warning and keeps serving.
  let adminSocket: AdminSocket | undefined;
  if (!demo && config.adminSocket !== null) {
    const adminSeedFile = options.config.seedFile ?? options.defaultSeedFile;
    const deps = {
      uow,
      clock,
      newId,
      tokens: nodeTokens,
      publicUrl: config.auth.publicUrl,
      systemHealth,
      expectedSchemaVersion,
      runner: () => runner?.liveness(),
      version: config.version,
      backupConfigured,
      ...(adminSeedFile === undefined ? {} : { seedFile: adminSeedFile }),
      seedEnabled: config.enableSeed === true,
      ...(config.recoveryBundleId === undefined ? {} : { bundleId: config.recoveryBundleId }),
    };
    try {
      adminSocket = await listenAdminSocket({
        path: config.adminSocket,
        handle: (command, args) => runAdminCommand(deps, command, args),
        commands: ADMIN_COMMANDS,
        ...(options.log === undefined ? {} : { log: options.log }),
      });
    } catch (error) {
      options.log?.("warn", "admin socket unavailable; pangolin commands cannot reach the server", {
        path: config.adminSocket,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    schemaVersion,
    demo,
    setupLinkFile,
    adminSocket: adminSocket?.path,
    uow,
    clock,
    runner,
    close: async () => {
      // The HTTP server, database and lock are released whatever the socket or runner do.
      try {
        try {
          await adminSocket?.close();
        } finally {
          await runner?.stop();
        }
      } finally {
        await closeHttp();
      }
    },
  };
}
