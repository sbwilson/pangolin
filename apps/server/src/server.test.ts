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
import {
  AppError,
  createIdGenerator,
  defineJobKind,
  defineSchedule,
  enqueueJob,
  type JobKind,
  jobHandler,
  updateHouseholdSettings,
  write,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { openDatabase, packageMigrationsDir, schemaVersion } from "@pangolin/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { generateSeedFile } from "../scripts/demo-seed.ts";
import { DEFAULT_JOBS_CONFIG, type JobsConfig, loadConfig } from "./config.ts";
import { type RunningServer, type StartOptions, startServer } from "./server.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-server-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const dataDir = () => join(dir, "data");

async function boot(
  migrationsDir = packageMigrationsDir,
  jobs?: StartOptions["jobs"],
  jobsConfig: JobsConfig = DEFAULT_JOBS_CONFIG,
) {
  return startServer({
    config: { dataDir: dataDir(), port: 0, demo: false, jobs: jobsConfig },
    migrationsDir,
    ...(jobs === undefined ? {} : { jobs }),
  });
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
        body: { status: "ok", schemaVersion: 3, writable: true },
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
        schemaVersion: 3,
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
          body: { status: "unhealthy", schemaVersion: 3, writable: false },
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
    expect(schemaVersion(db)).toBe(3);
    db.close();
  });
});

describe("startServer job runner", () => {
  const kind = defineJobKind({
    kind: "test-noop",
    schema: z.object({}).strict(),
    lane: "local",
    externalEffects: false,
    needsPersonWhenDead: false,
  });
  const nightly = defineSchedule({
    name: "nightly",
    kind,
    payload: {},
    next: (after) => after.add({ hours: 24 }),
  });
  const jobs = { kinds: [jobHandler(kind, async () => {})], schedules: [nightly] };

  it("starts the runner, which ensures the schedules, and serves the dead-jobs list", async () => {
    const server = await boot(packageMigrationsDir, jobs);
    try {
      expect(server.runner).toBeDefined();
      const res = await fetch(`http://127.0.0.1:${server.port}/api/system/jobs`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ dead: [] });
    } finally {
      await server.close();
    }
    const db = openDatabase(join(dataDir(), "pangolin.sqlite"));
    try {
      expect(db.prepare("SELECT dedupe_key, status FROM job").all()).toEqual([
        { dedupe_key: "schedule:nightly", status: "pending" },
      ]);
    } finally {
      db.close();
    }
  });

  const netKind = defineJobKind({
    kind: "test-net",
    schema: z.object({}).strict(),
    lane: "net",
    externalEffects: false,
    needsPersonWhenDead: false,
  });

  /** A net-lane handler that waits until the test releases it. */
  function gatedNet() {
    let release: (() => void) | undefined;
    let started = false;
    const registration = jobHandler(netKind, async () => {
      started = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    return { registration, started: () => started, release: () => release?.() };
  }

  function enqueueOn(server: RunningServer, jobKind: JobKind<Record<string, never>>): void {
    const ctx = {
      viewer: systemViewer("cli:test"),
      clock: server.clock,
      newId: createIdGenerator(),
      uow: server.uow,
    };
    write(ctx, (tx) => enqueueJob(tx, ctx, jobKind, {}));
  }

  function jobRows(): Record<string, unknown>[] {
    const db = openDatabase(join(dataDir(), "pangolin.sqlite"));
    try {
      return db.prepare("SELECT * FROM job ORDER BY kind").all() as Record<string, unknown>[];
    } finally {
      db.close();
    }
  }

  it("passes the jobs config to the runner: a lane at 0 never runs, and the lease length", async () => {
    const gate = gatedNet();
    const server = await boot(
      packageMigrationsDir,
      { kinds: [jobHandler(kind, async () => {}), gate.registration], schedules: [] },
      { concurrency: { llm: 1, net: 1, local: 0 }, leaseMs: 7000 },
    );
    try {
      enqueueOn(server, kind);
      enqueueOn(server, netKind);
      const ticked = server.runner?.tick();
      expect(gate.started()).toBe(true);
      const [netRow, localRow] = jobRows();
      expect(localRow).toMatchObject({ kind: "test-noop", status: "pending", attempts: 0 });
      expect(netRow).toMatchObject({ kind: "test-net", status: "running" });
      const leaseMs =
        Date.parse(String(netRow?.lease_expires_at)) - Date.parse(String(netRow?.updated_at));
      expect(leaseMs).toBe(7000);
      gate.release();
      await ticked;
    } finally {
      await server.close();
    }
  });

  it("waits on close for a running handler, which then completes", async () => {
    const gate = gatedNet();
    const server = await boot(packageMigrationsDir, { kinds: [gate.registration], schedules: [] });
    enqueueOn(server, netKind);
    void server.runner?.tick();
    expect(gate.started()).toBe(true);
    let closed = false;
    const closing = server.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(false);
    gate.release();
    await closing;
    expect(jobRows()).toEqual([expect.objectContaining({ kind: "test-net", status: "done" })]);
  });

  it("keeps one pending row per schedule across restarts", async () => {
    await (await boot(packageMigrationsDir, jobs)).close();
    await (await boot(packageMigrationsDir, jobs)).close();
    const db = openDatabase(join(dataDir(), "pangolin.sqlite"));
    try {
      expect(db.prepare("SELECT count(*) FROM job").pluck().get()).toBe(1);
    } finally {
      db.close();
    }
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
        jobs: DEFAULT_JOBS_CONFIG,
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
      expect(server.runner).toBeUndefined();
      expect(server.clock.today().toString()).toBe(
        JSON.parse(readFileSync(seedFile, "utf8")).today,
      );
      expect(await getHealth(server.port)).toEqual({
        status: 200,
        body: { status: "ok", schemaVersion: 3, writable: true },
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
    expect(loadConfig({})).toEqual({
      dataDir: "/data",
      port: 3000,
      demo: false,
      jobs: { concurrency: { llm: 1, net: 2, local: 1 }, leaseMs: 60_000 },
    });
  });

  it("reads PANGOLIN_DATA_DIR and PORT", () => {
    expect(loadConfig({ PANGOLIN_DATA_DIR: "/tmp/p", PORT: "8080" })).toMatchObject({
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

  it("reads the job runner settings", () => {
    expect(
      loadConfig({
        PANGOLIN_JOB_CONCURRENCY_LLM: "2",
        PANGOLIN_JOB_CONCURRENCY_NET: "4",
        PANGOLIN_JOB_CONCURRENCY_LOCAL: "0",
        PANGOLIN_JOB_LEASE_MS: "30000",
      }).jobs,
    ).toEqual({ concurrency: { llm: 2, net: 4, local: 0 }, leaseMs: 30_000 });
    expect(() => loadConfig({ PANGOLIN_JOB_CONCURRENCY_LLM: "-1" })).toThrow();
    expect(() => loadConfig({ PANGOLIN_JOB_CONCURRENCY_NET: "1.5" })).toThrow();
    expect(() => loadConfig({ PANGOLIN_JOB_LEASE_MS: "100" })).toThrow();
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "http" })).toThrow();
    expect(() => loadConfig({ PORT: "70000" })).toThrow();
  });
});
