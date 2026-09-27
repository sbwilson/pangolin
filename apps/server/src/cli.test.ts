import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, openDatabase, packageMigrationsDir } from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireDataDirLock } from "./admin/lock.ts";
import { EXIT_FAILED, EXIT_NOT_RUNNING, EXIT_OK, EXIT_USAGE, runCli } from "./cli.ts";
import { DEFAULT_JOBS_CONFIG, defaultAuthConfig } from "./config.ts";
import { type RunningServer, startServer } from "./server.ts";
import { addLogin, signIn } from "./testing/logins.ts";

let dir: string;
let server: RunningServer | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-cli-"));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const dataDir = () => join(dir, "data");
const socketPath = () => join(dir, "run", "admin.sock");
const PUBLIC_URL = "https://money.example.com";

async function boot(): Promise<RunningServer> {
  server = await startServer({
    config: {
      dataDir: dataDir(),
      port: 0,
      demo: false,
      jobs: DEFAULT_JOBS_CONFIG,
      auth: { ...defaultAuthConfig(dataDir()), publicUrl: PUBLIC_URL },
      trustedProxies: [],
      adminSocket: socketPath(),
      version: "v1.2.3",
    },
    migrationsDir: packageMigrationsDir,
  });
  return server;
}

async function stop(): Promise<void> {
  await server?.close();
  server = undefined;
}

