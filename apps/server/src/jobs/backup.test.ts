import {
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
  type Clock,
  createIdGenerator,
  fixedClockAt,
  lastBackup,
  listReviewItems,
  requestBackup,
  systemClock,
  type UnitOfWork,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
  parseManifest,
} from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupPaths } from "../backup/paths.ts";
import { DEFAULT_BACKUP_CONFIG } from "../config.ts";
import { type StubRestic, stubRestic } from "../testing/restic.ts";
import { createJobs, EXTERNAL_EFFECT_KINDS, JOB_KINDS } from "./index.ts";
import { createRunner, type Runner } from "./runner.ts";

let dir: string;
let dataDir: string;
let db: Db;
let uow: UnitOfWork;
let stub: StubRestic;
const start = fixedClockAt("2026-09-27").now();
let now = start;
const clock: Clock = systemClock("UTC", () => now);
let ms: number;
const newId = createIdGenerator({ now: () => ++ms, random: Math.random });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-backup-jobs-"));
  dataDir = join(dir, "data");
  mkdirSync(dataDir);
  db = openDatabase(join(dataDir, "pangolin.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  uow = createUnitOfWork(db);
  stub = stubRestic(join(dir, "stub"));
  now = start;
  ms = now.epochMilliseconds;
});

afterEach(() => {
  delete process.env.STUB_RESTIC_FAIL;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function runner(configured = true): Runner {
  const jobs = createJobs({
    timezone: "Australia/Sydney",
    dataDir,
    backup: configured ? stub.config : DEFAULT_BACKUP_CONFIG,
  });
  return createRunner({ uow, clock, newId, ...jobs, leaseMs: 60_000, log: () => {} });
}

const cli = () => ({ viewer: systemViewer("cli:backup"), clock, newId, uow });

function jobRows() {
  return db
    .prepare("SELECT kind, status, dedupe_key, run_at FROM job ORDER BY created_at, id")
    .all();
}

describe("the backup jobs", () => {
  it("registers every kind, and only the push has external effects", () => {
    expect(JOB_KINDS.map((k) => k.kind)).toEqual(["backup-snapshot", "backup-push"]);
    expect(EXTERNAL_EFFECT_KINDS).toEqual(["backup-push"]);
    const jobs = createJobs({ timezone: "UTC", dataDir, backup: stub.config });
    expect(jobs.kinds.map((r) => r.kind.kind)).toEqual(JOB_KINDS.map((k) => k.kind));
  });

  it("schedules the nightly backup at 02:30 household time only when a repository is set", () => {
    const r = runner();
    r.ensureSchedules();
    // 2026-09-27 00:00Z is 10:00 in Sydney (AEST): the next 02:30 is 2026-09-27T16:30Z.
    expect(jobRows()).toEqual([
      {
        kind: "backup-snapshot",
        status: "pending",
        dedupe_key: "schedule:backup-nightly",
        run_at: "2026-09-27T16:30:00.000Z",
      },
    ]);
    db.exec("DELETE FROM job");
    runner(false).ensureSchedules();
    expect(jobRows()).toEqual([]);
  });

  it("takes a snapshot, pushes it with the attachments, records it and empties the staging directory", async () => {
    const attachments = join(dataDir, "attachments");
    mkdirSync(attachments);
    writeFileSync(join(attachments, "abc"), "encrypted blob");
    const r = runner();
    const jobId = requestBackup(cli());
    await r.tick(); // snapshot (local), which enqueues the push
    expect(backupProgress({ uow }, { jobId })).toMatchObject({ state: "running", step: "push" });
    const staged = join(backupPaths(dataDir).stagingRoot, jobId);
    const manifest = parseManifest(readFileSync(join(staged, "manifest.json"), "utf8"));
    expect(manifest.tables.find((t) => t.name === "job")?.rows).toBe(1);

    await r.tick(); // push (net)
    const progress = backupProgress({ uow }, { jobId });
    expect(progress).toMatchObject({ state: "done" });
    const snapshotId = (progress as { snapshotId: string }).snapshotId;
    expect(lastBackup({ uow })?.snapshotId).toBe(snapshotId);
    expect(readdirSync(backupPaths(dataDir).stagingRoot)).toEqual([]);
    // Restic's cache is on the data volume, beside the staging directory.
    expect(existsSync(backupPaths(dataDir).cacheDir)).toBe(true);
    const meta = JSON.parse(
      readFileSync(join(stub.repoDir, "snapshots", snapshotId, "meta.json"), "utf8"),
    ) as { paths: string[]; tags: string[]; hostname: string };
    expect(meta).toMatchObject({
      paths: [staged, attachments],
      tags: ["pangolin"],
      hostname: "pangolin",
    });
    const pushedDb = join(stub.repoDir, "snapshots", snapshotId, "tree", staged, "pangolin.sqlite");
    expect(existsSync(pushedDb)).toBe(true);
    expect(db.prepare("SELECT actor, entity, action FROM audit_log ORDER BY rowid").all()).toEqual([
      { actor: "cli:backup", entity: "backup", action: "request" },
      { actor: "job:backup-snapshot", entity: "backup_snapshot", action: "create" },
      { actor: "job:backup-push", entity: "backup_snapshot", action: "push" },
    ]);
  });

  it("retries a failing push, then leaves it dead with a job.dead review item", async () => {
    const r = runner();
    const jobId = requestBackup(cli());
    await r.tick();
    process.env.STUB_RESTIC_FAIL = "backup";
    for (let attempt = 1; attempt <= 6; attempt++) {
      await r.tick();
      now = now.add({ hours: 2 });
    }
    expect(backupProgress({ uow }, { jobId })).toEqual({ state: "failed", step: "push" });
    const push = db
      .prepare("SELECT status, attempts, last_error FROM job WHERE kind = 'backup-push'")
      .get() as { status: string; attempts: number; last_error: string };
    expect(push).toMatchObject({ status: "dead", attempts: 6 });
    expect(push.last_error).toContain("restic backup exited with 1");
    const items = listReviewItems({ ...cli(), viewer: systemViewer("job:runner") }, {});
    expect(items.map((item) => item.kind)).toEqual(["job.dead"]);
    expect(lastBackup({ uow })).toBeNull();

    // The next backup succeeds and cleans up the dead one's staging directory too.
    delete process.env.STUB_RESTIC_FAIL;
    const next = requestBackup(cli());
    await r.tick();
    await r.tick();
    expect(backupProgress({ uow }, { jobId: next })).toMatchObject({ state: "done" });
    expect(readdirSync(backupPaths(dataDir).stagingRoot)).toEqual([]);
  });

  it("does nothing when backups are no longer configured", async () => {
    const jobId = requestBackup(cli());
    await runner(false).tick();
    expect(backupProgress({ uow }, { jobId })).toEqual({ state: "failed", step: "snapshot" });
    expect(existsSync(backupPaths(dataDir).stagingRoot)).toBe(false);
  });
});
