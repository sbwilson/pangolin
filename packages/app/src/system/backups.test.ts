import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { claimJob, completeJob, failJob } from "../jobs/lifecycle.ts";
import type { JobRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import {
  BACKUP_CHECK_JOB,
  BACKUP_DRILL_JOB,
  BACKUP_PUSH_JOB,
  BACKUP_SCHEDULE_NAME,
  BACKUP_SNAPSHOT_JOB,
  backupCheckSchedule,
  backupDrillSchedule,
  backupFreshness,
  backupProgress,
  backupStatus,
  dailyAt,
  lastBackup,
  MANUAL_BACKUP_KEY,
  monthlyAt,
  nightlyBackupSchedule,
  recordBackupPush,
  recordBackupSnapshot,
  recordBackupVerification,
  requestBackup,
  STALE_BACKUP_MS,
  weeklyAt,
} from "./backups.ts";
import { listReviewItems } from "./review-items.ts";

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
    expect(recordBackupSnapshot(jobCtx, { ...snapshotInput("SNAP1"), schemaVersion: 7 })).toEqual(
      row,
    );
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
    // The manifest's figures are no longer recorded: a caller passing them is refused.
    for (const dropped of [{ tableCount: 1 }, { rowCount: 1 }, { manifestSha256: SHA }]) {
      expect(() => recordBackupSnapshot(jobCtx, { ...snapshotInput("X"), ...dropped })).toThrow(
        expect.objectContaining({ code: "Validation" }),
      );
    }
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

describe("lastBackup", () => {
  it("is the pushed snapshot taken last, even when an older one's push finished later", () => {
    const { ctx, clock } = setup();
    recordBackupSnapshot(ctx, { ...snapshotInput("NEW"), takenAt: "2026-09-28T02:30:00.000Z" });
    recordBackupSnapshot(ctx, { ...snapshotInput("OLD"), takenAt: "2026-09-27T02:30:00.000Z" });
    recordBackupPush(ctx, { id: "NEW", resticSnapshotId: RESTIC_1 });
    clock.advance(60 * 60_000);
    recordBackupPush(ctx, { id: "OLD", resticSnapshotId: RESTIC_2 });
    expect(lastBackup(ctx)?.snapshotId).toBe(RESTIC_1);
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

describe("weeklyAt and monthlyAt", () => {
  const at = (iso: string) => Temporal.Instant.from(iso);
  const local = (instant: Temporal.Instant, zone: string) =>
    instant.toZonedDateTimeISO(zone).toString({ timeZoneName: "never" });

  it("runs Sundays at 03:30 household time, strictly after the given instant", () => {
    const next = weeklyAt("Australia/Sydney", 3, 30);
    // 2026-07-01 is a Wednesday; Sunday 2026-07-05 03:30 AEST is 2026-07-04T17:30Z.
    expect(next(at("2026-07-01T00:00:00Z")).toString()).toBe("2026-07-04T17:30:00Z");
    expect(next(at("2026-07-04T17:29:59Z")).toString()).toBe("2026-07-04T17:30:00Z");
    expect(next(at("2026-07-04T17:30:00Z")).toString()).toBe("2026-07-11T17:30:00Z");
  });

  it("keeps 03:30 local across the clocks changing on a Sunday, both ways", () => {
    const sydney = weeklyAt("Australia/Sydney", 3, 30);
    // Sunday 2026-10-04: 02:00 -> 03:00 (clocks forward); 03:30 is AEDT (UTC+11).
    const forward = sydney(at("2026-09-30T00:00:00Z"));
    expect(local(forward, "Australia/Sydney")).toBe("2026-10-04T03:30:00+11:00");
    // Sunday 2026-04-05: 03:00 -> 02:00 (clocks back); 03:30 is AEST (UTC+10), once.
    const back = sydney(at("2026-04-01T00:00:00Z"));
    expect(local(back, "Australia/Sydney")).toBe("2026-04-05T03:30:00+10:00");
    const newYork = weeklyAt("America/New_York", 3, 30);
    // Sunday 2026-03-08: 02:00 -> 03:00; Sunday 2026-11-01: 02:00 -> 01:00.
    expect(local(newYork(at("2026-03-04T00:00:00Z")), "America/New_York")).toBe(
      "2026-03-08T03:30:00-04:00",
    );
    expect(local(newYork(at("2026-10-28T00:00:00Z")), "America/New_York")).toBe(
      "2026-11-01T03:30:00-05:00",
    );
    // A time inside the gap runs just after the jump; inside the overlap, the first time.
    expect(
      local(weeklyAt("America/New_York", 2, 30)(at("2026-03-04T00:00:00Z")), "America/New_York"),
    ).toBe("2026-03-08T03:30:00-04:00");
    expect(
      local(weeklyAt("America/New_York", 1, 30)(at("2026-10-28T00:00:00Z")), "America/New_York"),
    ).toBe("2026-11-01T01:30:00-04:00");
  });

  it("runs at 04:00 on the 1st across month lengths and clock changes", () => {
    const next = monthlyAt("Australia/Sydney", 4, 0);
    expect(local(next(at("2026-01-15T00:00:00Z")), "Australia/Sydney")).toBe(
      "2026-02-01T04:00:00+11:00",
    );
    // From the 1st after 04:00 it is the next month; before it, the same day.
    expect(local(next(at("2026-02-01T00:00:00Z")), "Australia/Sydney")).toBe(
      "2026-03-01T04:00:00+11:00",
    );
    expect(local(next(at("2026-02-01T16:59:00Z")), "Australia/Sydney")).toBe(
      "2026-03-01T04:00:00+11:00",
    );
    expect(local(next(at("2026-02-28T12:00:00Z")), "Australia/Sydney")).toBe(
      "2026-03-01T04:00:00+11:00",
    );
    // Year end, and the 1st of April just as Sydney's clocks go back (2026-04-05, not the 1st).
    expect(local(next(at("2026-12-01T20:00:00Z")), "Australia/Sydney")).toBe(
      "2027-01-01T04:00:00+11:00",
    );
    expect(local(next(at("2026-03-20T00:00:00Z")), "Australia/Sydney")).toBe(
      "2026-04-01T04:00:00+11:00",
    );
    // Clocks change around the month's start: New York 2026-11-01 (the 1st, Sunday) 04:00 is EST.
    expect(
      local(monthlyAt("America/New_York", 4, 0)(at("2026-10-15T00:00:00Z")), "America/New_York"),
    ).toBe("2026-11-01T04:00:00-05:00");
  });

  it("refuses an unknown time zone; the schedules carry the check and drill kinds", () => {
    expect(() => weeklyAt("Mars/Olympus", 3, 30)).toThrow(RangeError);
    expect(() => monthlyAt("Mars/Olympus", 4, 0)).toThrow(RangeError);
    expect(backupCheckSchedule("UTC")).toMatchObject({
      name: "backup-check-weekly",
      kind: BACKUP_CHECK_JOB,
      payload: {},
    });
    expect(backupDrillSchedule("UTC")).toMatchObject({
      name: "backup-drill-monthly",
      kind: BACKUP_DRILL_JOB,
      payload: {},
    });
    // 2026-09-27 is a Sunday.
    expect(backupCheckSchedule("UTC").next(at("2026-09-27T03:00:00Z")).toString()).toBe(
      "2026-09-27T03:30:00Z",
    );
    expect(backupDrillSchedule("UTC").next(at("2026-09-27T03:00:00Z")).toString()).toBe(
      "2026-10-01T04:00:00Z",
    );
  });

  it("the check and drill are net-lane reads with no external effects, needing a person when dead", () => {
    for (const kind of [BACKUP_CHECK_JOB, BACKUP_DRILL_JOB]) {
      expect(kind).toMatchObject({
        lane: "net",
        externalEffects: false,
        needsPersonWhenDead: true,
      });
    }
  });
});

describe("backupFreshness", () => {
  const now = Temporal.Instant.from("2026-09-30T00:00:00Z");
  const ago = (ms: number) => new Date(now.epochMilliseconds - ms).toISOString();

  it("is stale only when the last good backup is strictly older than 48 hours", () => {
    expect(backupFreshness({ takenAt: ago(STALE_BACKUP_MS) }, now, null).stale).toBe(false);
    expect(backupFreshness({ takenAt: ago(STALE_BACKUP_MS + 1) }, now, null).stale).toBe(true);
    expect(backupFreshness({ takenAt: ago(60_000) }, now, null).stale).toBe(false);
  });

  it("times a repository with no backup from first start, and judges nothing without one", () => {
    expect(backupFreshness(null, now, ago(47 * 3_600_000)).stale).toBe(false);
    expect(backupFreshness(null, now, ago(49 * 3_600_000)).stale).toBe(true);
    expect(backupFreshness(null, now, null).stale).toBe(false);
    // A good backup wins over an old first start.
    expect(backupFreshness({ takenAt: ago(3_600_000) }, now, ago(400 * 3_600_000)).stale).toBe(
      false,
    );
  });
});

describe("recordBackupVerification and backupStatus", () => {
  it("records each result with history, audited, and shows the latest of each kind", () => {
    const { clock, ctx, uow } = setup();
    recordBackupVerification(ctx, { kind: "check", ok: true, summary: "fine" });
    clock.advance(3_600_000);
    expect(backupStatus(ctx, true)).toMatchObject({
      configured: true,
      check: { ok: true, summary: "fine" },
      drill: null,
    });
    recordBackupVerification(ctx, { kind: "drill", ok: true, summary: "restored" });
    recordBackupVerification(ctx, { kind: "check", ok: false, summary: "broken" });
    expect(uow.state.backupVerifications).toHaveLength(3);
    expect(backupStatus(ctx, true)).toMatchObject({
      check: { ok: false, summary: "broken" },
      drill: { ok: true, summary: "restored" },
    });
    expect(uow.state.audit.filter((row) => row.entity === "backup_verification")).toHaveLength(3);
  });

  it("raises one household item on the first failure, none on repeats, and resolves it on a pass", () => {
    const { ctx, uow } = setup();
    const open = () => listReviewItems(ctx, {}).map((item) => item.kind);
    recordBackupVerification(ctx, { kind: "check", ok: false, summary: "a" });
    recordBackupVerification(ctx, { kind: "check", ok: false, summary: "b" });
    expect(open()).toEqual(["system.backup-verification-failed"]);
    // The drill has its own item, and its pass leaves the check's open.
    recordBackupVerification(ctx, { kind: "drill", ok: false, summary: "c" });
    expect(open()).toHaveLength(2);
    recordBackupVerification(ctx, { kind: "drill", ok: true, summary: "d" });
    expect(open()).toHaveLength(1);
    recordBackupVerification(ctx, { kind: "check", ok: true, summary: "e" });
    expect(open()).toEqual([]);
    // A pass with nothing open writes no review audit; a later failure opens a new item.
    recordBackupVerification(ctx, { kind: "check", ok: true, summary: "f" });
    recordBackupVerification(ctx, { kind: "check", ok: false, summary: "g" });
    expect(open()).toHaveLength(1);
    expect(
      uow.state.reviewItems.filter((item) => item.kind.startsWith("system.backup")),
    ).toHaveLength(3);
    expect(
      uow.state.reviewItems.every((item) => item.accountId === null && item.personId === null),
    ).toBe(true);
  });

  it("reports nothing when no repository is configured", () => {
    const { ctx } = setup();
    recordBackupVerification(ctx, { kind: "check", ok: false, summary: "x" });
    expect(backupStatus(ctx, false)).toEqual({
      configured: false,
      last: null,
      stale: false,
      check: null,
      drill: null,
    });
  });

  it("warns when the last good backup is over 48 hours old, and times a first backup from start", () => {
    const { clock, ctx } = setup();
    // The first scheduled job marks the first start.
    requestBackup(ctx);
    expect(backupStatus(ctx, true).stale).toBe(false);
    clock.set("2026-09-28T23:59:00Z");
    expect(backupStatus(ctx, true).stale).toBe(false);
    clock.set("2026-09-29T00:01:00Z");
    expect(backupStatus(ctx, true)).toMatchObject({ stale: true, last: null });
    const row = recordBackupSnapshot(ctx, {
      ...snapshotInput("J1"),
      takenAt: "2026-09-29T00:00:00.000Z",
    });
    recordBackupPush(ctx, { id: row.id, resticSnapshotId: RESTIC_1 });
    expect(backupStatus(ctx, true).stale).toBe(false);
    clock.set("2026-10-01T00:01:00Z");
    expect(backupStatus(ctx, true).stale).toBe(true);
  });
});
