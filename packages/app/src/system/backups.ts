// Backups (story 1.10), owned by `system`: the two job kinds, the nightly schedule, and the use
// cases that record a snapshot and its push in `backup_snapshot`. The snapshot and the push
// themselves (`VACUUM INTO`, restic) are I/O the server's job handlers do before calling these.
import type { Id } from "@pangolin/shared";
import { formatInstant, Temporal } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { enqueueJob } from "../jobs/enqueue.ts";
import { defineJobKind, defineSchedule, type Schedule } from "../jobs/registry.ts";
import type { BackupSnapshotRow, TxRepos, UnitOfWork } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

/**
 * Writes a consistent snapshot (`VACUUM INTO`) and its manifest to the staging directory, then
 * enqueues the push. Local: it never calls out.
 */
export const BACKUP_SNAPSHOT_JOB = defineJobKind({
  kind: "backup-snapshot",
  schema: z.object({ trigger: z.enum(["schedule", "manual"]) }).strict(),
  lane: "local",
  retry: { maxAttempts: 3, baseDelayMs: 60_000, maxDelayMs: 15 * 60_000 },
  externalEffects: false,
  needsPersonWhenDead: true,
  timeoutMs: 30 * 60_000,
});

/** Pushes one staged snapshot (and the attachments) with restic to the append-only server. */
export const BACKUP_PUSH_JOB = defineJobKind({
  kind: "backup-push",
  schema: z.object({ backupId: z.string().min(1).max(64) }).strict(),
  lane: "net",
  retry: { maxAttempts: 6, baseDelayMs: 60_000, maxDelayMs: 60 * 60_000 },
  externalEffects: true,
  needsPersonWhenDead: true,
  timeoutMs: 6 * 60 * 60_000,
});

/** The dedupe key of a manual backup's snapshot job: a second request joins the first. */
export const MANUAL_BACKUP_KEY = "backup:manual";

export const BACKUP_SCHEDULE_NAME = "backup-nightly";

/** The nightly backup's time of day, in the household time zone. */
export const BACKUP_TIME = { hour: 2, minute: 30 } as const;

/**
 * A schedule's `next`: the first `hour:minute` in `timeZone` strictly after `after`. On a day
 * the time does not exist (the clocks jump over it) it runs just after the jump; on a day it
 * happens twice, the first time. Throws `RangeError` for an unknown time zone.
 */
export function dailyAt(
  timeZone: string,
  hour: number,
  minute: number,
): (after: Temporal.Instant) => Temporal.Instant {
  const plainTime = Temporal.PlainTime.from({ hour, minute });
  Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timeZone);
  return (after) => {
    let date = after.toZonedDateTimeISO(timeZone).toPlainDate();
    // Today's time may have passed; tomorrow's is always later (DST moves it by an hour at most).
    for (;;) {
      const at = date.toZonedDateTime({ timeZone, plainTime }).toInstant();
      if (Temporal.Instant.compare(at, after) > 0) return at;
      date = date.add({ days: 1 });
    }
  };
}

/** The nightly backup at 02:30 in the household time zone. */
export function nightlyBackupSchedule(timeZone: string): Schedule {
  return defineSchedule({
    name: BACKUP_SCHEDULE_NAME,
    kind: BACKUP_SNAPSHOT_JOB,
    payload: { trigger: "schedule" as const },
    next: dailyAt(timeZone, BACKUP_TIME.hour, BACKUP_TIME.minute),
  });
}

/**
 * `system.requestBackup`: enqueues a manual backup's snapshot job, or joins the manual backup
 * already waiting or running (`backup:manual`). Returns the snapshot job's ID, which
 * `backupProgress` follows.
 */
