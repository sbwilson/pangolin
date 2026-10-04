import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  createIdGenerator,
  DEFAULT_CATEGORIES,
  defineJobKind,
  defineSchedule,
  enqueueJob,
  type JobKind,
  jobHandler,
  listReviewItems,
  updateHouseholdSettings,
  write,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { openDatabase, packageMigrationsDir, schemaVersion } from "@pangolin/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { generateSeedFile } from "../scripts/demo-seed.ts";
import {
  DEFAULT_BACKUP_CONFIG,
  DEFAULT_JOBS_CONFIG,
  defaultAuthConfig,
  type JobsConfig,
  loadConfig,
} from "./config.ts";
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
    config: {
      dataDir: dataDir(),
      port: 0,
      demo: false,
      jobs: jobsConfig,
      backup: DEFAULT_BACKUP_CONFIG,
      auth: defaultAuthConfig(dataDir()),
      trustedProxies: [],
      adminSocket: null,
      version: "test",
    },
    migrationsDir,
    ...(jobs === undefined ? {} : { jobs }),
  });
}

async function getHealth(port: number) {
  const res = await fetch(`http://127.0.0.1:${port}/api/system/health`);
  return { status: res.status, body: await res.json() };
}

async function getHealthz(port: number) {
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  return { status: res.status, body: await res.json() };
}

