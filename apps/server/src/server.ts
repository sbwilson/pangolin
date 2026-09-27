import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createSystemHealthRepo, loadMigrations, migrate, openDatabase } from "@pangolin/db";
import type { Config } from "./config.ts";
import { createApp } from "./http/app.ts";

export interface StartOptions {
  readonly config: Config;
  readonly migrationsDir: string;
  readonly webRoot?: string;
}

export interface RunningServer {
  readonly port: number;
  readonly schemaVersion: number;
  close(): Promise<void>;
}

/**
 * Composition root for the http entry: open SQLite, migrate, then serve.
 * Throws (after closing the database) when a migration fails.
 */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  mkdirSync(options.config.dataDir, { recursive: true });
  const db = openDatabase(join(options.config.dataDir, "pangolin.sqlite"));
  let schemaVersion: number;
  try {
    schemaVersion = migrate(db, loadMigrations(options.migrationsDir)).schemaVersion;
  } catch (error) {
    db.close();
    throw error;
  }

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
