import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupProgress,
  claimJob,
  createIdGenerator,
  lastBackup,
  recordBackupPush,
  recordBackupSnapshot,
  requestBackup,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

let dir: string;
let db: Db;
let now: Temporal.Instant;
let ctx: UseCaseContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-backups-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  now = Temporal.Instant.from("2026-09-27T00:00:00Z");
  let ms = now.epochMilliseconds;
  ctx = {
    viewer: systemViewer("job:backup-snapshot"),
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const input = (id: string) => ({
  id,
  takenAt: "2026-09-27T00:00:00.000Z",
  schemaVersion: 6,
  tableCount: 15,
  rowCount: 100,
  manifestSha256: "b".repeat(64),
});

describe("backup_snapshot on SQLite", () => {
  it("is STRICT and checks that restic ID and push time come together", () => {
    expect(
      db
        .prepare("SELECT strict FROM pragma_table_list WHERE name = 'backup_snapshot'")
        .pluck()
        .get(),
    ).toBe(1);
    expect(() =>
      db
        .prepare(
          `INSERT INTO backup_snapshot (id, taken_at, schema_version, table_count, row_count,
             manifest_sha256, push_job_id, restic_snapshot_id, pushed_at, created_at, updated_at)
           VALUES ('x', 't', 1, 1, 1, 's', 'j', 'r', NULL, 't', 't')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed: backup_snapshot_pushed/);
  });

  it("records snapshots and pushes, and reads the latest push and a backup's progress", () => {
    const jobId = requestBackup(ctx);
    const claimed = claimJob(ctx, { lane: "local", owner: "r", leaseMs: 60_000 });
    expect(claimed?.id).toBe(jobId);
    const row = recordBackupSnapshot(ctx, input(jobId));
    expect(recordBackupSnapshot(ctx, input(jobId))).toEqual(row);
    expect(backupProgress(ctx, { jobId })).toEqual({
      state: "running",
      step: "push",
      retrying: false,
    });
    expect(lastBackup(ctx)).toBeNull();

    now = now.add({ minutes: 1 });
    recordBackupPush(ctx, { id: jobId, resticSnapshotId: "1".repeat(64) });
    recordBackupSnapshot(ctx, input("LATER"));
    now = now.add({ minutes: 1 });
    recordBackupPush(ctx, { id: "LATER", resticSnapshotId: "2".repeat(64) });
    expect(lastBackup(ctx)).toEqual({
      snapshotId: "2".repeat(64),
      takenAt: "2026-09-27T00:00:00.000Z",
      pushedAt: "2026-09-27T00:02:00.000Z",
    });
    expect(backupProgress(ctx, { jobId })).toEqual({
      state: "done",
      snapshotId: "1".repeat(64),
      pushedAt: "2026-09-27T00:01:00.000Z",
    });
    // A second push record keeps the first restic ID.
    expect(
      recordBackupPush(ctx, { id: jobId, resticSnapshotId: "3".repeat(64) }).row.resticSnapshotId,
    ).toBe("1".repeat(64));
  });
});
