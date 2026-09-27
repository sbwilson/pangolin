import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, packageMigrationsDir, schemaVersion } from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-server-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const dataDir = () => join(dir, "data");

async function boot(migrationsDir = packageMigrationsDir) {
  return startServer({ config: { dataDir: dataDir(), port: 0 }, migrationsDir });
}

async function getHealth(port: number) {
  const res = await fetch(`http://127.0.0.1:${port}/api/system/health`);
  return { status: res.status, body: await res.json() };
}

describe("startServer", () => {
  it("migrates a fresh data dir and serves health", async () => {
    const server = await boot();
    try {
      expect(await getHealth(server.port)).toEqual({
        status: 200,
        body: { status: "ok", schemaVersion: 1, writable: true },
      });
    } finally {
      await server.close();
    }
  });

  it("re-applies nothing on restart", async () => {
    await (await boot()).close();
    const server = await boot();
    try {
      expect((await getHealth(server.port)).body).toEqual({
        status: "ok",
        schemaVersion: 1,
        writable: true,
      });
    } finally {
      await server.close();
    }
  });

  // Root ignores file modes, so this only runs as a non-root user (as in the container).
  it.skipIf(process.getuid?.() === 0)(
    "starts on a database file that is not writable and reports 503",
    async () => {
      await (await boot()).close();
      const dbPath = join(dataDir(), "pangolin.sqlite");
      for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        if (existsSync(path)) chmodSync(path, 0o444);
      }
      const server = await boot();
      try {
        expect(await getHealth(server.port)).toEqual({
          status: 503,
          body: { status: "unhealthy", schemaVersion: 1, writable: false },
        });
      } finally {
        await server.close();
      }
    },
  );

  it("refuses to start when a migration fails, leaving the database unchanged", async () => {
    await (await boot()).close();
    const migrationsDir = join(dir, "migrations");
    cpSync(packageMigrationsDir, migrationsDir, { recursive: true });
    const journalPath = join(migrationsDir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries.push({ idx: 1, tag: "0001_broken" });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(join(migrationsDir, "0001_broken.sql"), "CREATE TABLE broken (id INTEGER);");

    await expect(boot(migrationsDir)).rejects.toThrow(/Migration 0001_broken failed/);
    const db = openDatabase(join(dataDir(), "pangolin.sqlite"));
    expect(schemaVersion(db)).toBe(1);
    db.close();
  });
});

describe("loadConfig", () => {
  it("defaults to /data and port 3000", () => {
    expect(loadConfig({})).toEqual({ dataDir: "/data", port: 3000 });
  });

  it("reads PANGOLIN_DATA_DIR and PORT", () => {
    expect(loadConfig({ PANGOLIN_DATA_DIR: "/tmp/p", PORT: "8080" })).toEqual({
      dataDir: "/tmp/p",
      port: 8080,
    });
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "http" })).toThrow();
    expect(() => loadConfig({ PORT: "70000" })).toThrow();
  });
});