export function requestBackup(ctx: UseCaseContext): Id<"Job"> {
  return write(ctx, (tx, audit) => {
    const id = enqueueJob(
      tx,
      ctx,
      BACKUP_SNAPSHOT_JOB,
      { trigger: "manual" },
      { dedupeKey: MANUAL_BACKUP_KEY },
    );
    audit({ entity: "backup", entityId: id, action: "request", before: null, after: null });
    return id;
  });
}

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const recordBackupSnapshotInput = z
  .object({
    /** The snapshot job's ID. */
    id: z.string().min(1).max(64),
    takenAt: z.string().min(1),
    schemaVersion: z.number().int().min(0),
    tableCount: z.number().int().min(0),
    rowCount: z.number().int().min(0),
    manifestSha256: sha256,
  })
  .strict();
export type RecordBackupSnapshotInput = z.input<typeof recordBackupSnapshotInput>;

/**
 * `system.recordBackupSnapshot`: records a staged snapshot and enqueues its push, in one
 * transaction. Idempotent per snapshot job: a second call returns the first row unchanged.
 */
export function recordBackupSnapshot(
  ctx: UseCaseContext,
  raw: RecordBackupSnapshotInput,
): BackupSnapshotRow {
  const input = parseInput(recordBackupSnapshotInput, raw);
  return write(ctx, (tx, audit) => {
    const existing = tx.backups.find(input.id);
    if (existing !== undefined) return existing;
    const pushJobId = enqueueJob(
      tx,
      ctx,
      BACKUP_PUSH_JOB,
      { backupId: input.id },
      { dedupeKey: `backup-push:${input.id}` },
    );
    const now = formatInstant(ctx.clock.now());
    const row: BackupSnapshotRow = {
      ...input,
      pushJobId,
      resticSnapshotId: null,
      pushedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.backups.insert(row);
    audit({
      entity: "backup_snapshot",
      entityId: row.id,
      action: "create",
      before: null,
      after: row,
    });
    return row;
  });
}

export const recordBackupPushInput = z
  .object({
    id: z.string().min(1).max(64),
    resticSnapshotId: sha256,
    /** The snapshot IDs whose staging directories exist now. */
    staged: z.array(z.string().min(1).max(64)).max(10_000).default([]),
  })
  .strict();
export type RecordBackupPushInput = z.input<typeof recordBackupPushInput>;

export interface RecordedBackupPush {
  readonly row: BackupSnapshotRow;
  /**
   * Of `staged`, the snapshots whose staging directories may go: this one, and any other that
   * was pushed or whose push job has finished (dead or done). Unknown IDs are never listed: they
   * may belong to a snapshot still being written.
   */
  readonly removable: readonly string[];
}

function finished(tx: TxRepos, id: string): boolean {
  const row = tx.backups.find(id);
  if (row === undefined) return false;
  if (row.pushedAt !== null) return true;
  const push = tx.jobs.find(row.pushJobId);
  return push === undefined || push.status === "dead" || push.status === "done";
}

/**
 * `system.recordBackupPush`: records the restic snapshot a staged snapshot was pushed as. A
 * snapshot already recorded as pushed keeps its first restic ID (a retried push after a lost
 * completion pushes again; both snapshots are valid). `NotFound` for an unknown snapshot.
 */
export function recordBackupPush(
  ctx: UseCaseContext,
  raw: RecordBackupPushInput,
): RecordedBackupPush {
  const input = parseInput(recordBackupPushInput, raw);
  return write(ctx, (tx, audit) => {
    const before = tx.backups.find(input.id);
    if (before === undefined) throw new AppError("NotFound", "No such backup snapshot");
    const pushedAt = formatInstant(ctx.clock.now());
    if (tx.backups.markPushed(input.id, input.resticSnapshotId, pushedAt)) {
      const after = tx.backups.find(input.id);
      audit({ entity: "backup_snapshot", entityId: input.id, action: "push", before, after });
    }
    const row = tx.backups.find(input.id) ?? before;
    const removable = input.staged.filter((id) => id === input.id || finished(tx, id));
    return { row, removable };
  });
}

export const getBackupSnapshotInput = z.object({ id: z.string().min(1).max(64) }).strict();

/** `system.getBackupSnapshot`: one snapshot's row, or undefined. For the push handler. */
export function getBackupSnapshot(
  ctx: { readonly uow: Pick<UnitOfWork, "read"> },
  raw: z.input<typeof getBackupSnapshotInput>,
): BackupSnapshotRow | undefined {
  const { id } = parseInput(getBackupSnapshotInput, raw);
  return ctx.uow.read((repos) => repos.backups.find(id));
}

export const backupsAwaitingPushInput = z
  .object({ ids: z.array(z.string().min(1).max(64)).max(10_000) })
  .strict();

/**
 * `system.backupsAwaitingPush`: of the snapshot IDs `ids` (staging directories), those recorded,
 * not yet pushed, and whose push job is still pending or running.
 */
export function backupsAwaitingPush(
  ctx: { readonly uow: Pick<UnitOfWork, "read"> },
  raw: z.input<typeof backupsAwaitingPushInput>,
): string[] {
  const { ids } = parseInput(backupsAwaitingPushInput, raw);
  return ctx.uow.read((repos) =>
    ids.filter((id) => {
      const row = repos.backups.find(id);
      if (row === undefined || row.pushedAt !== null) return false;
      const push = repos.jobs.find(row.pushJobId);
      return push?.status === "pending" || push?.status === "running";
    }),
  );
}

/** Where a backup is, as the CLI polls it. Read from the snapshot row and its two jobs. */
export type BackupProgress =
  | {
      readonly state: "running";
      readonly step: "snapshot" | "push";
      /** An attempt failed and the job waits to retry. */
      readonly retrying: boolean;
    }
  | { readonly state: "done"; readonly snapshotId: string; readonly pushedAt: string }
  | { readonly state: "failed"; readonly step: "snapshot" | "push" };

export const backupProgressInput = z.object({ jobId: z.string().min(1).max(64) }).strict();
export type BackupProgressInput = z.input<typeof backupProgressInput>;

/**
 * `system.backupProgress`: how far the backup started by snapshot job `jobId` has got.
 * `NotFound` when there is no such snapshot job.
 */
export function backupProgress(
  ctx: { readonly uow: Pick<UnitOfWork, "read"> },
  raw: BackupProgressInput,
): BackupProgress {
  const { jobId } = parseInput(backupProgressInput, raw);
  return ctx.uow.read((repos) => {
    const row = repos.backups.find(jobId);
    if (row !== undefined && row.resticSnapshotId !== null && row.pushedAt !== null) {
      return { state: "done", snapshotId: row.resticSnapshotId, pushedAt: row.pushedAt };
    }
    if (row !== undefined) {
      const push = repos.jobs.find(row.pushJobId);
      if (push === undefined || push.status === "dead" || push.status === "done") {
        return { state: "failed", step: "push" };
      }
      return {
        state: "running",
        step: "push",
        retrying: push.attempts > 0 && push.status === "pending",
      };
    }
    const snapshot = repos.jobs.find(jobId as Id<"Job">);
    if (snapshot === undefined || snapshot.kind !== BACKUP_SNAPSHOT_JOB.kind) {
      throw new AppError("NotFound", "No such backup");
    }
    // Done without a row: the handler found backups not configured and did nothing.
    if (snapshot.status === "dead" || snapshot.status === "done") {
      return { state: "failed", step: "snapshot" };
    }
    return {
      state: "running",
      step: "snapshot",
      retrying: snapshot.attempts > 0 && snapshot.status === "pending",
    };
  });
}

/** The last pushed backup, as `pangolin status` and the status page show it. */
export interface LastBackup {
  /** restic's snapshot ID. */
  readonly snapshotId: string;
  /** When the database snapshot was taken. */
  readonly takenAt: string;
  /** When the push finished. */
  readonly pushedAt: string;
}

/** `system.lastBackup`: the last pushed backup, or null. No viewer: it shows no household data. */
export function lastBackup(ctx: { readonly uow: Pick<UnitOfWork, "read"> }): LastBackup | null {
  const row = ctx.uow.read((repos) => repos.backups.latestPushed());
  if (row === undefined || row.resticSnapshotId === null || row.pushedAt === null) return null;
  return { snapshotId: row.resticSnapshotId, takenAt: row.takenAt, pushedAt: row.pushedAt };
}
