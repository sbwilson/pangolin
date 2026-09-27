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
import { type StubRestic, stubRestic } from "../testing/restic.ts";
import { acquireDataDirLock } from "./lock.ts";
import { type RestoreResult, restoreStopped } from "./restore.ts";

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
    ...createJobs({ timezone: "UTC", dataDir, backup: config.backup }),
    log: () => {},
  });
  const jobId = requestBackup({ viewer: systemViewer("cli:backup"), clock, newId, uow });
  await runner.tick();
  await runner.tick();
  const progress = backupProgress({ uow }, { jobId });
  if (progress.state !== "done") throw new Error(`backup ${progress.state}`);
  return progress.snapshotId;
}

function restore(ref = "latest", migrationsDir = packageMigrationsDir): Promise<RestoreResult> {
  return restoreStopped(ref, {
    config,
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
    expect(result.preRestoreDir).toBe(join(dataDir, "pre-restore-2026-09-27T03-00-00Z"));
    expect(out).toEqual([
      `Fetching snapshot latest into ${join(dataDir, "restore-2026-09-27T03-00-00Z")} …`,
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
