// Pure per-goal completion projection from historical goal_allocation rows (CAP-6 workspace).
// No repos, no clock: the caller passes rows, the remaining cents and the as-of day.
import { parseDate } from "@pangolin/shared/temporal";

/** The rows a projection reads: one per allocation period, in any order. */
export interface ProjectionAllocationRow {
  readonly periodStart: string;
  readonly amountCents: number;
}

export type ProjectionPace = "weekly" | "fortnightly" | "monthly";

export interface GoalProjection {
  /** Mean net allocation per period across the most recent ≤6 periods. */
  readonly averagePerPeriodCents: number;
  /** Pace derived from the gap between the two most recent `periodStart`s. */
  readonly pace: ProjectionPace;
  /** Whole periods needed to close the remaining cents at the average. */
  readonly periodsRemaining: number;
  /** ISO day: the latest `periodStart` plus `periodsRemaining` periods. */
  readonly projectedCompletion: string;
}

/** How many of the most recent periods the average is taken over. */
const MAX_PERIODS = 6;

function paceFromGapDays(gapDays: number): ProjectionPace {
  if (gapDays <= 10) return "weekly";
  if (gapDays <= 20) return "fortnightly";
  return "monthly";
}

/**
 * Project when a goal arrives: `remaining ÷ avg per-period allocation over the last
 * ≤6 goal_allocation rows`, pace from `period_start` gaps, counted forward from the
 * latest period start.
 *
 * Answers `null` when there is nothing to project: nothing remaining (a completed
 * goal shows its complete state, not a date), fewer than 2 non-zero periods, or a
 * non-positive average.
 */
export function projectGoalCompletion(
  rows: readonly ProjectionAllocationRow[],
  remainingCents: number,
  asOf: string,
): GoalProjection | null {
  if (remainingCents <= 0) return null;

  // Net the amounts per period (a later withdrawal nets against its contributions),
  // drop future-dated and zero-net periods, and take the most recent ≤6.
  const netByPeriod = new Map<string, number>();
  for (const row of rows) {
    if (row.periodStart > asOf) continue;
    netByPeriod.set(row.periodStart, (netByPeriod.get(row.periodStart) ?? 0) + row.amountCents);
  }
  const periods = Array.from(netByPeriod.entries())
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const recent = periods.slice(-MAX_PERIODS);
  if (recent.length < 2) return null;

  const total = recent.reduce((sum, [, amount]) => sum + amount, 0);
  const averagePerPeriodCents = Math.round(total / recent.length);
  if (averagePerPeriodCents <= 0) return null;

  const latest = parseDate(recent[recent.length - 1]?.[0] as string);
  const previous = parseDate(recent[recent.length - 2]?.[0] as string);
  const gapDays = previous.until(latest, { largestUnit: "days" }).days;
  const pace = paceFromGapDays(gapDays);

  const periodsRemaining = Math.ceil(remainingCents / averagePerPeriodCents);
  const projected =
    pace === "monthly"
      ? latest.add({ months: periodsRemaining })
      : latest.add({ days: (pace === "weekly" ? 7 : 14) * periodsRemaining });

  return {
    averagePerPeriodCents,
    pace,
    periodsRemaining,
    projectedCompletion: projected.toString(),
  };
}
