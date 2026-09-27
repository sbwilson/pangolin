import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { type Clock, systemClock, type UnitOfWork } from "@pangolin/app";
import {
  createSystemHealthRepo,
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
} from "@pangolin/db";
import type { Config } from "./config.ts";
import { openDemoDatabase } from "./demo.ts";
import { createApp } from "./http/app.ts";

export interface StartOptions {
  readonly config: Config;
  readonly migrationsDir: string;
  readonly webRoot?: string;
  /** The seed file demo mode loads when `config.seedFile` is not set. */
  readonly defaultSeedFile?: string;
}

export interface RunningServer {
  readonly port: number;
  readonly schemaVersion: number;
  readonly demo: boolean;
  /** The unit of work use cases run on; in demo mode every write throws `Conflict`. */
  readonly uow: UnitOfWork;
  /** The clock use cases run on: the household time zone live, the seed's today in demo mode. */
  readonly clock: Clock;
  close(): Promise<void>;
}

interface Opened {
  readonly db: Db;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly schemaVersion: number;
}

function openLive(options: StartOptions): Opened {
  mkdirSync(options.config.dataDir, { recursive: true });
  const db = openDatabase(join(options.config.dataDir, "pangolin.sqlite"));
  try {
    const { schemaVersion } = migrate(db, loadMigrations(options.migrationsDir));
    const uow = createUnitOfWork(db);
    const timezone = uow.read((repos) => repos.householdSettings.get().timezone);
    return { db, uow, clock: systemClock(timezone), schemaVersion };
  } catch (error) {
    db.close();
    throw error;
  }
}

function openDemo(options: StartOptions): Opened {
  const seedFile = options.config.seedFile ?? options.defaultSeedFile;
  if (seedFile === undefined) throw new Error("Demo mode needs PANGOLIN_SEED_FILE");
  return openDemoDatabase({ migrationsDir: options.migrationsDir, seedFile });
}

/**
 * Composition root for the http entry: open SQLite, migrate, then serve. With
 * `config.demo`, the database is in memory, loaded from the seed and read-only, and the data
 * directory is never touched. Throws (after closing the database) when a migration or the
 * seed fails.
 */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const demo = options.config.demo;
  const { db, uow, clock, schemaVersion } = demo ? openDemo(options) : openLive(options);

  const app = createApp({
    systemHealth: createSystemHealthRepo(db),
    ...(options.webRoot === undefined ? {} : { webRoot: options.webRoot }),
  });

  const server = serve({ fetch: app.fetch, port: options.config.port });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (error) {
    db.close();
    throw error;
  }

  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    schemaVersion,
    demo,
    uow,
    clock,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          db.close();
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
