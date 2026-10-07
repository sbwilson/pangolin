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
  BACKUP_CHECK_JOB,
  BACKUP_DRILL_JOB,
  backupProgress,
  backupStatus,
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
  verifySnapshot,
} from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupPaths } from "../backup/paths.ts";
import { createDrillRig, type DrillRig } from "../testing/backup-drill.ts";
import type { StubRestic } from "../testing/restic.ts";
import { createJobs, EXTERNAL_EFFECT_KINDS, JOB_KINDS } from "./index.ts";
import { createRunner, type Runner } from "./runner.ts";

let dir: string;
let dataDir: string;
let db: Db;
let uow: UnitOfWork;
let stub: StubRestic;
let rig: DrillRig;
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
  rig = createDrillRig({
    dataDir,
    stubDir: join(dir, "stub"),
    uow,
    clock,
    newId,
    viewer: systemViewer("cli:backup"),
  });
  stub = rig.stub;
  now = start;
  ms = now.epochMilliseconds;
});

afterEach(() => {
  delete process.env.STUB_RESTIC_FAIL;
  delete process.env.STUB_RESTIC_HANG;
  delete process.env.STUB_RESTIC_PIDFILE;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const runner = (configured = true, pushTimeoutMs?: number): Runner =>
  rig.runner(configured, pushTimeoutMs);

const staging = () => readdirSync(backupPaths(dataDir).stagingRoot).sort();

const cli = () => rig.cli();

function jobRows() {
  return db
    .prepare("SELECT kind, status, dedupe_key, run_at FROM job ORDER BY created_at, id")
    .all();
}

describe("the backup jobs", () => {
  it("registers every kind, and only the push has external effects", () => {
    expect(JOB_KINDS.map((k) => k.kind)).toEqual([
      "backup-snapshot",
      "backup-push",
      "backup-check",
      "backup-drill",
      "closing-balance-sync",
    ]);
    expect(EXTERNAL_EFFECT_KINDS).toEqual(["backup-push"]);
    const jobs = createJobs({
      timezone: "UTC",
      dataDir,
      backup: stub.config,
      migrationsDir: packageMigrationsDir,
    });
    expect(jobs.kinds.map((r) => r.kind.kind)).toEqual(JOB_KINDS.map((k) => k.kind));
  });

  it("schedules the closing-balance sync always, and the backup, check and drill in household time only when a repository is set", () => {
    const r = runner();
    r.ensureSchedules();
    // 2026-09-27 00:00Z is Sunday 10:00 in Sydney (AEST): the next 02:30 is 2026-09-27T16:30Z;
    // the next Sunday 03:30 is 2026-10-04 (AEDT, UTC+11, the day the clocks go forward); the
    // next 1st at 04:00 is 2026-10-01 (AEST); the closing-balance sync is the next 00:05.
    expect(jobRows()).toEqual([
      {
        kind: "closing-balance-sync",
        status: "pending",
        dedupe_key: "schedule:closing-balance-daily",
        run_at: "2026-09-27T14:05:00.000Z",
      },
      {
        kind: "backup-snapshot",
        status: "pending",
        dedupe_key: "schedule:backup-nightly",
        run_at: "2026-09-27T16:30:00.000Z",
      },
      {
        kind: "backup-check",
        status: "pending",
        dedupe_key: "schedule:backup-check-weekly",
        run_at: "2026-10-03T16:30:00.000Z",
      },
      {
        kind: "backup-drill",
        status: "pending",
        dedupe_key: "schedule:backup-drill-monthly",
        run_at: "2026-09-30T18:00:00.000Z",
      },
    ]);
    db.exec("DELETE FROM job");
    runner(false).ensureSchedules();
    expect(jobRows()).toEqual([
      {
        kind: "closing-balance-sync",
        status: "pending",
        dedupe_key: "schedule:closing-balance-daily",
        run_at: "2026-09-27T14:05:00.000Z",
      },
    ]);
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
    // Format 2, balances taken on the household's today.
    expect(manifest).toMatchObject({ format: 2, balanceDate: "2026-09-27" });

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

  it("keeps at most one earlier snapshot awaiting its push, and drops partial ones, before staging", async () => {
    const r = runner();
    process.env.STUB_RESTIC_FAIL = "backup";
    const first = requestBackup(cli());
    await r.tick(); // snapshot 1
    await r.tick(); // push 1 fails and waits to retry
    const second = requestBackup(cli());
    await r.tick(); // snapshot 2: snapshot 1 still awaits its push, and is the newest such
    await r.tick(); // push 2 fails
    expect(staging()).toEqual([first, second].sort());
    // Left by an attempt that died mid-snapshot.
    mkdirSync(join(backupPaths(dataDir).stagingRoot, `${first}X.partial`));
    const third = requestBackup(cli());
    await r.tick(); // snapshot 3 keeps only snapshot 2 beside it
    expect(staging()).toEqual([second, third].sort());
  });

  it("removes older staged snapshots after a push; their own pushes then finish as superseded", async () => {
    const r = runner();
    process.env.STUB_RESTIC_FAIL = "backup";
    const first = requestBackup(cli());
    await r.tick();
    await r.tick(); // push 1 fails and waits a minute to retry
    const second = requestBackup(cli());
    await r.tick(); // snapshot 2
    delete process.env.STUB_RESTIC_FAIL;
    await r.tick(); // push 2 (push 1 is not due yet) succeeds
    expect(backupProgress({ uow }, { jobId: second })).toMatchObject({ state: "done" });
    expect(staging()).toEqual([]);
    now = now.add({ hours: 2 });
    await r.tick(); // push 1: its snapshot is gone, and a newer one is pushed
    expect(
      db
        .prepare("SELECT status FROM job WHERE payload = ?")
        .pluck()
        .get(JSON.stringify({ backupId: first })),
    ).toBe("done");
    expect(listReviewItems({ ...cli(), viewer: systemViewer("job:runner") }, {})).toEqual([]);
    expect(lastBackup({ uow })).toMatchObject({
      snapshotId: (backupProgress({ uow }, { jobId: second }) as { snapshotId: string }).snapshotId,
    });
  });

  /** Puts a finished job back as pending, as a run that died just before marking it done. */
  const rerun = (kind: string) =>
    db
      .prepare(
        `UPDATE job SET status = 'pending', finished_at = NULL, lease_owner = NULL,
           lease_expires_at = NULL, run_at = ? WHERE kind = ?`,
      )
      .run(now.toString({ fractionalSecondDigits: 3 }), kind);
  const snapshotRows = () =>
    db.prepare("SELECT * FROM backup_snapshot ORDER BY id").all() as Record<string, unknown>[];

  it("re-running the snapshot after it was recorded changes nothing", async () => {
    const r = runner();
    const jobId = requestBackup(cli());
    await r.tick(); // snapshot
    const before = snapshotRows();
    expect(before).toHaveLength(1);
    rerun("backup-snapshot");
    await r.tick(); // the snapshot again (a no-op), and the push
    expect(snapshotRows()).toHaveLength(1);
    // The row is kept as it was (the push then marks it); it never held a count or a digest.
    expect(snapshotRows()[0]).toMatchObject({
      id: before[0]?.id,
      taken_at: before[0]?.taken_at,
      schema_version: before[0]?.schema_version,
      push_job_id: before[0]?.push_job_id,
    });
    expect(Object.keys(snapshotRows()[0] ?? {}).sort()).toEqual([
      "created_at",
      "id",
      "push_job_id",
      "pushed_at",
      "restic_snapshot_id",
      "schema_version",
      "taken_at",
      "updated_at",
    ]);
    expect(staging()).toEqual([]); // the no-op snapshot staged nothing new and the push emptied staging
    expect(backupProgress({ uow }, { jobId })).toMatchObject({ state: "done" });
    expect(db.prepare("SELECT count(*) FROM job WHERE kind = 'backup-push'").pluck().get()).toBe(1);
  });

  it("re-running the push after it was recorded pushes nothing twice", async () => {
    const r = runner();
    const jobId = requestBackup(cli());
    await r.tick();
    await r.tick();
    const pushed = snapshotRows();
    const { snapshotId } = backupProgress({ uow }, { jobId }) as { snapshotId: string };
    rerun("backup-push");
    await r.tick();
    expect(snapshotRows()).toEqual(pushed);
    expect(readdirSync(join(stub.repoDir, "snapshots"))).toEqual([snapshotId]);
    expect(staging()).toEqual([]);
    expect(db.prepare("SELECT status FROM job WHERE kind = 'backup-push'").pluck().get()).toBe(
      "done",
    );
  });

  it("pushes with the snapshot's time, so restic orders snapshots by when they were taken", async () => {
    const r = runner();
    const jobId = requestBackup(cli());
    await r.tick();
    await r.tick();
    const { snapshotId } = backupProgress({ uow }, { jobId }) as { snapshotId: string };
    const meta = JSON.parse(
      readFileSync(join(stub.repoDir, "snapshots", snapshotId, "meta.json"), "utf8"),
    ) as { time: string };
    // To the second: restic's --time has no fraction.
    expect(meta.time).toBe(`${lastBackup({ uow })?.takenAt.slice(0, 19)}.000Z`);
  });

  it("kills restic when a push runs past its timeout, and the attempt fails as timed out", async () => {
    const r = runner(true, 2000);
    requestBackup(cli());
    await r.tick();
    const pidFile = join(dir, "restic.pid");
    process.env.STUB_RESTIC_HANG = "backup";
    process.env.STUB_RESTIC_PIDFILE = pidFile;
    await r.tick();
    const push = db
      .prepare("SELECT status, attempts, last_error FROM job WHERE kind = 'backup-push'")
      .get();
    expect(push).toEqual({
      status: "pending",
      attempts: 1,
      last_error: "JobTimeout: Timed out after 2000 ms",
    });
    const pid = Number(readFileSync(pidFile, "utf8"));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 100 && alive(); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(alive()).toBe(false);
  });
  describe("the check and the restore drill", () => {
    const backUp = (r: Runner) => rig.backUp(r);
    const run = (r: Runner, kind: typeof BACKUP_CHECK_JOB | typeof BACKUP_DRILL_JOB) =>
      rig.run(r, kind);

    const verifications = () =>
      db.prepare("SELECT kind, ok, summary FROM backup_verification ORDER BY at, rowid").all() as {
        kind: string;
        ok: number;
        summary: string;
      }[];
    const openItems = () =>
      listReviewItems({ ...cli(), viewer: systemViewer("job:runner") }, {}).map((i) => i.kind);
    const drillDirs = () =>
      readdirSync(backupPaths(dataDir).backupDir).filter((name) => name.startsWith("drill-"));
    const jobStatus = (kind: string) =>
      db
        .prepare("SELECT status FROM job WHERE kind = ? ORDER BY created_at DESC")
        .pluck()
        .get(kind);

    it("records a passing check and shows it in the backup status", async () => {
      const r = runner();
      await backUp(r);
      await run(r, BACKUP_CHECK_JOB);
      expect(verifications()).toEqual([
        { kind: "check", ok: 1, summary: "the repository check found no errors" },
      ]);
      expect(jobStatus("backup-check")).toBe("done");
      expect(backupStatus({ uow, clock }, true)).toMatchObject({
        check: { ok: true },
        drill: null,
        stale: false,
      });
      expect(openItems()).toEqual([]);
      expect(
        db
          .prepare("SELECT actor FROM audit_log WHERE entity = 'backup_verification'")
          .pluck()
          .all(),
      ).toEqual(["job:backup-check"]);
    });

    it("records a failing check once in the review inbox, however often it fails, and resolves it on a pass", async () => {
      const r = runner();
      await backUp(r);
      process.env.STUB_RESTIC_FAIL = "check";
      await run(r, BACKUP_CHECK_JOB);
      await run(r, BACKUP_CHECK_JOB);
      expect(verifications().map((v) => v.ok)).toEqual([0, 0]);
      // Only the kind of check: restic's own text stays out of the status and the audit log.
      expect(verifications()[0]?.summary).toBe("the repository check failed");
      expect(backupStatus({ uow, clock }, true).check?.summary).toBe("the repository check failed");
      // A verdict, not a crash: the job is done and is not retried or dead.
      expect(jobStatus("backup-check")).toBe("done");
      expect(openItems()).toEqual(["system.backup-verification-failed"]);
      expect(backupStatus({ uow, clock }, true).check).toMatchObject({ ok: false });
      delete process.env.STUB_RESTIC_FAIL;
      await run(r, BACKUP_CHECK_JOB);
      expect(openItems()).toEqual([]);
      expect(verifications().map((v) => v.ok)).toEqual([0, 0, 1]);
    });

    it("does nothing without a repository or before the first backup", async () => {
      await run(runner(false), BACKUP_CHECK_JOB);
      await run(runner(false), BACKUP_DRILL_JOB);
      expect(verifications()).toEqual([]);
      const r = runner();
      await run(r, BACKUP_CHECK_JOB);
      await run(r, BACKUP_DRILL_JOB);
      expect(verifications()).toEqual([]);
    });

    /** A runner whose check and drill attempts time out after 300 ms. */
    function shortRunner(): Runner {
      const jobs = createJobs({
        timezone: "UTC",
        dataDir,
        backup: stub.config,
        migrationsDir: packageMigrationsDir,
      });
      return createRunner({
        uow,
        clock,
        newId,
        kinds: jobs.kinds.map((k) =>
          k.kind.kind === "backup-check" || k.kind.kind === "backup-drill"
            ? { ...k, kind: { ...k.kind, timeoutMs: 300 } }
            : k,
        ),
        schedules: [],
        leaseMs: 60_000,
        log: () => {},
      });
    }

    it("lets a check that could not run retry, without recording a verdict", async () => {
      await backUp(runner());
      process.env.STUB_RESTIC_HANG = "check";
      process.env.STUB_RESTIC_PIDFILE = join(dir, "check.pid");
      await run(shortRunner(), BACKUP_CHECK_JOB);
      expect(verifications()).toEqual([]);
      expect(
        db.prepare("SELECT status, attempts FROM job WHERE kind = 'backup-check'").get(),
      ).toEqual({ status: "pending", attempts: 1 });
    });

    it("lets a drill that could not run retry, records no verdict, and leaves no directory", async () => {
      await backUp(runner());
      process.env.STUB_RESTIC_HANG = "restore";
      process.env.STUB_RESTIC_PIDFILE = join(dir, "restore.pid");
      await run(shortRunner(), BACKUP_DRILL_JOB);
      expect(verifications()).toEqual([]);
      expect(
        db.prepare("SELECT status, attempts FROM job WHERE kind = 'backup-drill'").get(),
      ).toEqual({ status: "pending", attempts: 1 });
      // The runner fails the attempt at the timeout; the aborted handler removes its directory
      // as soon as restic is gone.
      for (let i = 0; i < 100 && drillDirs().length > 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(drillDirs()).toEqual([]);
      expect(openItems()).toEqual([]);
    });

    it("restores the latest snapshot into a temporary directory, verifies it, and removes it, touching no live file", async () => {
      const attachments = join(dataDir, "attachments");
      mkdirSync(attachments);
      writeFileSync(join(attachments, "abc"), "encrypted blob");
      const r = runner();
      await backUp(r);
      const before = readdirSync(dataDir).sort();
      await run(r, BACKUP_DRILL_JOB);
      const [drill] = verifications();
      expect(drill).toMatchObject({ kind: "drill", ok: 1 });
      expect(drill?.summary).toMatch(/^restored snapshot [0-9a-f]{8} and verified the restore$/);
      expect(drillDirs()).toEqual([]);
      // Nothing was swapped: the same entries, and the live attachment is as it was.
      expect(readdirSync(dataDir).sort()).toEqual(before);
      expect(readFileSync(join(attachments, "abc"), "utf8")).toBe("encrypted blob");
      expect(readdirSync(dataDir).filter((n) => n.startsWith("pre-restore-"))).toEqual([]);
      expect(backupStatus({ uow, clock }, true).drill).toMatchObject({ ok: true });
      expect(openItems()).toEqual([]);
    });

    const storedDatabase = (snapshotId: string) => rig.storedDatabase(snapshotId);

    const auditRows = () =>
      db
        .prepare("SELECT * FROM audit_log WHERE entity = 'backup_verification' ORDER BY at, rowid")
        .all();

    it("fails the drill naming the failed verification check, removes its directory, and raises the review item", async () => {
      const r = runner();
      const snapshotId = await backUp(r);
      writeFileSync(storedDatabase(snapshotId), "this is not a database");
      await run(r, BACKUP_DRILL_JOB);
      const [drill] = verifications();
      expect(drill).toMatchObject({ kind: "drill", ok: 0 });
      expect(drill?.summary).toBe(
        `the integrity check failed on snapshot ${snapshotId.slice(0, 8)}`,
      );
      expect(drillDirs()).toEqual([]);
      expect(openItems()).toEqual(["system.backup-verification-failed"]);
      expect(jobStatus("backup-drill")).toBe("done");
    });

    it("keeps a private account's ID, counts and figures out of a failed drill's summary, status and audit row", async () => {
      const privateId = "01PRIVATEACCOUNT0000000001";
      db.prepare(
        "INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at) VALUES (?, 'Secret', 'transaction', 'AUD', 1, 't', 't')",
      ).run(privateId);
      db.prepare(
        `INSERT INTO "transaction" (id, account_id, posted_on, amount_cents, description_raw, status, fingerprint, fingerprint_version, created_at, updated_at)
         VALUES ('01PRIVATETX', ?, '2026-09-01', 4242424, 'd', 'posted', 'fp', 1, 't', 't')`,
      ).run(privateId);
      const r = runner();
      const snapshotId = await backUp(r);
      // The stored copy's private account no longer sums to what its manifest says.
      const stored = openDatabase(storedDatabase(snapshotId));
      stored.prepare('UPDATE "transaction" SET amount_cents = amount_cents + 3131313').run();
      stored.close();
      await run(r, BACKUP_DRILL_JOB);

      const expected = `the manifest check failed on snapshot ${snapshotId.slice(0, 8)}`;
      expect(verifications()).toEqual([{ kind: "drill", ok: 0, summary: expected }]);
      expect(backupStatus({ uow, clock }, true).drill).toMatchObject({
        ok: false,
        summary: expected,
      });
      const audit = JSON.stringify(auditRows());
      expect(audit).toContain(expected);
      for (const text of [JSON.stringify(verifications()), audit]) {
        expect(text).not.toContain(privateId);
        expect(text).not.toContain("cents");
        // The original figure, the delta and the altered sum: digits no ULID or hex prefix holds.
        for (const figure of ["4242424", "3131313", "7373737"]) expect(text).not.toContain(figure);
      }
      expect(openItems()).toEqual(["system.backup-verification-failed"]);

      // The operator's path still gets the detailed message.
      const manifest = parseManifest(
        readFileSync(join(storedDatabase(snapshotId), "..", "manifest.json"), "utf8"),
      );
      const verdict = verifySnapshot(
        storedDatabase(snapshotId),
        manifest,
        loadMigrations(packageMigrationsDir),
      );
      expect(verdict).toMatchObject({ ok: false, check: "manifest" });
      expect(verdict.ok ? "" : verdict.message).toContain(privateId);
    });

    it("fails the drill when the restore fails, removes its directory, and resolves on the next pass", async () => {
      const r = runner();
      await backUp(r);
      process.env.STUB_RESTIC_FAIL = "restore";
      await run(r, BACKUP_DRILL_JOB);
      expect(verifications()[0]).toMatchObject({ kind: "drill", ok: 0 });
      // No restic text, in the table, the status or the audit row.
      expect(verifications()[0]?.summary).toBe("the restore check failed");
      expect(backupStatus({ uow, clock }, true).drill?.summary).toBe("the restore check failed");
      const audit = auditRows() as { action: string; after: string | null }[];
      expect(JSON.stringify(audit)).not.toContain("restic restore exited");
      expect(JSON.stringify(audit)).toContain("the restore check failed");
      const recorded = audit.filter((row) => row.action === "record");
      expect(
        recorded.map((row) => (JSON.parse(row.after ?? "null") as { summary: string }).summary),
      ).toEqual(["the restore check failed"]);
      expect(drillDirs()).toEqual([]);
      expect(openItems()).toEqual(["system.backup-verification-failed"]);
      delete process.env.STUB_RESTIC_FAIL;
      await run(r, BACKUP_DRILL_JOB);
      expect(verifications().map((v) => v.ok)).toEqual([0, 1]);
      expect(openItems()).toEqual([]);
    });

    it("removes a directory an earlier drill left when it died", async () => {
      const r = runner();
      await backUp(r);
      const left = join(backupPaths(dataDir).backupDir, "drill-left-behind");
      mkdirSync(join(left, "deep"), { recursive: true });
      await run(r, BACKUP_DRILL_JOB);
      expect(drillDirs()).toEqual([]);
    });

    it("a stale backup shows in the status, and a new backup clears it", async () => {
      const r = runner();
      r.ensureSchedules();
      expect(backupStatus({ uow, clock }, true).stale).toBe(false);
      now = now.add({ hours: 49 });
      expect(backupStatus({ uow, clock }, true)).toMatchObject({ stale: true, last: null });
      // Before a push the nightly and the others are due; run only a manual backup.
      const jobId = requestBackup(cli());
      for (let i = 0; i < 4 && backupProgress({ uow }, { jobId }).state !== "done"; i++) {
        await r.tick();
      }
      expect(backupStatus({ uow, clock }, true).stale).toBe(false);
      now = now.add({ hours: 49 });
      expect(backupStatus({ uow, clock }, true).stale).toBe(true);
    });
  });
});
