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
import {
  backupProgress,
  createIdGenerator,
  fixedClockAt,
  lastBackup,
  requestBackup,
  systemClock,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Config, DEFAULT_JOBS_CONFIG, defaultAuthConfig } from "../config.ts";
import { createJobs, createRunner } from "../jobs/index.ts";
import { addLogin } from "../testing/logins.ts";
import { type StubRestic, stubRestic } from "../testing/restic.ts";
import { acquireDataDirLock } from "./lock.ts";
import { type CredentialChoice, type RestoreResult, restoreStopped } from "./restore.ts";

let dir: string;
let dataDir: string;
let stub: StubRestic;
let config: Config;
let snapshotId: string;
let out: string[];
const NOW = Date.parse("2026-09-27T03:00:00Z");

function people(db: Db): string[] {
  return db.prepare("SELECT display_name FROM person ORDER BY id").pluck().all() as string[];
}

function addPerson(db: Db, id: string, name: string): void {
  db.prepare(
    "INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at) VALUES (?, NULL, ?, '#112233', 't', 't')",
  ).run(id, name);
}

/** The live database, opened only while the "stack" runs. */
function withLive<T>(fn: (db: Db) => T): T {
  const db = openDatabase(join(dataDir, "pangolin.sqlite"));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Runs a backup to completion on a running "server"; returns restic's snapshot ID. */
async function backUp(db: Db): Promise<string> {
  const uow = createUnitOfWork(db);
  const clock = systemClock("UTC", () => fixedClockAt("2026-09-27").now());
  let ms = 0;
  const newId = createIdGenerator({ now: () => Date.now() + ++ms, random: Math.random });
  const runner = createRunner({
    uow,
    clock,
    newId,
    ...createJobs({
      timezone: "UTC",
      dataDir,
      backup: config.backup,
      migrationsDir: packageMigrationsDir,
    }),
    log: () => {},
  });
  const jobId = requestBackup({ viewer: systemViewer("cli:backup"), clock, newId, uow });
  await runner.tick();
  await runner.tick();
  const progress = backupProgress({ uow }, { jobId });
  if (progress.state !== "done") throw new Error(`backup ${progress.state}`);
  return progress.snapshotId;
}

function restore(
  ref = "latest",
  migrationsDir = packageMigrationsDir,
  credentials: () => Promise<CredentialChoice> = async () => "keep",
): Promise<RestoreResult> {
  return restoreStopped(ref, {
    config,
    credentials,
    migrationsDir,
    out: (line) => out.push(line),
    now: () => NOW,
  });
}

/** The pushed database file inside the stub repository. */
function pushedDb(): string {
  const tree = join(stub.repoDir, "snapshots", snapshotId, "tree");
  const staging = join(tree, dataDir, "backup", "staging");
  const [id] = readdirSync(staging);
  return join(staging, id as string, "pangolin.sqlite");
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-restore-"));
  dataDir = join(dir, "data");
  mkdirSync(join(dataDir, "attachments"), { recursive: true });
  writeFileSync(join(dataDir, "attachments", "receipt"), "backed-up blob");
  stub = stubRestic(join(dir, "stub"));
  config = {
    dataDir,
    port: 0,
    demo: false,
    jobs: DEFAULT_JOBS_CONFIG,
    auth: defaultAuthConfig(dataDir),
    trustedProxies: [],
    adminSocket: null,
    version: "test",
    backup: stub.config,
  };
  out = [];
  const db = openDatabase(join(dataDir, "pangolin.sqlite"));
  try {
    migrate(db, loadMigrations(packageMigrationsDir));
    addPerson(db, "P1", "Alex");
    // A push waiting from before the backup, and an unrelated local job: only the push has
    // external effects.
    db.exec(`INSERT INTO job (id, kind, lane, payload, dedupe_key, status, attempts, max_attempts,
               run_at, created_at, updated_at)
             VALUES ('OLDPUSH', 'backup-push', 'net', '{"backupId":"GONE"}', NULL, 'pending', 0, 6,
               '2099-01-01T00:00:00.000Z', 't', 't'),
                    ('LOCAL', 'test-local', 'local', '{}', NULL, 'pending', 0, 1,
               '2099-01-01T00:00:00.000Z', 't', 't')`);
    snapshotId = await backUp(db);
  } finally {
    db.close();
  }
  // Life goes on after the backup.
  withLive((db) => addPerson(db, "P2", "Sam"));
  writeFileSync(join(dataDir, "attachments", "receipt"), "newer blob");
  writeFileSync(join(dataDir, "attachments", "later"), "added after");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("restoreStopped", () => {
  it("verifies the snapshot, swaps it in and cancels pending jobs with external effects", async () => {
    const result = await restore();
    expect(result).toMatchObject({ ok: true, snapshotId, cancelled: 1 });
    if (!result.ok) throw new Error("unreachable");
    const migrations = loadMigrations(packageMigrationsDir);
    expect(result.schemaVersion).toBe(migrations.length);
    const stamp = "2026-09-27T03-00-00-000Z-[0-9a-f]{6}";
    expect(result.preRestoreDir).toMatch(new RegExp(`^${join(dataDir, `pre-restore-${stamp}`)}$`));
    expect(out).toEqual([
      expect.stringMatching(
        new RegExp(`^Fetching snapshot latest into ${join(dataDir, `restore-${stamp}`)} …$`),
      ),
      expect.stringMatching(
        new RegExp(`^Restored snapshot ${snapshotId.slice(0, 8)} \\(taken .+\\); verifying …$`),
      ),
      "integrity_check: ok",
      expect.stringMatching(/^Manifest: all \d+ tables match \(\d+ rows\)$/),
    ]);

    withLive((db) => {
      expect(people(db)).toEqual(["Alex"]);
      const jobs = db
        .prepare(
          "SELECT id, status, last_error FROM job WHERE id IN ('OLDPUSH', 'LOCAL') ORDER BY id",
        )
        .all();
      expect(jobs).toEqual([
        { id: "LOCAL", status: "pending", last_error: null },
        { id: "OLDPUSH", status: "dead", last_error: "restored" },
      ]);
      expect(db.prepare("SELECT actor, action FROM audit_log WHERE entity = 'job'").all()).toEqual([
        { actor: "cli:restore", action: "cancel-for-restore" },
      ]);
      // Status shows the snapshot the data came from as the last backup.
      expect(lastBackup({ uow: createUnitOfWork(db) })).toMatchObject({
        snapshotId,
        takenAt: "2026-09-27T00:00:00.000Z",
      });
    });
    expect(readFileSync(join(dataDir, "attachments", "receipt"), "utf8")).toBe("backed-up blob");
    expect(existsSync(join(dataDir, "attachments", "later"))).toBe(false);

    // The replaced files are kept; the restore directory is gone.
    const pre = openDatabase(join(result.preRestoreDir, "pangolin.sqlite"), { readonly: true });
    expect(pre.prepare("SELECT display_name FROM person ORDER BY id").pluck().all()).toEqual([
      "Alex",
      "Sam",
    ]);
    pre.close();
    expect(readFileSync(join(result.preRestoreDir, "attachments", "later"), "utf8")).toBe(
      "added after",
    );
    expect(readdirSync(dataDir).filter((name) => name.startsWith("restore-"))).toEqual([]);
  });

  it("restores a snapshot named by an ID prefix", async () => {
    expect(await restore(snapshotId.slice(0, 10))).toMatchObject({ ok: true, snapshotId });
    expect(await restore("0000")).toMatchObject({
      ok: false,
      failed: "fetch",
      message: "No snapshot 0000 in the repository",
    });
  });

  it("swaps nothing when the integrity check fails", async () => {
    const file = pushedDb();
    const bytes = readFileSync(file);
    for (let i = 4096; i < bytes.length; i++) bytes[i] = 0x5a;
    writeFileSync(file, bytes);
    expect(await restore()).toMatchObject({ ok: false, failed: "integrity" });
    expectUntouched();
  });

  it("swaps nothing when a table's count or checksum differs from the manifest", async () => {
    const raw = openDatabase(pushedDb());
    raw.exec("DELETE FROM person");
    // Back to a rollback journal, as the snapshot was written.
    raw.pragma("journal_mode = DELETE");
    raw.close();
    expect(await restore()).toEqual({
      ok: false,
      failed: "manifest",
      message: "table person has 0 rows; the manifest says 1",
    });
    expectUntouched();
  });

  it("swaps nothing when the snapshot's schema is newer than this build", async () => {
    const older = join(dir, "older-migrations");
    cpSync(packageMigrationsDir, older, { recursive: true });
    const journal = JSON.parse(readFileSync(join(older, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const last = journal.entries.pop();
    rmSync(join(older, `${last?.tag}.sql`));
    writeFileSync(join(older, "meta", "_journal.json"), JSON.stringify(journal));
    expect(await restore("latest", older)).toMatchObject({
      ok: false,
      failed: "schema",
      message: expect.stringContaining("newer than this build"),
    });
    expectUntouched();
  });

  it("puts the previous database back when migrating the swapped-in one fails", async () => {
    const broken = join(dir, "broken-migrations");
    cpSync(packageMigrationsDir, broken, { recursive: true });
    const journalFile = join(broken, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalFile, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries.push({ idx: journal.entries.length, tag: "9999_broken" });
    writeFileSync(journalFile, JSON.stringify(journal));
    writeFileSync(join(broken, "9999_broken.sql"), "CREATE TABLE nope (;");
    expect(await restore("latest", broken)).toMatchObject({
      ok: false,
      failed: "swap",
      message: expect.stringContaining("the previous database is back in place"),
    });
    expectUntouched();
    expect(readFileSync(join(dataDir, "attachments", "receipt"), "utf8")).toBe("newer blob");
  });

  it("refuses, touching nothing, while another process holds the data directory", async () => {
    const lock = acquireDataDirLock(dataDir);
    try {
      expect(await restore()).toMatchObject({ ok: false, failed: "lock" });
    } finally {
      lock.release();
    }
    expectUntouched();
  });

  it("refuses when backups are not configured", async () => {
    config = { ...config, backup: { ...config.backup, repository: null } };
    expect(await restore()).toMatchObject({ ok: false, failed: "config" });
    expectUntouched();
  });
});

describe("restoreStopped: credentials (story 1.16)", () => {
  let alexUser: string;
  let bobUser: string;
  let alexPerson: string;
  let bobPerson: string;

  const userOf = (db: Db, email: string) =>
    db.prepare("SELECT id FROM auth_user WHERE email = ?").pluck().get(email) as string;

  function addCredentials(db: Db, user: string, person: string, tag: string): void {
    db.prepare(
      `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
       VALUES (?, ?, 'pk', ?, 0, 'single', 0)`,
    ).run(`pk-${tag}`, user, `cred-${tag}`);
    db.prepare(
      "INSERT INTO auth_two_factor (id, user_id, secret, backup_codes) VALUES (?, ?, ?, '[]')",
    ).run(`tf-${tag}`, user, `secret-${tag}`);
    db.prepare(
      "INSERT INTO recovery_code (id, person_id, code_hash, created_at) VALUES (?, ?, ?, 't')",
    ).run(`rc-${tag}`, person, `hash-${tag}`);
    db.prepare("UPDATE auth_user SET two_factor_enabled = 1 WHERE id = ?").run(user);
  }

  /** A snapshot with two logins, then a reset of Alex's (as `reset-user` leaves it). */
  async function arrange(): Promise<void> {
    await withLiveAsync(async (db) => {
      alexPerson = addLogin(db, "alex@example.com", "Alex login");
      bobPerson = addLogin(db, "bob@example.com", "Bob login");
      alexUser = userOf(db, "alex@example.com");
      bobUser = userOf(db, "bob@example.com");
      addCredentials(db, alexUser, alexPerson, "alex-snap");
      addCredentials(db, bobUser, bobPerson, "bob-snap");
      db.prepare(
        `INSERT INTO re_enrolment_link (id, person_id, issued_by, token_hash, created_at, expires_at, used_at)
         VALUES ('link-snap', ?, 'cli:reset-user', 'th-snap', 't', '2099-01-01T00:00:00.000Z', 't')`,
      ).run(bobPerson);
      snapshotId = await backUp(db);
    });
    withLive((db) => {
      for (const table of ["auth_passkey", "auth_two_factor", "auth_session"]) {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(alexUser);
      }
      db.prepare("DELETE FROM recovery_code WHERE person_id = ?").run(alexPerson);
      db.prepare("UPDATE auth_user SET two_factor_enabled = 0 WHERE id = ?").run(alexUser);
      db.prepare("UPDATE auth_account SET password = 'reset-hash' WHERE user_id = ?").run(alexUser);
      db.prepare(
        `INSERT INTO re_enrolment_link (id, person_id, issued_by, token_hash, created_at, expires_at)
         VALUES ('link-now', ?, 'cli:reset-user', 'th-now', 't', '2099-01-01T00:00:00.000Z')`,
      ).run(alexPerson);
    });
  }

  async function withLiveAsync(fn: (db: Db) => Promise<void>): Promise<void> {
    const db = openDatabase(join(dataDir, "pangolin.sqlite"));
    try {
      await fn(db);
    } finally {
      db.close();
    }
  }

  /** What a login can sign in with, and what it holds. */
  function state(db: Db, userId: string, personId: string) {
    const count = (sql: string, id: string) => db.prepare(sql).pluck().get(id) as number;
    return {
      password: db
        .prepare("SELECT password FROM auth_account WHERE user_id = ?")
        .pluck()
        .get(userId),
      twoFactorEnabled: db
        .prepare("SELECT two_factor_enabled FROM auth_user WHERE id = ?")
        .pluck()
        .get(userId),
      passkeys: count("SELECT count(*) FROM auth_passkey WHERE user_id = ?", userId),
      twoFactor: count("SELECT count(*) FROM auth_two_factor WHERE user_id = ?", userId),
      sessions: count("SELECT count(*) FROM auth_session WHERE user_id = ?", userId),
      recoveryCodes: count("SELECT count(*) FROM recovery_code WHERE person_id = ?", personId),
      links: db
        .prepare("SELECT id FROM re_enrolment_link WHERE person_id = ? ORDER BY id")
        .pluck()
        .all(personId),
    };
  }

  function recorded(db: Db) {
    return {
      audit: db
        .prepare(
          "SELECT actor, after FROM audit_log WHERE entity = 'restore' AND action = 'credentials'",
        )
        .all()
        .map((row) => {
          const { actor, after } = row as { actor: string; after: string };
          return { actor, after: JSON.parse(after) as unknown };
        }),
      items: db
        .prepare("SELECT kind, dedupe_key, person_id, account_id, resolved_at FROM review_item")
        .all(),
    };
  }

  it("keep: the current credentials survive, and the snapshot's are dropped", async () => {
    await arrange();
    const asked: string[] = [];
    const result = await restore(snapshotId, packageMigrationsDir, async () => {
      asked.push("asked");
      return "keep";
    });
    expect(result).toMatchObject({
      ok: true,
      credentials: { choice: "keep", carried: true, keptLogins: 2, clearedLogins: 0 },
    });
    expect(asked).toEqual(["asked"]);
    withLive((db) => {
      // Alex keeps what the reset left: the new password, no passkey, authenticator, session or
      // code, and the live re-enrolment link instead of none.
      expect(state(db, alexUser, alexPerson)).toEqual({
        password: "reset-hash",
        twoFactorEnabled: 0,
        passkeys: 0,
        twoFactor: 0,
        sessions: 0,
        recoveryCodes: 0,
        links: ["link-now"],
      });
      // Bob had nothing changed since: the same current rows (the snapshot's link is replaced by the current rows).
      expect(state(db, bobUser, bobPerson)).toMatchObject({
        password: "old-hash",
        passkeys: 1,
        recoveryCodes: 1,
        links: ["link-snap"],
      });
      expect(recorded(db)).toEqual({
        audit: [
          {
            actor: "cli:restore",
            after: { choice: "keep", carried: true, keptLogins: 2, clearedLogins: 0 },
          },
        ],
        items: [
          {
            kind: "system.restored",
            dedupe_key: `system.restored:${snapshotId}`,
            person_id: null,
            account_id: null,
            resolved_at: null,
          },
        ],
      });
    });
  });

  it("keep: a login only the snapshot has loses its credentials", async () => {
    await arrange();
    // Bob is gone from the live database, so only the snapshot has him.
    withLive((db) => {
      db.prepare("DELETE FROM re_enrolment_link WHERE person_id = ?").run(bobPerson);
      db.prepare("UPDATE person SET user_id = NULL WHERE id = ?").run(bobPerson);
      db.prepare("DELETE FROM recovery_code WHERE person_id = ?").run(bobPerson);
      db.prepare("DELETE FROM auth_user WHERE id = ?").run(bobUser);
    });
    const result = await restore(snapshotId);
    expect(result).toMatchObject({
      ok: true,
      credentials: { choice: "keep", carried: true, keptLogins: 1, clearedLogins: 1 },
    });
    withLive((db) => {
      expect(state(db, bobUser, bobPerson)).toEqual({
        password: "old-hash",
        twoFactorEnabled: 0,
        passkeys: 0,
        twoFactor: 0,
        sessions: 0,
        recoveryCodes: 0,
        links: [],
      });
      expect(state(db, alexUser, alexPerson)).toMatchObject({
        password: "reset-hash",
        passkeys: 0,
      });
      expect(
        db
          .prepare("SELECT actor, after FROM audit_log WHERE entity = 'user' AND action = 'reset'")
          .all(),
      ).toEqual([
        {
          actor: "cli:restore",
          after: expect.stringContaining('"reason":"restore"'),
        },
      ]);
      expect(recorded(db).audit).toHaveLength(1);
      expect(recorded(db).items).toHaveLength(1);
    });
  });

  it("restore: the snapshot's credentials come back, and the choice and roll-back are recorded", async () => {
    await arrange();
    const result = await restore(snapshotId, packageMigrationsDir, async () => "restore");
    expect(result).toMatchObject({
      ok: true,
      credentials: { choice: "restore", carried: false, keptLogins: 0, clearedLogins: 0 },
    });
    withLive((db) => {
      expect(state(db, alexUser, alexPerson)).toEqual({
        password: "old-hash",
        twoFactorEnabled: 1,
        passkeys: 1,
        twoFactor: 1,
        sessions: 1,
        recoveryCodes: 1,
        links: [],
      });
      const { audit, items } = recorded(db);
      expect(audit).toEqual([
        {
          actor: "cli:restore",
          after: { choice: "restore", carried: false, keptLogins: 0, clearedLogins: 0 },
        },
      ]);
      expect(items).toHaveLength(1);
      expect(items).toMatchObject([{ kind: "system.restored" }]);
    });
  });

  it("keep copes with a replaced database that lacks credential tables (an older schema)", async () => {
    await arrange();
    withLive((db) => {
      db.exec("DROP TABLE recovery_code; DROP TABLE re_enrolment_link");
    });
    const result = await restore(snapshotId);
    expect(result).toMatchObject({ ok: true, credentials: { choice: "keep", keptLogins: 2 } });
    withLive((db) => {
      // Nothing current to carry: the snapshot's rows for those logins are dropped, not kept.
      expect(state(db, alexUser, alexPerson)).toMatchObject({
        password: "reset-hash",
        recoveryCodes: 0,
        links: [],
      });
      expect(state(db, bobUser, bobPerson)).toMatchObject({ recoveryCodes: 0, links: [] });
    });
  });

  it("onto a fresh data directory there is nothing to keep, so nothing is asked", async () => {
    await arrange();
    for (const name of ["pangolin.sqlite", "pangolin.sqlite-wal", "pangolin.sqlite-shm"]) {
      rmSync(join(dataDir, name), { force: true });
    }
    let asked = 0;
    const result = await restore(snapshotId, packageMigrationsDir, async () => {
      asked++;
      return "keep";
    });
    expect(asked).toBe(0);
    expect(result).toMatchObject({ ok: true, credentials: { choice: "restore", carried: false } });
    expect(out).toContain("No current database: the snapshot's sign-in details are restored.");
    withLive((db) => expect(state(db, alexUser, alexPerson)).toMatchObject({ passkeys: 1 }));
  });

  it("swaps nothing when the question gets no answer", async () => {
    await arrange();
    const result = await restore(snapshotId, packageMigrationsDir, async () => {
      throw new Error("no answer to the credentials question");
    });
    expect(result).toEqual({
      ok: false,
      failed: "credentials",
      message: "no answer to the credentials question; nothing was swapped in",
    });
    withLive((db) => {
      expect(state(db, alexUser, alexPerson)).toMatchObject({
        password: "reset-hash",
        passkeys: 0,
      });
      expect(db.prepare("SELECT count(*) FROM review_item").pluck().get()).toBe(0);
    });
    expect(
      readdirSync(dataDir).filter(
        (name) => name.startsWith("restore-") || name.startsWith("pre-restore-"),
      ),
    ).toEqual([]);
  });

  it("asks after verification: a snapshot that fails a check is never asked about", async () => {
    await arrange();
    const file = pushedDb();
    const bytes = readFileSync(file);
    for (let i = 4096; i < bytes.length; i++) bytes[i] = 0x5a;
    writeFileSync(file, bytes);
    let asked = 0;
    const result = await restore(snapshotId, packageMigrationsDir, async () => {
      asked++;
      return "keep";
    });
    expect(result).toMatchObject({ ok: false, failed: "integrity" });
    expect(asked).toBe(0);
  });
});

/** The live database and attachments as they were, and no restore or pre-restore directory. */
function expectUntouched(): void {
  withLive((db) => expect(people(db)).toEqual(["Alex", "Sam"]));
  expect(readFileSync(join(dataDir, "attachments", "later"), "utf8")).toBe("added after");
  expect(
    readdirSync(dataDir).filter(
      (name) => name.startsWith("restore-") || name.startsWith("pre-restore-"),
    ),
  ).toEqual([]);
}
