import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  confirmRecoveryBundle,
  createIdGenerator,
  NO_RECOVERY_BUNDLE_ID,
  recoveryBundleConfirmed,
  recoveryBundleStatus,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { assertAllTablesStrict } from "./strict-check.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const A = "20261003T010203Z-a1b2";
const B = "20261104T050607Z-c3d4";

let dir: string;
let db: Db;
let now: Temporal.Instant;
let ctx: UseCaseContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-bundle-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  now = Temporal.Instant.from("2026-10-03T01:00:00Z");
  let ms = now.epochMilliseconds;
  ctx = {
    viewer: systemViewer("cli:confirm-bundle"),
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const auditRows = () =>
  db
    .prepare("SELECT actor, entity, entity_id, action, before, after FROM audit_log ORDER BY at")
    .all() as {
    actor: string;
    entity: string;
    entity_id: string;
    action: string;
    before: string | null;
    after: string | null;
  }[];

describe("the recovery_bundle table", () => {
  it("is a STRICT singleton", () => {
    expect(() => assertAllTablesStrict(db)).not.toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO recovery_bundle (id, bundle_id, confirmed_at) VALUES (2, 'x', 'y')")
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe("system.confirmRecoveryBundle", () => {
  it("starts unconfirmed: a fresh install's bundle id warns", () => {
    expect(recoveryBundleStatus(ctx.uow, A)).toEqual({ confirmed: false, bundleId: A });
    expect(recoveryBundleConfirmed(ctx.uow, A)).toBe(false);
  });

  it("confirms the current id, audited once with the id", () => {
    expect(confirmRecoveryBundle(ctx, { bundleId: A })).toEqual({
      bundleId: A,
      confirmedAt: "2026-10-03T01:00:00.000Z",
      alreadyConfirmed: false,
    });
    expect(recoveryBundleStatus(ctx.uow, A)).toEqual({ confirmed: true, bundleId: A });
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: "cli:confirm-bundle",
      entity: "recovery_bundle",
      entity_id: "1",
      action: "confirm",
      before: null,
    });
    expect(JSON.parse(rows[0]?.after ?? "")).toEqual({
      bundleId: A,
      confirmedAt: "2026-10-03T01:00:00.000Z",
    });
  });

  it("says a second confirmation was already done, and writes no second audit row", () => {
    confirmRecoveryBundle(ctx, { bundleId: A });
    now = now.add({ hours: 1 });
    expect(confirmRecoveryBundle(ctx, { bundleId: A })).toEqual({
      bundleId: A,
      confirmedAt: "2026-10-03T01:00:00.000Z",
      alreadyConfirmed: true,
    });
    expect(auditRows()).toHaveLength(1);
  });

  it("warns again for a new bundle until it is confirmed in turn", () => {
    confirmRecoveryBundle(ctx, { bundleId: A });
    expect(recoveryBundleConfirmed(ctx.uow, B)).toBe(false);
    now = now.add({ hours: 720 });
    confirmRecoveryBundle(ctx, { bundleId: B });
    expect(recoveryBundleConfirmed(ctx.uow, B)).toBe(true);
    // The old id no longer counts (a restore that brings back an older id warns again).
    expect(recoveryBundleConfirmed(ctx.uow, A)).toBe(false);
    const rows = auditRows();
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[1]?.before ?? "")).toMatchObject({ bundleId: A });
    expect(JSON.parse(rows[1]?.after ?? "")).toMatchObject({ bundleId: B });
  });

  it("warns when the database's confirmation is for an older id or missing (a restore)", () => {
    confirmRecoveryBundle(ctx, { bundleId: A });
    // The snapshot restored was taken before B was confirmed: it still holds A.
    expect(recoveryBundleStatus(ctx.uow, B)).toEqual({ confirmed: false, bundleId: B });
    db.prepare("DELETE FROM recovery_bundle").run();
    expect(recoveryBundleStatus(ctx.uow, A)).toEqual({ confirmed: false, bundleId: A });
  });

  it("has nothing to confirm without an id, and refuses to confirm", () => {
    expect(recoveryBundleStatus(ctx.uow, undefined)).toEqual({ confirmed: true });
    expect(() => confirmRecoveryBundle(ctx, {})).toThrow(
      new AppError("Validation", NO_RECOVERY_BUNDLE_ID),
    );
    expect(NO_RECOVERY_BUNDLE_ID).toContain("no recovery bundle id is set");
    expect(auditRows()).toEqual([]);
  });

  it("rejects an id that is not install.sh's shape", () => {
    expect(() => confirmRecoveryBundle(ctx, { bundleId: "secret value" })).toThrow(AppError);
    expect(auditRows()).toEqual([]);
  });
});
