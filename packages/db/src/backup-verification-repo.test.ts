import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupStatus,
  createIdGenerator,
  listReviewItems,
  recordBackupVerification,
  requestBackup,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { assertAllTablesStrict } from "./strict-check.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

let dir: string;
let db: Db;
let now: Temporal.Instant;
let ctx: UseCaseContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-verifications-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  now = Temporal.Instant.from("2026-09-27T00:00:00Z");
  let ms = now.epochMilliseconds;
  ctx = {
    viewer: systemViewer("job:backup-check"),
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the backup_verification repository", () => {
  it("is a STRICT table that rejects an unknown kind or a non-boolean result", () => {
    expect(() => assertAllTablesStrict(db)).not.toThrow();
    const insert = (kind: string, ok: number) =>
      db
        .prepare(
          "INSERT INTO backup_verification (id, kind, at, ok, summary) VALUES ('x', ?, 'at', ?, 's')",
        )
        .run(kind, ok);
    expect(() => insert("other", 1)).toThrow(/CHECK/);
    expect(() => insert("check", 2)).toThrow(/CHECK/);
    expect(() => insert("check", 1)).not.toThrow();
  });

  it("keeps history and answers the newest result of each kind", () => {
    recordBackupVerification(ctx, { kind: "check", ok: true, summary: "first" });
    now = now.add({ hours: 1 });
    recordBackupVerification(ctx, { kind: "check", ok: false, summary: "second" });
    now = now.add({ hours: 1 });
    recordBackupVerification(ctx, { kind: "drill", ok: true, summary: "drilled" });
    expect(db.prepare("SELECT count(*) FROM backup_verification").pluck().get()).toBe(3);
    const status = backupStatus(ctx, true);
    expect(status.check).toEqual({ at: "2026-09-27T01:00:00.000Z", ok: false, summary: "second" });
    expect(status.drill).toMatchObject({ ok: true, summary: "drilled" });
    expect(db.prepare("SELECT ok FROM backup_verification ORDER BY at").pluck().all()).toEqual([
      1, 0, 1,
    ]);
  });

  it("raises and resolves the review item through the real review repository", () => {
    recordBackupVerification(ctx, { kind: "check", ok: false, summary: "bad" });
    recordBackupVerification(ctx, { kind: "check", ok: false, summary: "bad again" });
    expect(listReviewItems(ctx, {}).map((item) => item.kind)).toEqual([
      "system.backup-verification-failed",
    ]);
    recordBackupVerification(ctx, { kind: "check", ok: true, summary: "good" });
    expect(listReviewItems(ctx, {})).toEqual([]);
  });

  it("times a configured repository from its first backup job", () => {
    expect(backupStatus(ctx, true).stale).toBe(false);
    requestBackup(ctx);
    now = now.add({ hours: 49 });
    expect(backupStatus(ctx, true).stale).toBe(true);
    expect(backupStatus(ctx, false).stale).toBe(false);
  });
});
