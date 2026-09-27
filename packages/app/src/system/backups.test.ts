import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { claimJob, completeJob, failJob } from "../jobs/lifecycle.ts";
import type { JobRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import {
  BACKUP_PUSH_JOB,
  BACKUP_SCHEDULE_NAME,
  BACKUP_SNAPSHOT_JOB,
  backupProgress,
  dailyAt,
  lastBackup,
  MANUAL_BACKUP_KEY,
  nightlyBackupSchedule,
  recordBackupPush,
  recordBackupSnapshot,
  requestBackup,
} from "./backups.ts";

const SHA = "a".repeat(64);
const RESTIC_1 = "1".repeat(64);
const RESTIC_2 = "2".repeat(64);

function setup() {
  const clock = manualClock("2026-09-27T00:00:00Z");
  const { ctx, uow } = memoryContext(systemViewer("cli:backup"), clock);
  return { clock, ctx, uow };
}

function claim(ctx: UseCaseContext, lane: JobRow["lane"]): JobRow {
  const job = claimJob(ctx, { lane, owner: "r", leaseMs: 60_000 });
  if (job === undefined) throw new Error(`nothing to claim in ${lane}`);
  return job;
}

function snapshotInput(id: string) {
  return {
    id,
    takenAt: "2026-09-27T00:00:00.000Z",
    schemaVersion: 6,
    tableCount: 15,
    rowCount: 120,
    manifestSha256: SHA,
  };
}

describe("the backup job kinds", () => {
  it("snapshot is local with no external effects; push is net with them; both need a person when dead", () => {
    expect(BACKUP_SNAPSHOT_JOB).toMatchObject({
      kind: "backup-snapshot",
      lane: "local",
      externalEffects: false,
      needsPersonWhenDead: true,
    });
    expect(BACKUP_PUSH_JOB).toMatchObject({
      kind: "backup-push",
      lane: "net",
      externalEffects: true,
      needsPersonWhenDead: true,
    });
    expect(BACKUP_SNAPSHOT_JOB.timeoutMs).toBeGreaterThan(0);
    expect(BACKUP_PUSH_JOB.timeoutMs).toBeGreaterThan(0);
  });
});

describe("dailyAt and the nightly schedule", () => {
  const at = (iso: string) => Temporal.Instant.from(iso);
  const next = dailyAt("Australia/Sydney", 2, 30);

  it("runs at 02:30 household time: today when still ahead, else tomorrow", () => {
    // 2026-07-01 is winter in Sydney: UTC+10.
    expect(next(at("2026-07-01T10:00:00Z")).toString()).toBe("2026-07-01T16:30:00Z");
    expect(next(at("2026-07-01T16:30:00Z")).toString()).toBe("2026-07-02T16:30:00Z");
    expect(next(at("2026-07-01T16:29:59Z")).toString()).toBe("2026-07-01T16:30:00Z");
    // Summer: UTC+11.
    expect(next(at("2026-12-01T00:00:00Z")).toString()).toBe("2026-12-01T15:30:00Z");
  });

  it("copes with 02:30 missing (clocks forward) and happening twice (clocks back)", () => {
    // Sydney jumps 02:00 → 03:00 on 2026-10-04: 02:30 does not exist, so 03:30 AEDT.
    expect(next(at("2026-10-03T12:00:00Z")).toString()).toBe("2026-10-03T16:30:00Z");
    // 03:00 → 02:00 on 2026-04-05: the first 02:30 (AEDT, UTC+11), once.
    const first = next(at("2026-04-04T12:00:00Z"));
    expect(first.toString()).toBe("2026-04-04T15:30:00Z");
    expect(next(first).toString()).toBe("2026-04-05T16:30:00Z");
  });

  it("refuses an unknown time zone; the schedule's payload is a scheduled snapshot", () => {
    expect(() => dailyAt("Mars/Olympus", 2, 30)).toThrow(RangeError);
    const schedule = nightlyBackupSchedule("UTC");
    expect(schedule).toMatchObject({
      name: BACKUP_SCHEDULE_NAME,
      kind: BACKUP_SNAPSHOT_JOB,
      payload: { trigger: "schedule" },
    });
    expect(schedule.next(at("2026-09-27T03:00:00Z")).toString()).toBe("2026-09-28T02:30:00Z");
  });
});

describe("requestBackup", () => {
  it("enqueues a manual snapshot job, and a second request joins it while it is live", () => {
    const { ctx, uow } = setup();
    const first = requestBackup(ctx);
    expect(requestBackup(ctx)).toBe(first);
    expect(uow.state.jobs).toEqual([
      expect.objectContaining({
        id: first,
        kind: "backup-snapshot",
        lane: "local",
        dedupeKey: MANUAL_BACKUP_KEY,
        payload: JSON.stringify({ trigger: "manual" }),
      }),
    ]);
    expect(uow.state.audit.map((row) => [row.actor, row.entity, row.action])).toEqual([
      ["cli:backup", "backup", "request"],
      ["cli:backup", "backup", "request"],
    ]);
    // Once it has finished, a new request starts a new backup.
    const job = claim(ctx, "local");
    completeJob(ctx, { job, owner: "r", schedules: [] });
    expect(requestBackup(ctx)).not.toBe(first);
  });
});

describe("recording a backup", () => {
  it("records the snapshot and enqueues its push once; the push records restic's ID", () => {
    const { ctx, uow, clock } = setup();
    const jobCtx = { ...ctx, viewer: systemViewer("job:backup-snapshot") };
    const row = recordBackupSnapshot(jobCtx, snapshotInput("SNAP1"));
    expect(row).toMatchObject({ id: "SNAP1", resticSnapshotId: null, pushedAt: null });
    expect(recordBackupSnapshot(jobCtx, { ...snapshotInput("SNAP1"), rowCount: 1 })).toEqual(row);
    const pushes = uow.state.jobs.filter((job) => job.kind === "backup-push");
    expect(pushes).toEqual([
      expect.objectContaining({
        id: row.pushJobId,
        lane: "net",
        payload: JSON.stringify({ backupId: "SNAP1" }),
        dedupeKey: "backup-push:SNAP1",
      }),
    ]);
    expect(backupProgress(ctx, { jobId: "SNAP1" })).toEqual({
      state: "running",
      step: "push",
      retrying: false,
    });
    expect(lastBackup(ctx)).toBeNull();

    clock.advance(60_000);
    const pushCtx = { ...ctx, viewer: systemViewer("job:backup-push") };
    const pushed = recordBackupPush(pushCtx, { id: "SNAP1", resticSnapshotId: RESTIC_1 });
    expect(pushed.row).toMatchObject({
      resticSnapshotId: RESTIC_1,
      pushedAt: "2026-09-27T00:01:00.000Z",
    });
    // A retried push after a lost completion keeps the first ID.
    expect(
      recordBackupPush(pushCtx, { id: "SNAP1", resticSnapshotId: RESTIC_2 }).row.resticSnapshotId,
    ).toBe(RESTIC_1);
    expect(backupProgress(ctx, { jobId: "SNAP1" })).toEqual({
      state: "done",
      snapshotId: RESTIC_1,
      pushedAt: "2026-09-27T00:01:00.000Z",
    });
    expect(lastBackup(ctx)).toEqual({
      snapshotId: RESTIC_1,
      takenAt: "2026-09-27T00:00:00.000Z",
      pushedAt: "2026-09-27T00:01:00.000Z",
    });
    expect(uow.state.audit.map((a) => [a.actor, a.entity, a.action])).toEqual([
      ["job:backup-snapshot", "backup_snapshot", "create"],
      ["job:backup-push", "backup_snapshot", "push"],
    ]);
    expect(() => recordBackupPush(pushCtx, { id: "NOPE", resticSnapshotId: RESTIC_1 })).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    expect(() =>
      recordBackupSnapshot(jobCtx, { ...snapshotInput("X"), manifestSha256: "no" }),
    ).toThrow(expect.objectContaining({ code: "Validation" }));
  });

  it("lists as removable only staged snapshots that are pushed or whose push finished", () => {
    const { ctx } = setup();
    for (const id of ["A", "B", "C", "D"]) recordBackupSnapshot(ctx, snapshotInput(id));
    // A was pushed; B's push dies; C's is still pending; D is the one being pushed now.
    const a = claim(ctx, "net");
    recordBackupPush(ctx, { id: "A", resticSnapshotId: RESTIC_1 });
    completeJob(ctx, { job: a, owner: "r", schedules: [] });
    const b = claim(ctx, "net");
    expect(JSON.parse(b.payload)).toEqual({ backupId: "B" });
    failJob(ctx, {
      job: b,
      owner: "r",
      kind: BACKUP_PUSH_JOB,
      error: "x",
      permanent: true,
      schedules: [],
    });
    const { removable } = recordBackupPush(ctx, {
      id: "D",
      resticSnapshotId: RESTIC_2,
      staged: ["A", "B", "C", "D", "UNKNOWN"],
    });
    expect(removable).toEqual(["A", "B", "D"]);
  });
});

describe("backupProgress", () => {
  it("follows the snapshot job, then the push, and reports where it failed", () => {
    const { ctx, clock } = setup();
    const jobId = requestBackup(ctx);
    expect(backupProgress(ctx, { jobId })).toEqual({
      state: "running",
      step: "snapshot",
      retrying: false,
    });
    const snap = claim(ctx, "local");
    failJob(ctx, { job: snap, owner: "r", kind: BACKUP_SNAPSHOT_JOB, error: "x", schedules: [] });
    expect(backupProgress(ctx, { jobId })).toEqual({
      state: "running",
      step: "snapshot",
      retrying: true,
    });
    clock.advance(60 * 60_000);
    const again = claim(ctx, "local");
    failJob(ctx, {
      job: again,
      owner: "r",
      kind: BACKUP_SNAPSHOT_JOB,
      error: "x",
      permanent: true,
      schedules: [],
    });
    expect(backupProgress(ctx, { jobId })).toEqual({ state: "failed", step: "snapshot" });

    const second = requestBackup(ctx);
    const job = claim(ctx, "local");
    recordBackupSnapshot(ctx, snapshotInput(second));
    completeJob(ctx, { job, owner: "r", schedules: [] });
    const push = claim(ctx, "net");
    failJob(ctx, {
      job: push,
      owner: "r",
      kind: BACKUP_PUSH_JOB,
      error: "x",
      permanent: true,
      schedules: [],
    });
    expect(backupProgress(ctx, { jobId: second })).toEqual({ state: "failed", step: "push" });

    // A snapshot job that finished without a snapshot (backups were turned off) failed.
    const third = requestBackup(ctx);
    completeJob(ctx, { job: claim(ctx, "local"), owner: "r", schedules: [] });
    expect(backupProgress(ctx, { jobId: third })).toEqual({ state: "failed", step: "snapshot" });

    expect(() => backupProgress(ctx, { jobId: push.id })).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    expect(() => backupProgress(ctx, { jobId: "missing" })).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
  });
});
