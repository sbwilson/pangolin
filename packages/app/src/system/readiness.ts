import { z } from "zod";
import type { Clock } from "../ports/clock.ts";
import type { SystemHealthPort } from "../ports/system-health.ts";

/** The checks `/healthz` runs, by the names it reports when one fails. */
export const READINESS_CHECKS = ["migrations", "database", "jobs", "forced"] as const;
export type ReadinessCheck = (typeof READINESS_CHECKS)[number];

/** Warnings `/healthz` reports beside a result without changing it: never a failing check. */
export type ReadinessWarning = "backup-stale";

export interface ReadinessContext {
  readonly systemHealth: SystemHealthPort;
  readonly clock: Clock;
}

/** What the job runner reports about itself. */
export interface RunnerLiveness {
  /** Started and not stopped. */
  readonly running: boolean;
  /** When it last ticked (or started), in epoch milliseconds by the injected clock. */
  readonly lastTickAt: number | undefined;
  /** How often it ticks, in milliseconds. */
  readonly pollMs: number;
}

const runnerLiveness = z
  .object({
    running: z.boolean(),
    lastTickAt: z.number().optional(),
    pollMs: z.number().int().positive(),
  })
  .strict();

export const readinessInput = z
  .object({
    /** The number of migrations this build ships. */
    expectedSchemaVersion: z.number().int().min(0),
    /**
     * The runner's liveness: `null` when the runner is expected but absent (not started yet),
     * `"skip"` in demo mode, which runs no jobs.
     */
    runner: z.union([z.literal("skip"), z.null(), runnerLiveness]),
    /** Test builds only (the upgrade-rollback test): report a failing "forced" check. */
    forceUnhealthy: z.boolean().optional(),
    /** The last good backup is stale: reported as a warning, and readiness stays as it was. */
    backupStale: z.boolean().optional(),
  })
  .strict();
export type ReadinessInput = z.input<typeof readinessInput>;

export type ReadinessOutput =
  | { readonly ok: true; readonly warnings?: readonly ReadinessWarning[] }
  | {
      readonly ok: false;
      readonly failing: readonly ReadinessCheck[];
      readonly warnings?: readonly ReadinessWarning[];
    };

/** A runner that has not ticked within this many poll intervals is reported as failing. */
export const RUNNER_STALE_POLLS = 3;

function probe(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

/**
 * `system.readiness`, behind `/healthz`: every migration applied, the database writable, and
 * the job runner running and ticked within `RUNNER_STALE_POLLS` poll intervals (skipped in
 * demo mode). Reports only the names of the failing checks, and the warnings (a stale backup).
 */
export function readiness(ctx: ReadinessContext, input: ReadinessInput): ReadinessOutput {
  const { expectedSchemaVersion, runner, forceUnhealthy, backupStale } =
    readinessInput.parse(input);
  const failing: ReadinessCheck[] = [];
  if (!probe(() => ctx.systemHealth.schemaVersion() === expectedSchemaVersion)) {
    failing.push("migrations");
  }
  if (!probe(() => ctx.systemHealth.probeWrite())) failing.push("database");
  if (forceUnhealthy) failing.push("forced");

  if (runner !== "skip") {
    const now = ctx.clock.now().epochMilliseconds;
    const fresh =
      runner?.running === true &&
      runner.lastTickAt !== undefined &&
      now - runner.lastTickAt <= RUNNER_STALE_POLLS * runner.pollMs;
    if (!fresh) failing.push("jobs");
  }
  const warnings: { readonly warnings?: readonly ReadinessWarning[] } =
    backupStale === true ? { warnings: ["backup-stale"] } : {};
  return failing.length === 0 ? { ok: true, ...warnings } : { ok: false, failing, ...warnings };
}
