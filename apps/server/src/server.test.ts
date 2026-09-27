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
import { AppError, createIdGenerator, updateHouseholdSettings } from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { openDatabase, packageMigrationsDir, schemaVersion } from "@pangolin/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateSeedFile } from "../scripts/demo-seed.ts";
import { loadConfig } from "./config.ts";
import { type RunningServer, startServer } from "./server.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-server-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const dataDir = () => join(dir, "data");

async function boot(migrationsDir = packageMigrationsDir) {
  return startServer({ config: { dataDir: dataDir(), port: 0, demo: false }, migrationsDir });
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
        body: { status: "ok", schemaVersion: 2, writable: true },
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
        schemaVersion: 2,
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
          body: { status: "unhealthy", schemaVersion: 2, writable: false },
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
    journal.entries.push({ idx: journal.entries.length, tag: "0099_broken" });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(join(migrationsDir, "0099_broken.sql"), "CREATE TABLE broken (id INTEGER);");

    await expect(boot(migrationsDir)).rejects.toThrow(/Migration 0099_broken failed/);
    const db = openDatabase(join(dataDir(), "pangolin.sqlite"));
    expect(schemaVersion(db)).toBe(2);
    db.close();
  });
});

describe("startServer in demo mode", () => {
  let seedDir: string;
  let seedFile: string;
  let expectations: Record<string, unknown>;

  beforeAll(() => {
    seedDir = mkdtempSync(join(tmpdir(), "pangolin-demo-seed-"));
    seedFile = join(seedDir, "demo-seed.json");
    generateSeedFile(seedFile);
    expectations = JSON.parse(readFileSync(seedFile, "utf8")).expectations;
  });

  afterAll(() => {
    rmSync(seedDir, { recursive: true, force: true });
  });

  /** `file: null` leaves `config.seedFile` unset. */
  async function bootDemo(file: string | null = seedFile, defaultSeedFile?: string) {
    return startServer({
      config: {
        dataDir: dataDir(),
        port: 0,
        demo: true,
        ...(file === null ? {} : { seedFile: file }),
      },
      migrationsDir: packageMigrationsDir,
      ...(defaultSeedFile === undefined ? {} : { defaultSeedFile }),
    });
  }

  async function withDemo(server: RunningServer, check: (s: RunningServer) => Promise<void>) {
    try {
      await check(server);
    } finally {
      await server.close();
    }
  }

  it("serves health 200 with the seeded people, and never touches the data dir", async () => {
    await withDemo(await bootDemo(), async (server) => {
      expect(server.demo).toBe(true);
      expect(server.clock.today().toString()).toBe(
        JSON.parse(readFileSync(seedFile, "utf8")).today,
      );
      expect(await getHealth(server.port)).toEqual({
        status: 200,
        body: { status: "ok", schemaVersion: 2, writable: true },
      });
      const settings = server.uow.read((repos) => repos.householdSettings.get());
      expect(settings.timezone).toBe(expectations["people-and-household.timezone"]);
    });
    expect(existsSync(dataDir())).toBe(false);
  });

  it("rejects every write with Conflict", async () => {
    await withDemo(await bootDemo(), async (server) => {
      const ctx = {
        viewer: systemViewer("cli:demo-test"),
        clock: server.clock,
        newId: createIdGenerator(),
        uow: server.uow,
      };
      let error: unknown;
      try {
        updateHouseholdSettings(ctx, { timezone: "Australia/Perth" });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "Conflict", message: "Demo mode is read-only" });
    });
  });

  it("falls back to the default seed file", async () => {
    await withDemo(await bootDemo(null, seedFile), async (server) => {
      expect((await getHealth(server.port)).status).toBe(200);
    });
  });

  it("fails to boot on a bad or missing seed file", async () => {
    const bad = join(dir, "bad-seed.json");
    writeFileSync(
      bad,
      JSON.stringify({
        seed: "s",
        today: "2026-07-15",
        events: [{ type: "account.created" }],
        expectations: {},
      }),
    );
    await expect(bootDemo(bad)).rejects.toThrow(/unknown event type "account.created"/);
    writeFileSync(bad, "{ nope");
    await expect(bootDemo(bad)).rejects.toThrow(/not valid JSON/);
    await expect(bootDemo(join(dir, "missing.json"))).rejects.toThrow(/ENOENT/);
    await expect(bootDemo(null)).rejects.toThrow(/PANGOLIN_SEED_FILE/);
    expect(existsSync(dataDir())).toBe(false);
  });
});

describe("loadConfig", () => {
  it("defaults to /data, port 3000 and no demo", () => {
    expect(loadConfig({})).toEqual({ dataDir: "/data", port: 3000, demo: false });
  });

  it("reads PANGOLIN_DATA_DIR and PORT", () => {
    expect(loadConfig({ PANGOLIN_DATA_DIR: "/tmp/p", PORT: "8080" })).toEqual({
      dataDir: "/tmp/p",
      port: 8080,
      demo: false,
    });
  });

  it("reads PANGOLIN_DEMO and PANGOLIN_SEED_FILE", () => {
    expect(loadConfig({ PANGOLIN_DEMO: "true", PANGOLIN_SEED_FILE: "/s.json" })).toMatchObject({
      demo: true,
      seedFile: "/s.json",
    });
    expect(loadConfig({ PANGOLIN_DEMO: "false" }).demo).toBe(false);
    expect(() => loadConfig({ PANGOLIN_DEMO: "maybe" })).toThrow();
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "http" })).toThrow();
    expect(() => loadConfig({ PORT: "70000" })).toThrow();
  });
});
