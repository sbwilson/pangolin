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
import {
  type CliOptions,
  EXIT_FAILED,
  EXIT_NOT_RUNNING,
  EXIT_OK,
  EXIT_USAGE,
  runCli,
} from "./cli.ts";
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
/** The server's recovery bundle id (`PANGOLIN_RECOVERY_BUNDLE_ID`); none unless a test sets it. */
let bundleId: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-cli-"));
  backup = DEFAULT_BACKUP_CONFIG;
  bundleId = undefined;
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
      ...(bundleId === undefined ? {} : { recoveryBundleId: bundleId }),
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

async function cli(
  argv: string[],
  migrationsDir = packageMigrationsDir,
  extra: Partial<Pick<CliOptions, "ask" | "interactive">> = {},
) {
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
      PANGOLIN_RECOVERY_BUNDLE_ID: bundleId ?? "",
    },
    migrationsDir,
    pollMs: 20,
    checkReachable: async () => {},
    interactive: false,
    ...extra,
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
    expect(await cli(["restore", "--nope"])).toMatchObject({ code: EXIT_USAGE });
    expect(await cli(["restore", "--keep-credentials", "--restore-credentials"])).toMatchObject({
      code: EXIT_USAGE,
      err: /choose one/,
    });
    expect(await cli(["restore", "--keep-credentials", "--keep-credentials"])).toMatchObject({
      code: EXIT_USAGE,
      err: /repeated option/,
    });
    expect(await cli(["restore", "--keep-credentials", "a", "b"])).toMatchObject({
      code: EXIT_USAGE,
    });
    expect(await cli(["status", "extra"])).toMatchObject({ code: EXIT_USAGE });
    expect(await cli(["reset-user", "a", "b"])).toMatchObject({ code: EXIT_USAGE });
    expect(await cli(["confirm-bundle", "now"])).toMatchObject({
      code: EXIT_USAGE,
      err: /confirm-bundle takes no arguments/,
    });
    expect(await cli(["seed", "path.json"])).toMatchObject({
      code: EXIT_USAGE,
      err: /seed takes no arguments/,
    });
    expect(await cli(["--help"])).toMatchObject({ out: /confirm-bundle/ });
    expect(await cli(["--help"])).toMatchObject({ out: /seed {26}load the demo seed/ });
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
    // Only the daily closing-balance sync is waiting; nothing runs and nothing is dead.
    expect(result.out).toMatch(/Jobs: +1 pending, 0 running, 0 dead/);
    expect(result.out).toMatch(/Pending jobs[^\n]*\n {2}\S+ {2}closing-balance-sync\n/);
    expect(result.out).not.toMatch(/Running jobs|Dead jobs/);
  });

  it("status lists the next pending jobs and the running ones, kind and time only", async () => {
    await boot();
    withDb((db) => {
      // Leave the schedule's own row out, so the count is the test's alone.
      db.prepare("DELETE FROM job WHERE dedupe_key = 'schedule:closing-balance-daily'").run();
      const insert = db.prepare(
        `INSERT INTO job (id, kind, lane, payload, status, attempts, max_attempts, run_at,
           lease_owner, lease_expires_at, created_at, updated_at)
         VALUES (?, ?, 'local', '{"secret":1}', ?, 0, 1, ?, ?, ?, ?, ?)`,
      );
      const created = "2026-09-27T00:00:00.000Z";
      for (let i = 0; i < 12; i++) {
        const runAt = `2099-01-01T00:00:${String(11 - i).padStart(2, "0")}.000Z`;
        const id = `01J00000000000000000000${String(i).padStart(3, "0")}`;
        insert.run(id, "test-pending", "pending", runAt, null, null, created, created);
      }
      insert.run(
        "01J00000000000000000000100",
        "test-running",
        "running",
        created,
        "elsewhere",
        "2099-01-01T00:05:00.000Z",
        created,
        created,
      );
    });
    const result = await cli(["status"]);
    expect(result.code).toBe(EXIT_OK);
    const lines = result.out.split("\n");
    const jobsAt = lines.findIndex((line) => line.startsWith("Jobs:"));
    expect(lines[jobsAt]).toMatch(/Jobs: +12 pending, 1 running, 0 dead/);
    expect(lines.slice(jobsAt + 1, jobsAt + 14)).toEqual([
      "Pending jobs (next 10 of 12):",
      ...Array.from(
        { length: 10 },
        (_, i) => `  2099-01-01T00:00:${String(i).padStart(2, "0")}.000Z  test-pending`,
      ),
      "Running jobs:",
      "  2099-01-01T00:05:00.000Z  test-running  (lease until)",
    ]);
    expect(result.out).not.toContain("2099-01-01T00:00:10.000Z");
    expect(result.out).not.toMatch(/secret|elsewhere|01J0000/);
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

  it("status warns of an unconfirmed recovery bundle yet exits 0; confirm-bundle ends it", async () => {
    bundleId = "20261003T010203Z-a1b2";
    await boot();
    const WARNING =
      "Warning:   recovery bundle not confirmed stored safely (run sudo pangolin confirm-bundle)";
    const before = await cli(["status"]);
    expect(before.code).toBe(EXIT_OK);
    expect(before.out).toMatch(/Readiness: ok/);
    expect(before.out).toContain(WARNING);

    expect(await cli(["confirm-bundle"])).toEqual({
      code: EXIT_OK,
      out: "Recovery bundle 20261003T010203Z-a1b2 confirmed stored safely",
      err: "",
    });
    const after = await cli(["status"]);
    expect(after.code).toBe(EXIT_OK);
    expect(after.out).not.toContain(WARNING);

    const again = await cli(["confirm-bundle"]);
    expect(again.code).toBe(EXIT_OK);
    expect(again.out).toMatch(
      /^Recovery bundle 20261003T010203Z-a1b2 was already confirmed stored safely \(at .+\)$/,
    );
    const audit = withDb((db) =>
      db
        .prepare("SELECT actor, entity, action FROM audit_log WHERE entity = 'recovery_bundle'")
        .all(),
    );
    expect(audit).toEqual([
      { actor: "cli:confirm-bundle", entity: "recovery_bundle", action: "confirm" },
    ]);

    // A new bundle (install.sh --bundle) has a new id: the warning is back until confirmed.
    await stop();
    bundleId = "20261104T050607Z-c3d4";
    await boot();
    const renewed = await cli(["status"]);
    expect(renewed.code).toBe(EXIT_OK);
    expect(renewed.out).toContain(WARNING);
  });

  it("confirm-bundle refuses with no bundle id set, exit 1, and status never warns", async () => {
    await boot();
    expect((await cli(["status"])).out).not.toContain("recovery bundle");
    const result = await cli(["confirm-bundle"]);
    expect(result.code).toBe(EXIT_FAILED);
    expect(result.err).toMatch(/^pangolin: no recovery bundle id is set/);
    const audited = withDb((db) =>
      db.prepare("SELECT count(*) FROM audit_log WHERE entity = 'recovery_bundle'").pluck().get(),
    );
    expect(audited).toBe(0);
  });

  it("confirm-bundle on a stopped server says it is not running, exit 3", async () => {
    bundleId = "20261003T010203Z-a1b2";
    expect(await cli(["confirm-bundle"])).toMatchObject({
      code: EXIT_NOT_RUNNING,
      out: "Pangolin is not running",
    });
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
    const status = (await cli(["status"])).out;
    expect(status).toContain("Backups:   not configured (PANGOLIN_BACKUP_REPOSITORY is empty)");
    expect(status).not.toMatch(/^(Check|Drill|Warning):/m);
    // Nothing was enqueued, and no nightly schedule exists: only the closing-balance sync waits.
    expect(withDb((db) => db.prepare("SELECT dedupe_key FROM job").pluck().all())).toEqual([
      "schedule:closing-balance-daily",
    ]);
  });

  it("backup fails before enqueueing when the backup server is unreachable", async () => {
    backup = stubRestic(join(dir, "stub")).config;
    await boot();
    const jobs = () => withDb((db) => db.prepare("SELECT COUNT(*) FROM job").pluck().get());
    const before = jobs();
    const err: string[] = [];
    const code = await runCli(["backup"], {
      env: {
        PANGOLIN_DATA_DIR: dataDir(),
        PANGOLIN_ADMIN_SOCKET: socketPath(),
        PANGOLIN_BACKUP_REPOSITORY: "rest:https://restic.example.test/x",
        PANGOLIN_RESTIC_PASSWORD_FILE: backup.passwordFile,
      },
      migrationsDir: packageMigrationsDir,
      checkReachable: async () => {
        throw new Error("Cannot reach the backup server restic.example.test:443 (no answer)");
      },
      io: { out: () => {}, err: (text) => err.push(text) },
    });
    expect(code).toBe(EXIT_FAILED);
    expect(err.join("\n")).toContain("Cannot reach the backup server restic.example.test:443");
    expect(jobs()).toBe(before);
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
    const first = (await cli(["status"])).out;
    expect(first).toContain("Backups:   none yet (nightly at 02:30, household time)");
    expect(first).toContain("Check:     no check yet");
    expect(first).toContain("Drill:     no restore drill yet");
    expect(first).not.toContain("Warning:");
    // The schedules' rows wait for 02:30, Sunday 03:30 and the 1st at 04:00.
    expect(
      withDb((db) =>
        db
          .prepare("SELECT dedupe_key FROM job WHERE status = 'pending' ORDER BY dedupe_key")
          .pluck()
          .all(),
      ),
    ).toEqual([
      "schedule:backup-check-weekly",
      "schedule:backup-drill-monthly",
      "schedule:backup-nightly",
      "schedule:closing-balance-daily",
    ]);
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

  it("status warns of a stale backup and shows a failed check and drill, yet still exits 0", async () => {
    backup = stubRestic(join(dir, "stub")).config;
    await boot();
    withDb((db) => {
      // Backups were first scheduled long ago, and none has been pushed since.
      db.prepare(
        "UPDATE job SET created_at = '2020-01-01T00:00:00.000Z' WHERE kind = 'backup-snapshot'",
      ).run();
      const insert = db.prepare(
        "INSERT INTO backup_verification (id, kind, at, ok, summary) VALUES (?, ?, ?, ?, ?)",
      );
      insert.run("V1", "check", "2026-09-27T03:30:00.000Z", 0, "restic check exited with 1");
      insert.run("V2", "drill", "2026-09-01T04:00:00.000Z", 1, "restored and verified");
    });
    const result = await cli(["status"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain("Readiness: ok");
    expect(result.out).toContain("Warning:   no good backup in the last 48 hours");
    expect(result.out).toContain(
      "Check:     FAILED at 2026-09-27T03:30:00.000Z: restic check exited with 1",
    );
    expect(result.out).toContain(
      "Drill:     passed at 2026-09-01T04:00:00.000Z: restored and verified",
    );
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
      checkReachable: async () => {},
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
    const refused = await cli(["restore", "--keep-credentials"]);
    expect(refused).toMatchObject({ code: EXIT_FAILED, err: /Another process holds/ });
    await stop();
    withDb((db) => db.prepare("DELETE FROM person").run());
    const result = await cli(["restore", "latest", "--restore-credentials"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain("integrity_check: ok");
    expect(result.out).toMatch(/Manifest: all \d+ tables match/);
    expect(result.out).toMatch(/Swapped in snapshot [0-9a-f]{64}; the replaced files are in /);
    expect(result.out).toContain("Credentials: the snapshot's sessions");
    expect(result.out).toContain("A review item records that the data was rolled back");
    expect(result.out).toContain("Cancelled 0 pending jobs with external effects");
    expect(withDb((db) => db.prepare("SELECT COUNT(*) FROM person").pluck().get())).toBe(1);
  });

  // Seam S10 (spike "Check the suspected seams"): real. After a restore, `status` prints the
  // restore's own time as "last at" (the push time the restore records), while staleness is
  // judged on the snapshot's `takenAt`. Restoring a snapshot older than 48 hours prints a
  // "last at" of just now beside the stale warning. The fix story turns this test on.
  it.fails("S10: status after a restore prints the snapshot's takenAt as last at", async () => {
    backup = stubRestic(join(dir, "stub")).config;
    await boot();
    expect((await cli(["backup"])).code).toBe(EXIT_OK);
    await stop();
    const restored = await cli(["restore", "--keep-credentials"]);
    expect(restored.code).toBe(EXIT_OK);
    const snapshot = /Swapped in snapshot ([0-9a-f]{64})/.exec(restored.out)?.[1];
    expect(snapshot).toBeDefined();
    // As if the restored snapshot had been taken five days ago (the server runs on the real clock).
    const takenAt = new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString();
    const updated = withDb(
      (db) =>
        db
          .prepare("UPDATE backup_snapshot SET taken_at = ? WHERE restic_snapshot_id = ?")
          .run(takenAt, snapshot).changes,
    );
    expect(updated).toBe(1);
    await boot();
    const out = (await cli(["status"])).out;
    expect(out).toContain("Warning:   no good backup in the last 48 hours");
    expect(out).toMatch(new RegExp(`^Backups:   last at ${takenAt}, snapshot ${snapshot}$`, "m"));
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
    const result = await cli(["restore", "--keep-credentials"]);
    expect(result).toMatchObject({
      code: EXIT_FAILED,
      err: /the integrity check failed: [\s\S]*Nothing was swapped in/,
    });
  });
  /** A backed-up login, then a stopped stack on which the login's password has been changed. */
  async function arrangeLogin(): Promise<void> {
    backup = stubRestic(join(dir, "stub")).config;
    await boot();
    withDb((db) => addLogin(db, "alex@example.com", "Alex"));
    expect((await cli(["backup"])).code).toBe(EXIT_OK);
    await stop();
    withDb((db) => {
      db.prepare("UPDATE auth_account SET password = 'reset-hash'").run();
      db.prepare("DELETE FROM auth_session").run();
    });
  }

  const alexState = () => withDb((db) => signIn(db, "alex@example.com"));

  it("restore with no flag asks, and k (or just Enter) keeps the current credentials", async () => {
    await arrangeLogin();
    const questions: string[] = [];
    const result = await cli(["restore"], packageMigrationsDir, {
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        return "";
      },
    });
    expect(result.err).toBe("");
    expect(result.code).toBe(EXIT_OK);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain("Keep or restore? [K/r]");
    expect(result.out).toContain("Credentials: the current ones kept for 1 login");
    expect(alexState()).toEqual({ password: "reset-hash", sessions: 0 });
  });

  it("answering r restores the snapshot's credentials", async () => {
    await arrangeLogin();
    const result = await cli(["restore"], packageMigrationsDir, {
      interactive: true,
      ask: async () => "R",
    });
    expect(result.code).toBe(EXIT_OK);
    expect(alexState()).toEqual({ password: "old-hash", sessions: 1 });
  });

  it("a flag restores or keeps without asking, even with no terminal", async () => {
    await arrangeLogin();
    const ask = async () => {
      throw new Error("must not ask");
    };
    expect(
      (await cli(["restore", "--restore-credentials"], packageMigrationsDir, { ask })).code,
    ).toBe(EXIT_OK);
    expect(alexState()).toEqual({ password: "old-hash", sessions: 1 });
    // The snapshot is back in place: keep now has nothing different to carry.
    expect((await cli(["restore", "--keep-credentials"], packageMigrationsDir, { ask })).code).toBe(
      EXIT_OK,
    );
    expect(alexState()).toEqual({ password: "old-hash", sessions: 1 });
  });

  it("with no terminal and no flag it refuses, touching nothing", async () => {
    await arrangeLogin();
    const result = await cli(["restore"]);
    expect(result).toMatchObject({ code: EXIT_USAGE, err: /no terminal to ask on/ });
    expect(alexState()).toEqual({ password: "reset-hash", sessions: 0 });
    expect(readdirSync(dataDir()).filter((name) => name.includes("restore-"))).toEqual([]);
  });

  it("asks again after a bad answer, and fails with nothing swapped in after three, or on no answer", async () => {
    await arrangeLogin();
    const answers = ["maybe", "r"];
    const again = await cli(["restore"], packageMigrationsDir, {
      interactive: true,
      ask: async () => answers.shift(),
    });
    expect(again.code).toBe(EXIT_OK);
    expect(again.err).toContain('"maybe" is not k or r');
    expect(alexState()).toEqual({ password: "old-hash", sessions: 1 });

    withDb((db) => db.prepare("UPDATE auth_account SET password = 'reset-hash'").run());
    for (const ask of [async () => "x", async () => undefined]) {
      const failed = await cli(["restore"], packageMigrationsDir, { interactive: true, ask });
      expect(failed).toMatchObject({ code: EXIT_FAILED, err: /nothing was swapped in/ });
      expect(alexState().password).toBe("reset-hash");
      expect(readdirSync(dataDir()).filter((name) => name.includes("restore-"))).toHaveLength(1);
    }
  });
});