describe("startServer", () => {
  it("migrates a fresh data dir and serves health", async () => {
    const server = await boot();
    try {
      expect(await getHealth(server.port)).toEqual({
        status: 200,
        body: { status: "ok", schemaVersion: 10, writable: true },
      });
    } finally {
      await server.close();
    }
  });

  it("seeds the default categories once, across restarts", async () => {
    const count = (sql: string) => {
      const db = openDatabase(join(dataDir(), "pangolin.sqlite"), { readonly: true });
      try {
        return db.prepare(sql).pluck().get();
      } finally {
        db.close();
      }
    };
    await (await boot()).close();
    const groups = count("SELECT count(*) FROM category_group");
    const categories = count("SELECT count(*) FROM category");
    expect(groups).toBe(13);
    expect(categories).toBe(DEFAULT_CATEGORIES.reduce((n, g) => n + g.categories.length, 0));
    expect(count("SELECT count(*) FROM tax_category")).toBe(8);
    await (await boot()).close();
    expect(count("SELECT count(*) FROM category_group")).toBe(groups);
    expect(count("SELECT count(*) FROM category")).toBe(categories);
    const actors = (sql: string) => {
      const db = openDatabase(join(dataDir(), "pangolin.sqlite"), { readonly: true });
      try {
        return db.prepare(sql).pluck().all();
      } finally {
        db.close();
      }
    };
    expect(
      actors(
        "SELECT DISTINCT actor FROM audit_log WHERE entity IN ('category_group','category','tax_category')",
      ),
    ).toEqual(["job:seed-defaults"]);
  });

  it("re-applies nothing on restart", async () => {
    await (await boot()).close();
    const server = await boot();
    try {
      expect((await getHealth(server.port)).body).toEqual({
        status: "ok",
        schemaVersion: 10,
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
          body: { status: "unhealthy", schemaVersion: 10, writable: false },
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
    expect(schemaVersion(db)).toBe(10);
    db.close();
  });
});

describe("startServer first boot", () => {
  it("writes the setup link to a 0600 file, and the auth secret to another", async () => {
    const server = await boot();
    try {
      const file = join(dataDir(), "setup-link.txt");
      expect(server.setupLinkFile).toBe(file);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const url = readFileSync(file, "utf8").trim();
      expect(url).toMatch(/^http:\/\/localhost:3000\/setup\?token=[\w-]{43}$/);
      const secretFile = join(dataDir(), "auth-secret");
      expect(statSync(secretFile).mode & 0o777).toBe(0o600);
      expect(readFileSync(secretFile, "utf8").trim()).toHaveLength(43);
      // Only the hash is in the database.
      const db = openDatabase(join(dataDir(), "pangolin.sqlite"));
      try {
        const token = new URL(url).searchParams.get("token") ?? "";
        const dump = JSON.stringify(db.prepare("SELECT * FROM setup_link").all());
        expect(dump).not.toContain(token);
        expect(dump).not.toContain(readFileSync(secretFile, "utf8").trim());
      } finally {
        db.close();
      }
    } finally {
      await server.close();
    }
  });

  it("keeps the live link and the secret across a restart", async () => {
    await (await boot()).close();
    const link = readFileSync(join(dataDir(), "setup-link.txt"), "utf8");
    const secret = readFileSync(join(dataDir(), "auth-secret"), "utf8");
    const server = await boot();
    try {
      expect(server.setupLinkFile).toBeUndefined();
      expect(readFileSync(join(dataDir(), "setup-link.txt"), "utf8")).toBe(link);
      expect(readFileSync(join(dataDir(), "auth-secret"), "utf8")).toBe(secret);
    } finally {
      await server.close();
    }
  });

  const linkFile = () => join(dataDir(), "setup-link.txt");
  const tokenIn = (file: string) =>
    new URL(readFileSync(file, "utf8").trim()).searchParams.get("token") ?? "";

  it("deletes the setup-link file once anyone has a login", async () => {
    await (await boot()).close();
    const db = openDatabase(join(dataDir(), "pangolin.sqlite"));
    db.prepare(
      `INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at)
       VALUES ('u', 'A', 'a@example.com', 0, 'x', 'x')`,
    ).run();
    db.close();
    const server = await boot();
    try {
      expect(server.setupLinkFile).toBeUndefined();
      expect(existsSync(linkFile())).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("revokes the live link and issues a new one when its file is missing", async () => {
    await (await boot()).close();
    const oldToken = tokenIn(linkFile());
    rmSync(linkFile());
    const server = await boot();
    try {
      expect(server.setupLinkFile).toBe(linkFile());
      expect(tokenIn(linkFile())).not.toBe(oldToken);
      const res = await fetch(`http://127.0.0.1:${server.port}/api/identity/sign-up`, {
        method: "POST",
        headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
        body: JSON.stringify({
          token: oldToken,
          email: "a@example.com",
          password: "a long enough password",
          displayName: "A",
          colour: "#000000",
        }),
      });
      expect(res.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("replaces an older, looser file with a new 0600 one", async () => {
    await (await boot()).close();
    const oldToken = tokenIn(linkFile());
    chmodSync(linkFile(), 0o644);
    const db = openDatabase(join(dataDir(), "pangolin.sqlite"));
    db.prepare("UPDATE setup_link SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    db.close();
    const server = await boot();
    try {
      expect(server.setupLinkFile).toBe(linkFile());
      expect(statSync(linkFile()).mode & 0o777).toBe(0o600);
      expect(tokenIn(linkFile())).not.toBe(oldToken);
    } finally {
      await server.close();
    }
  });

  it("refuses to boot on an auth secret that is too short", async () => {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(join(dataDir(), "auth-secret"), "short");
    await expect(boot()).rejects.toThrow(/shorter than 32/);
  });

  it("serves /healthz ok once the runner has started, and 503 jobs once it stops", async () => {
    const server = await boot();
    try {
      expect(await getHealthz(server.port)).toEqual({ status: 200, body: { ok: true } });
      await server.runner?.stop();
      // /healthz reuses its answer for a second.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(await getHealthz(server.port)).toEqual({
        status: 503,
        body: { ok: false, failing: ["jobs"] },
      });
    } finally {
      await server.close();
    }
  });

  it("serves the health check without a session and refuses the jobs list", async () => {
    const server = await boot();
    try {
      expect((await getHealth(server.port)).status).toBe(200);
      const res = await fetch(`http://127.0.0.1:${server.port}/api/system/jobs`);
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
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
      // The dead-jobs list needs a session now (story 1.5).
      const res = await fetch(`http://127.0.0.1:${server.port}/api/system/jobs`);
      expect(res.status).toBe(401);
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
  async function bootDemo(
    file: string | null = seedFile,
    defaultSeedFile?: string,
    recoveryBundleId?: string,
  ) {
    return startServer({
      config: {
        dataDir: dataDir(),
        port: 0,
        demo: true,
        jobs: DEFAULT_JOBS_CONFIG,
        backup: DEFAULT_BACKUP_CONFIG,
        auth: defaultAuthConfig(dataDir()),
        trustedProxies: [],
        adminSocket: null,
        version: "test",
        ...(file === null ? {} : { seedFile: file }),
        ...(recoveryBundleId === undefined ? {} : { recoveryBundleId }),
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
        body: { status: "ok", schemaVersion: 10, writable: true },
      });
      // Demo mode runs no jobs, so /healthz skips the runner check.
      expect(await getHealthz(server.port)).toEqual({ status: 200, body: { ok: true } });
      const settings = server.uow.read((repos) => repos.householdSettings.get());
      expect(settings.timezone).toBe(expectations["people-and-household.timezone"]);
    });
    expect(existsSync(dataDir())).toBe(false);
  });

  it("never warns of the recovery bundle, even with a bundle id set", async () => {
    await withDemo(await bootDemo(seedFile, undefined, "20261003T010203Z-a1b2"), async (server) => {
      expect(await getHealthz(server.port)).toEqual({ status: 200, body: { ok: true } });
    });
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

  it("signs every request in as the first seeded person, and still refuses writes", async () => {
    await withDemo(await bootDemo(), async (server) => {
      const base = `http://127.0.0.1:${server.port}`;
      const me = await fetch(`${base}/api/identity/me`);
      expect(me.status).toBe(200);
      const names = expectations["people-and-household.peopleNames"] as string[];
      expect(await me.json()).toMatchObject({ displayName: names[0], demo: true });
      expect((await fetch(`${base}/api/system/jobs`)).status).toBe(200);
      const write = await fetch(`${base}/api/identity/setup-links`, {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
      });
      expect(write.status).toBe(409);
      expect(await write.json()).toEqual({
        error: { code: "Conflict", message: "Demo mode is read-only" },
      });
    });
    expect(existsSync(dataDir())).toBe(false);
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
        events: [{ type: "budget.created" }],
        expectations: {},
      }),
    );
    await expect(bootDemo(bad)).rejects.toThrow(/unknown event type "budget.created"/);
    writeFileSync(bad, "{ nope");
    await expect(bootDemo(bad)).rejects.toThrow(/not valid JSON/);
    await expect(bootDemo(join(dir, "missing.json"))).rejects.toThrow(/ENOENT/);
    await expect(bootDemo(null)).rejects.toThrow(/PANGOLIN_SEED_FILE/);
    expect(existsSync(dataDir())).toBe(false);
  });
});

describe("loadConfig", () => {
  it("defaults to /data, port 3000, no demo, and the auth defaults", () => {
    expect(loadConfig({})).toEqual({
      dataDir: "/data",
      port: 3000,
      demo: false,
      jobs: { concurrency: { llm: 1, net: 2, local: 1 }, leaseMs: 60_000 },
      auth: {
        publicUrl: "http://localhost:3000",
        secretFile: "/data/auth-secret",
        lockout: { maxFailures: 5, windowMs: 900_000, lockMs: 900_000 },
        sessionIdleMs: 1_800_000,
        rateLimitPerMinute: 10,
      },
      trustedProxies: [],
      adminSocket: "/run/pangolin/admin.sock",
      version: "dev",
      backup: DEFAULT_BACKUP_CONFIG,
    });
    expect(loadConfig({}).auth).toEqual(defaultAuthConfig("/data"));
  });

  it("reads the recovery bundle id, trimmed; empty means none, and a malformed one throws", () => {
    expect(loadConfig({})).not.toHaveProperty("recoveryBundleId");
    expect(loadConfig({ PANGOLIN_RECOVERY_BUNDLE_ID: "" })).not.toHaveProperty("recoveryBundleId");
    expect(loadConfig({ PANGOLIN_RECOVERY_BUNDLE_ID: "   " })).not.toHaveProperty(
      "recoveryBundleId",
    );
    expect(
      loadConfig({ PANGOLIN_RECOVERY_BUNDLE_ID: " 20261003T010203Z-a1b2 " }).recoveryBundleId,
    ).toBe("20261003T010203Z-a1b2");
    expect(() => loadConfig({ PANGOLIN_RECOVERY_BUNDLE_ID: "20261003-a1b2" })).toThrow();
    expect(() => loadConfig({ PANGOLIN_RECOVERY_BUNDLE_ID: "20261003T010203Z-A1B2" })).toThrow();
  });

  it("reads the backup repository (empty means not configured) and the restic password file", () => {
    expect(loadConfig({}).backup).toEqual({
      repository: null,
      passwordFile: "/secrets/restic-password",
      resticBin: "restic",
    });
    expect(loadConfig({ PANGOLIN_BACKUP_REPOSITORY: "  " }).backup.repository).toBeNull();
    expect(
      loadConfig({
        PANGOLIN_BACKUP_REPOSITORY: " rest:https://nas.lan:8000/pangolin ",
        PANGOLIN_RESTIC_PASSWORD_FILE: "/run/secrets/restic",
        PANGOLIN_RESTIC_BIN: "/opt/restic",
      }).backup,
    ).toEqual({
      repository: "rest:https://nas.lan:8000/pangolin",
      passwordFile: "/run/secrets/restic",
      resticBin: "/opt/restic",
    });
    expect(() => loadConfig({ PANGOLIN_RESTIC_PASSWORD_FILE: "restic-password" })).toThrow(
      /absolute path/,
    );
  });

  it("reads the auth settings", () => {
    expect(
      loadConfig({
        PANGOLIN_DATA_DIR: "/srv/p",
        PANGOLIN_PUBLIC_URL: "https://money.example.com/",
        PANGOLIN_LOGIN_MAX_FAILURES: "3",
        PANGOLIN_LOGIN_WINDOW_MINUTES: "10",
        PANGOLIN_LOGIN_LOCKOUT_MINUTES: "60",
        PANGOLIN_SESSION_IDLE_MINUTES: "20",
        PANGOLIN_AUTH_RATE_LIMIT: "100",
      }).auth,
    ).toEqual({
      publicUrl: "https://money.example.com",
      secretFile: "/srv/p/auth-secret",
      lockout: { maxFailures: 3, windowMs: 600_000, lockMs: 3_600_000 },
      sessionIdleMs: 1_200_000,
      rateLimitPerMinute: 100,
    });
    expect(loadConfig({ PANGOLIN_AUTH_SECRET_FILE: "/run/secret" }).auth.secretFile).toBe(
      "/run/secret",
    );
  });

  it("reads the trusted proxies", () => {
    expect(loadConfig({ PANGOLIN_TRUSTED_PROXIES: " 10.0.0.2, fd00::1 " }).trustedProxies).toEqual([
      "10.0.0.2",
      "fd00::1",
    ]);
    expect(() => loadConfig({ PANGOLIN_TRUSTED_PROXIES: "proxy.lan" })).toThrow();
  });

  it("rejects a public URL passkeys and Secure cookies cannot work with", () => {
    for (const url of [
      "https://192.168.1.10",
      "http://127.0.0.1:3000",
      "https://[::1]:3000",
      "http://money.example.com",
      "http://pangolin.lan:3000",
    ]) {
      expect(() => loadConfig({ PANGOLIN_PUBLIC_URL: url }), url).toThrow(
        /PANGOLIN_PUBLIC_URL must/,
      );
    }
    expect(loadConfig({ PANGOLIN_PUBLIC_URL: "http://localhost:8080" }).auth.publicUrl).toBe(
      "http://localhost:8080",
    );
  });

  it("rejects a public URL that is not an http(s) origin", () => {
    for (const url of ["ftp://x.example", "not a url", "https://x.example/app", "http://x?y=1"]) {
      expect(() => loadConfig({ PANGOLIN_PUBLIC_URL: url })).toThrow();
    }
    expect(() => loadConfig({ PANGOLIN_SESSION_IDLE_MINUTES: "0" })).toThrow();
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

  it("reads the admin socket (empty disables it) and the version", () => {
    expect(loadConfig({ PANGOLIN_ADMIN_SOCKET: "/tmp/p/admin.sock" }).adminSocket).toBe(
      "/tmp/p/admin.sock",
    );
    expect(loadConfig({ PANGOLIN_ADMIN_SOCKET: "" }).adminSocket).toBeNull();
    expect(() => loadConfig({ PANGOLIN_ADMIN_SOCKET: "admin.sock" })).toThrow();
    expect(loadConfig({ PANGOLIN_VERSION: "v1.2.3" }).version).toBe("v1.2.3");
  });
});

describe("startServer admin socket", () => {
  async function bootWith(adminSocket: string | null, demo = false) {
    const logged: [string, string, Record<string, unknown>][] = [];
    const seedFile = join(dir, "seed.json");
    if (demo) generateSeedFile(seedFile);
    const server = await startServer({
      config: {
        dataDir: dataDir(),
        port: 0,
        demo,
        jobs: DEFAULT_JOBS_CONFIG,
        backup: DEFAULT_BACKUP_CONFIG,
        auth: defaultAuthConfig(dataDir()),
        trustedProxies: [],
        adminSocket,
        version: "test",
        ...(demo ? { seedFile } : {}),
      },
      migrationsDir: packageMigrationsDir,
      log: (level, msg, fields) => logged.push([level, msg, fields]),
    });
    return { server, logged };
  }

  it("listens once the runner runs, and removes the socket on close", async () => {
    const path = join(dir, "run", "admin.sock");
    const { server } = await bootWith(path);
    try {
      expect(server.adminSocket).toBe(path);
      expect(statSync(path).isSocket()).toBe(true);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      await server.close();
    }
    expect(existsSync(path)).toBe(false);
  });

  it("keeps serving, with a warning, when the socket cannot be created", async () => {
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "");
    const path = join(blocker, "admin.sock");
    const { server, logged } = await bootWith(path);
    try {
      expect(server.adminSocket).toBeUndefined();
      expect((await getHealth(server.port)).status).toBe(200);
      expect(logged).toEqual([
        [
          "warn",
          "admin socket unavailable; pangolin commands cannot reach the server",
          { path, error: expect.any(String) },
        ],
      ]);
    } finally {
      await server.close();
    }
  });

  it("opens no socket and takes no lock in demo mode", async () => {
    const path = join(dir, "run", "admin.sock");
    const { server } = await bootWith(path, true);
    try {
      expect(server.adminSocket).toBeUndefined();
      expect(existsSync(join(dir, "run"))).toBe(false);
      expect(existsSync(dataDir())).toBe(false);
    } finally {
      await server.close();
    }
  });
});

describe("startServer upgrade-failed marker", () => {
  it("raises system.upgrade-failed review item and deletes the marker on startup", async () => {
    // Pre-create the data dir and write the marker file before the server starts
    mkdirSync(dataDir(), { recursive: true });
    const markerFile = join(dataDir(), "upgrade-failed.json");
    writeFileSync(markerFile, "{}");

    const server = await boot();
    try {
      // Marker must be deleted
      expect(existsSync(markerFile)).toBe(false);

      // A system.upgrade-failed review item must be present
      const ctx = {
        uow: server.uow,
        clock: server.clock,
        newId: createIdGenerator(),
        viewer: systemViewer("cli:test"),
      };
      const items = listReviewItems(ctx);
      expect(items.some((i) => i.kind === "system.upgrade-failed")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("starts cleanly when no upgrade-failed marker exists", async () => {
    const server = await boot();
    try {
      expect(existsSync(join(dataDir(), "upgrade-failed.json"))).toBe(false);
      const ctx = {
        uow: server.uow,
        clock: server.clock,
        newId: createIdGenerator(),
        viewer: systemViewer("cli:test"),
      };
      const items = listReviewItems(ctx);
      expect(items.some((i) => i.kind === "system.upgrade-failed")).toBe(false);
    } finally {
      await server.close();
    }
  });
});
