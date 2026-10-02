import { describe, expect, it } from "vitest";
import { fixedClockAt } from "../clock.ts";
import type { SystemHealthPort } from "../ports/system-health.ts";
import { type ReadinessInput, readiness } from "./readiness.ts";

const clock = fixedClockAt("2026-09-27");
const now = clock.now().epochMilliseconds;

function port(schemaVersion: number, writable: boolean | "throws"): SystemHealthPort {
  return {
    schemaVersion: () => schemaVersion,
    probeWrite: () => {
      if (writable === "throws") throw new Error("SQLITE_BUSY");
      return writable;
    },
  };
}

const ticking = { running: true, lastTickAt: now - 1000, pollMs: 1000 };

function check(systemHealth: SystemHealthPort, input: Partial<ReadinessInput> = {}) {
  return readiness(
    { systemHealth, clock },
    { expectedSchemaVersion: 5, runner: ticking, ...input },
  );
}

describe("system.readiness", () => {
  it("is ok when migrated, writable and the runner ticked recently", () => {
    expect(check(port(5, true))).toEqual({ ok: true });
  });

  it("reports a stale backup as a warning, never as a failing check", () => {
    expect(check(port(5, true), { backupStale: true })).toEqual({
      ok: true,
      warnings: ["backup-stale"],
    });
    expect(check(port(5, true), { backupStale: false })).toEqual({ ok: true });
    expect(check(port(4, true), { backupStale: true })).toEqual({
      ok: false,
      failing: ["migrations"],
      warnings: ["backup-stale"],
    });
  });

  it("reports an unconfirmed recovery bundle as a warning, never as a failing check", () => {
    expect(check(port(5, true), { bundleUnconfirmed: true })).toEqual({
      ok: true,
      warnings: ["recovery-bundle-unconfirmed"],
    });
    expect(check(port(5, true), { bundleUnconfirmed: false })).toEqual({ ok: true });
    expect(check(port(5, true), { bundleUnconfirmed: true, backupStale: true })).toEqual({
      ok: true,
      warnings: ["backup-stale", "recovery-bundle-unconfirmed"],
    });
    expect(check(port(5, true), { runner: null, bundleUnconfirmed: true })).toEqual({
      ok: false,
      failing: ["jobs"],
      warnings: ["recovery-bundle-unconfirmed"],
    });
  });

  it("names a missing migration", () => {
    expect(check(port(4, true))).toEqual({ ok: false, failing: ["migrations"] });
  });

  it("names a read-only database, or one whose probe throws", () => {
    expect(check(port(5, false))).toEqual({ ok: false, failing: ["database"] });
    expect(check(port(5, "throws"))).toEqual({ ok: false, failing: ["database"] });
  });

  it("names a runner that is absent, stopped, never ticked or stale", () => {
    const failing = { ok: false, failing: ["jobs"] };
    expect(check(port(5, true), { runner: null })).toEqual(failing);
    expect(check(port(5, true), { runner: { ...ticking, running: false } })).toEqual(failing);
    expect(check(port(5, true), { runner: { running: true, pollMs: 1000 } })).toEqual(failing);
    expect(check(port(5, true), { runner: { ...ticking, lastTickAt: now - 3001 } })).toEqual(
      failing,
    );
    expect(check(port(5, true), { runner: { ...ticking, lastTickAt: now - 3000 } })).toEqual({
      ok: true,
    });
  });

  it("skips the runner check in demo mode", () => {
    expect(check(port(5, true), { runner: "skip" })).toEqual({ ok: true });
  });

  it("lists every failing check", () => {
    expect(check(port(3, false), { runner: null })).toEqual({
      ok: false,
      failing: ["migrations", "database", "jobs"],
    });
  });
});