/** A connection beside the server's (WAL allows it), for arranging and checking rows. */
function withDb<T>(fn: (db: Db) => T): T {
  const db = openDatabase(join(dataDir(), "pangolin.sqlite"));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function cli(argv: string[], migrationsDir = packageMigrationsDir) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    env: {
      PANGOLIN_DATA_DIR: dataDir(),
      PANGOLIN_ADMIN_SOCKET: socketPath(),
      PANGOLIN_PUBLIC_URL: PUBLIC_URL,
    },
    migrationsDir,
    io: { out: (text) => out.push(text), err: (text) => err.push(text) },
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("pangolin (the admin CLI)", () => {
  it("prints help, and refuses a missing or unknown command as usage", async () => {
    expect(await cli(["--help"])).toMatchObject({ code: EXIT_OK, out: /reset-user/ });
    expect(await cli([])).toMatchObject({ code: EXIT_USAGE, err: /name a command/ });
    expect(await cli(["backup"])).toMatchObject({ code: EXIT_USAGE, err: /unknown command/ });
    expect(await cli(["status", "extra"])).toMatchObject({ code: EXIT_USAGE });
    expect(await cli(["reset-user", "a", "b"])).toMatchObject({ code: EXIT_USAGE });
  });

  it("status on a running server prints readiness and job state, exit 0", async () => {
    await boot();
    const result = await cli(["status"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain("Pangolin Money v1.2.3");
    expect(result.out).toMatch(/Schema: +5 \(this build expects 5\)/);
    expect(result.out).toMatch(/Readiness: ok/);
    expect(result.out).toMatch(/Jobs: +\d+ pending, \d+ running, 0 dead/);
  });

  it("status on a stopped server says so, exit 3, and opens no database", async () => {
    const result = await cli(["status"]);
    expect(result).toMatchObject({ code: EXIT_NOT_RUNNING, out: "Pangolin is not running" });
    expect(existsSync(dataDir())).toBe(false);

    await boot();
    await stop();
    const db = join(dataDir(), "pangolin.sqlite");
    const before = readFileSync(db);
    expect(await cli(["status"])).toMatchObject({ code: EXIT_NOT_RUNNING });
    expect(readFileSync(db).equals(before)).toBe(true);
    expect(existsSync(`${db}-wal`)).toBe(false);
  });

  it("reset-user on a running server prints the link and clears sign-in, as cli:reset-user", async () => {
    await boot();
    withDb((db) => {
      addLogin(db, "alex@example.com", "Alex");
      addLogin(db, "sam@example.com", "Sam");
    });
    const result = await cli(["reset-user", "alex@example.com"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain("Reset Alex <alex@example.com>");
    expect(result.out).toMatch(/https:\/\/money\.example\.com\/recover\?token=[\w-]{43}/);
    withDb((db) => {
      expect(signIn(db, "alex@example.com").sessions).toBe(0);
      expect(signIn(db, "sam@example.com")).toEqual({ password: "old-hash", sessions: 1 });
      const actors = db.prepare("SELECT DISTINCT actor FROM audit_log").pluck().all();
      expect(actors).toContain("cli:reset-user");
      const link = db
        .prepare("SELECT issued_by, created_at, expires_at FROM re_enrolment_link")
        .get() as { issued_by: string; created_at: string; expires_at: string };
      expect(link.issued_by).toBe("cli:reset-user");
      expect(Date.parse(link.expires_at) - Date.parse(link.created_at)).toBe(24 * 3_600_000);
    });
  });

  it("reset-user for an unknown or missing person lists the people with a login, exit 1", async () => {
    await boot();
    withDb((db) => addLogin(db, "alex@example.com", "Alex"));
    const unknown = await cli(["reset-user", "nobody@example.com"]);
    expect(unknown.code).toBe(EXIT_FAILED);
    expect(unknown.err).toContain("No person with a login matches");
    expect(unknown.err).toContain("People with a login:\n  Alex  alex@example.com");
    const none = await cli(["reset-user"]);
    expect(none.code).toBe(EXIT_FAILED);
    expect(none.err).toContain("Alex  alex@example.com");
  });

  it("reset-user on a stopped server runs in-process under the lock, with the same result", async () => {
    await boot();
    withDb((db) => addLogin(db, "alex@example.com", "Alex"));
    await stop();
    const result = await cli(["reset-user", "ALEX@example.com"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toMatch(/https:\/\/money\.example\.com\/recover\?token=[\w-]{43}/);
    withDb((db) => {
      expect(signIn(db, "alex@example.com").sessions).toBe(0);
      const actors = db.prepare("SELECT DISTINCT actor FROM audit_log").pluck().all();
      expect(actors).toContain("cli:reset-user");
    });
    // The lock is free again: the server starts.
    await boot();

    await stop();
    const unknown = await cli(["reset-user", "nobody@example.com"]);
    expect(unknown).toMatchObject({ code: EXIT_FAILED, err: /Alex {2}alex@example\.com/ });
  });

  it("reset-user refuses when the lock is held but no socket answers, opening nothing", async () => {
    await boot();
    await stop();
    const lock = acquireDataDirLock(dataDir());
    try {
      const result = await cli(["reset-user", "alex@example.com"]);
      expect(result).toMatchObject({
        code: EXIT_FAILED,
        err: "pangolin: the server is running but its admin socket is unreachable",
      });
      expect(existsSync(join(dataDir(), "pangolin.sqlite-wal"))).toBe(false);
    } finally {
      lock.release();
    }
  });

  it("reset-user on a stopped server refuses a database behind this build", async () => {
    await boot();
    await stop();
    const migrationsDir = join(dir, "migrations");
    cpSync(packageMigrationsDir, migrationsDir, { recursive: true });
    const journalPath = join(migrationsDir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries.push({ idx: journal.entries.length, tag: "0099_next" });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(join(migrationsDir, "0099_next.sql"), "CREATE TABLE next (id INTEGER) STRICT;");
    const result = await cli(["reset-user", "alex@example.com"], migrationsDir);
    expect(result.code).toBe(EXIT_FAILED);
    expect(result.err).toMatch(/start the server once to migrate/);
  });

  it("reset-user with no database says the server never ran here", async () => {
    mkdirSync(dataDir());
    const result = await cli(["reset-user", "alex@example.com"]);
    expect(result).toMatchObject({ code: EXIT_FAILED, err: /never run here/ });
  });
});
