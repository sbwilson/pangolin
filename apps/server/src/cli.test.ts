import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, loadMigrations, openDatabase, packageMigrationsDir } from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireDataDirLock } from "./admin/lock.ts";
import { EXIT_FAILED, EXIT_NOT_RUNNING, EXIT_OK, EXIT_USAGE, runCli } from "./cli.ts";
import {
  type BackupConfig,
  DEFAULT_BACKUP_CONFIG,
  DEFAULT_JOBS_CONFIG,
  defaultAuthConfig,
} from "./config.ts";
import { type RunningServer, startServer } from "./server.ts";
import { addLogin, signIn } from "./testing/logins.ts";
import { stubRestic } from "./testing/restic.ts";

let dir: string;
let server: RunningServer | undefined;
/** The backup settings the server and the CLI both read; none unless a test sets them. */
let backup: BackupConfig = DEFAULT_BACKUP_CONFIG;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-cli-"));
  backup = DEFAULT_BACKUP_CONFIG;
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
      backup,
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
      PANGOLIN_BACKUP_REPOSITORY: backup.repository ?? "",
      PANGOLIN_RESTIC_PASSWORD_FILE: backup.passwordFile,
      PANGOLIN_RESTIC_BIN: backup.resticBin,
    },
    migrationsDir,
    pollMs: 20,
    io: { out: (text) => out.push(text), err: (text) => err.push(text) },
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("pangolin (the admin CLI)", () => {
  it("prints help, and refuses a missing or unknown command as usage", async () => {
    expect(await cli(["--help"])).toMatchObject({ code: EXIT_OK, out: /reset-user/ });
    expect(await cli([])).toMatchObject({ code: EXIT_USAGE, err: /name a command/ });
    expect(await cli(["prune"])).toMatchObject({ code: EXIT_USAGE, err: /unknown command/ });
    expect(await cli(["backup", "now"])).toMatchObject({ code: EXIT_USAGE });
    expect(await cli(["restore", "a", "b"])).toMatchObject({ code: EXIT_USAGE });
    expect(await cli(["restore", "../etc"])).toMatchObject({ code: EXIT_USAGE });
    expect(await cli(["status", "extra"])).toMatchObject({ code: EXIT_USAGE });
    expect(await cli(["reset-user", "a", "b"])).toMatchObject({ code: EXIT_USAGE });
  });

  it("status on a running server prints readiness and job state, exit 0", async () => {
    await boot();
    const result = await cli(["status"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain("Pangolin Money v1.2.3");
    const schema = loadMigrations(packageMigrationsDir).length;
    expect(result.out).toContain(`Schema:    ${schema} (this build expects ${schema})`);
    expect(result.out).toMatch(/Readiness: ok/);
    expect(result.out).toMatch(/Jobs: +\d+ pending, \d+ running, 0 dead/);
  });

  it("status on a server that is not ready shows the failing checks and dead jobs, exit 1", async () => {
    const running = await boot();
    withDb((db) => {
      const insert = db.prepare(
        `INSERT INTO job (id, kind, lane, payload, status, attempts, max_attempts, run_at,
           created_at, updated_at, finished_at)
         VALUES (?, 'test-dead', 'local', '{}', 'dead', 1, 1, ?, ?, ?, ?)`,
      );
      for (let i = 0; i < 51; i++) {
        const at = `2026-09-27T00:00:${String(i).padStart(2, "0")}.000Z`;
        insert.run(`01J00000000000000000000${String(i).padStart(3, "0")}`, at, at, at, at);
      }
    });
    // A stopped runner fails the jobs check.
    await running.runner?.stop();
    const result = await cli(["status"]);
    expect(result.code).toBe(EXIT_FAILED);
    expect(result.out).toContain("Readiness: not ready (failing: jobs)");
    expect(result.out).toMatch(/Jobs: +\d+ pending, \d+ running, 51 dead/);
    expect(result.out).toContain("Dead jobs (newest 50 of 51):");
    expect(result.out).toContain("  2026-09-27T00:00:50.000Z  test-dead");
    expect(result.out).not.toContain("2026-09-27T00:00:00.000Z");
  });

  it("status says the socket is unreachable while the data directory is locked, exit 1", async () => {
    await boot();
    await stop();
    const lock = acquireDataDirLock(dataDir());
    try {
      expect(await cli(["status"])).toMatchObject({
        code: EXIT_FAILED,
        err: "pangolin: the server is running but its admin socket is unreachable",
      });
    } finally {
      lock.release();
    }
    // Free again: stopped, and the probe left the lock free.
    expect(await cli(["status"])).toMatchObject({
      code: EXIT_NOT_RUNNING,
      out: "Pangolin is not running",
    });
    acquireDataDirLock(dataDir()).release();
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

// The server's runner ticks once a second, so each backup takes a couple of seconds.
describe("pangolin backup and restore", { timeout: 20_000 }, () => {
  it("backup refuses when no repository is configured, exit 1, and status says so", async () => {
    await boot();
    expect(await cli(["backup"])).toMatchObject({
      code: EXIT_FAILED,
      err: /Backups are not configured: set PANGOLIN_BACKUP_REPOSITORY/,
    });
    expect((await cli(["status"])).out).toContain(
      "Backups:   not configured (PANGOLIN_BACKUP_REPOSITORY is empty)",
    );
    // Nothing was enqueued, and no nightly schedule exists.
    expect(withDb((db) => db.prepare("SELECT COUNT(*) FROM job").pluck().get())).toBe(0);
  });

  it("backup on a stopped server says it is not running, exit 3", async () => {
    backup = stubRestic(join(dir, "stub")).config;
    mkdirSync(dataDir());
    expect(await cli(["backup"])).toMatchObject({ code: EXIT_NOT_RUNNING, out: /not running/ });
  });

  it("backup waits for the running server's jobs and prints the snapshot ID; status shows it", async () => {
    const stub = stubRestic(join(dir, "stub"));
    backup = stub.config;
    await boot();
    expect((await cli(["status"])).out).toContain(
      "Backups:   none yet (nightly at 02:30, household time)",
    );
    // The nightly schedule's row waits for 02:30.
    expect(
      withDb((db) =>
        db.prepare("SELECT dedupe_key FROM job WHERE status = 'pending'").pluck().all(),
      ),
    ).toEqual(["schedule:backup-nightly"]);
    const result = await cli(["backup"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(EXIT_OK);
    const id = /snapshot ([0-9a-f]{64})$/m.exec(result.out)?.[1];
    expect(id).toBeDefined();
    expect(result.out).toMatch(/^Backup \w+ started$/m);
    expect((await cli(["status"])).out).toMatch(
      new RegExp(`^Backups:   last at \\S+, snapshot ${id}$`, "m"),
    );
    expect(
      withDb((db) =>
        db
          .prepare("SELECT actor FROM audit_log WHERE entity LIKE 'backup%' ORDER BY rowid")
          .pluck()
          .all(),
      ),
    ).toEqual(["cli:backup", "job:backup-snapshot", "job:backup-push"]);
  });

  it("backup stops waiting after its limit, exit 1, while the backup goes on", async () => {
    backup = stubRestic(join(dir, "stub")).config;
    await boot();
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(["backup"], {
      env: {
        PANGOLIN_DATA_DIR: dataDir(),
        PANGOLIN_ADMIN_SOCKET: socketPath(),
        PANGOLIN_PUBLIC_URL: PUBLIC_URL,
        PANGOLIN_BACKUP_REPOSITORY: backup.repository ?? "",
        PANGOLIN_RESTIC_PASSWORD_FILE: backup.passwordFile,
        PANGOLIN_RESTIC_BIN: backup.resticBin,
      },
      migrationsDir: packageMigrationsDir,
      pollMs: 20,
      backupWaitMs: 0,
      io: { out: (text) => out.push(text), err: (text) => err.push(text) },
    });
    expect(code).toBe(EXIT_FAILED);
    expect(err.join("\n")).toContain("the backup is still running; check `pangolin status`");
  });

  it("backup reports a push that died, exit 1", async () => {
    backup = stubRestic(join(dir, "stub")).config;
    await boot();
    // An empty password file: the push fails and waits to retry.
    rmSync(backup.passwordFile);
    writeFileSync(backup.passwordFile, "");
    const done = cli(["backup"]);
    const pushStatus = () =>
      withDb((db) =>
        db.prepare("SELECT status, attempts FROM job WHERE kind = 'backup-push'").get(),
      ) as { status: string; attempts: number } | undefined;
    for (let i = 0; i < 200; i++) {
      const push = pushStatus();
      if (push?.status === "pending" && push.attempts > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // Let the CLI see it waiting to retry, then its retries run out (as if an hour had passed).
    await new Promise((resolve) => setTimeout(resolve, 200));
    withDb((db) =>
      db
        .prepare(
          "UPDATE job SET status = 'dead', finished_at = '2026-09-27T01:00:00.000Z' WHERE kind = 'backup-push'",
        )
        .run(),
    );
    expect(await done).toMatchObject({
      code: EXIT_FAILED,
      err: /the backup failed \(pushing it\)/,
    });
    expect((await done).out).toContain(
      "Pushing it with restic (an attempt failed; it will retry) …",
    );
  });

  it("restore on a stopped stack swaps in the latest backup; on a running one it refuses", async () => {
    backup = stubRestic(join(dir, "stub")).config;
    await boot();
    withDb((db) => addLogin(db, "alex@example.com", "Alex"));
    expect((await cli(["backup"])).code).toBe(EXIT_OK);
    const refused = await cli(["restore"]);
    expect(refused).toMatchObject({ code: EXIT_FAILED, err: /Another process holds/ });
    await stop();
    withDb((db) => db.prepare("DELETE FROM person").run());
    const result = await cli(["restore", "latest"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain("integrity_check: ok");
    expect(result.out).toMatch(/Manifest: all \d+ tables match/);
    expect(result.out).toMatch(/Swapped in snapshot [0-9a-f]{64}; the replaced files are in /);
    expect(result.out).toContain("Cancelled 0 pending jobs with external effects");
    expect(withDb((db) => db.prepare("SELECT COUNT(*) FROM person").pluck().get())).toBe(1);
  });

  it("restore of a snapshot that fails a check exits 1 naming it, and swaps nothing", async () => {
    const stub = stubRestic(join(dir, "stub"));
    backup = stub.config;
    await boot();
    expect((await cli(["backup"])).code).toBe(EXIT_OK);
    await stop();
    // Truncate every pushed database file.
    const tree = join(stub.repoDir, "snapshots");
    for (const snap of readdirSync(tree)) {
      const staging = join(tree, snap, "tree", dataDir(), "backup", "staging");
      for (const id of readdirSync(staging))
        writeFileSync(join(staging, id, "pangolin.sqlite"), "junk");
    }
    const result = await cli(["restore"]);
    expect(result).toMatchObject({
      code: EXIT_FAILED,
      err: /the integrity check failed: [\s\S]*Nothing was swapped in/,
    });
  });
});
