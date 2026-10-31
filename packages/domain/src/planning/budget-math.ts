// Pure domain budget calculations (AD-13, AD-14, CAP-4).
import type { Cents } from "@pangolin/shared";
import { cents, Decimal, toCents } from "@pangolin/shared";
import type { PayPeriod } from "@pangolin/shared/period";
import type { PlainDate } from "@pangolin/shared/temporal";
import { Temporal } from "@pangolin/shared/temporal";

export type BudgetStatus = "on-track" | "heading-over" | "over-budget";

export interface BudgetMathInput {
  readonly period: Pick<PayPeriod, "start" | "end">;
  readonly today: PlainDate;
  readonly limitCents: Cents;
  readonly spentCents: Cents;
  readonly rolloverCents?: Cents;
}

export interface BudgetMathResult {
  readonly effectiveLimitCents: Cents;
  readonly remainingCents: Cents;
  readonly paceCents: Cents;
  readonly projectedCents: Cents;
  readonly status: BudgetStatus;
}

/**
 * Calculates budget pace, projected total, remaining, and status.
 *
 * Rules:
 * - Total period days D = end - start (using PlainDate.since / until in days).
 * - Elapsed days E = min(D, max(0, today - start)).
 * - Remaining days R = D - E.
 * - Effective limit = limitCents + (rolloverCents ?? 0).
 * - Remaining cents = effectiveLimit - spent.
 * - Linear pace expectation = toCents(effectiveLimit * (E / D)).
 * - Daily rate: if E > 0, spent / E, else 0.
 * - Projected = if E > 0, toCents(spent + daily_rate * R), else spent.
 * - Status:
 *   - spent > effectiveLimit: 'over-budget'
 *   - else if projected > effectiveLimit: 'heading-over'
 *   - else: 'on-track'
 */
export function calculateBudgetMath(input: BudgetMathInput): BudgetMathResult {
  const { period, today, limitCents, spentCents, rolloverCents = 0 as Cents } = input;

  const effectiveLimitCents = cents(limitCents + rolloverCents);
  const remainingCents = cents(effectiveLimitCents - spentCents);

  const totalDays = period.end.since(period.start, { largestUnit: "days" }).days;
  if (totalDays <= 0) {
    throw new RangeError(`calculateBudgetMath: period totalDays must be > 0, got ${totalDays}`);
  }

  // Elapsed days: how many days of the period have elapsed up to today.
  // Today is within [start, end). If today < start, elapsed = 0.
  // If today >= end, elapsed = totalDays.
  let elapsedDays: number;
  if (Temporal.PlainDate.compare(today, period.start) <= 0) {
    elapsedDays = 0;
  } else if (Temporal.PlainDate.compare(today, period.end) >= 0) {
    elapsedDays = totalDays;
  } else {
    elapsedDays = today.since(period.start, { largestUnit: "days" }).days;
  }

  const remainingDays = totalDays - elapsedDays;

  // Pace = toCents(effectiveLimit * (E / D))
  // Notice: effectiveLimit is in cents, so effectiveLimit / 100 is dollars.
  // toCents takes dollars (Decimal or decimal string) and returns Cents!
  const effLimitDollars = new Decimal(effectiveLimitCents).dividedBy(100);
  const paceFraction = new Decimal(elapsedDays).dividedBy(totalDays);
  const paceDollars = effLimitDollars.times(paceFraction);
  const paceCents = toCents(paceDollars);

  // Projected calculation:
  // If elapsedDays == 0, projected = spentCents.
  // Otherwise, daily_rate_dollars = spentDollars / elapsedDays.
  // projected = toCents(spentDollars + daily_rate_dollars * remainingDays).
  let projectedCents: Cents;
  if (elapsedDays === 0) {
    projectedCents = spentCents;
  } else {
    const spentDollars = new Decimal(spentCents).dividedBy(100);
    const dailyRate = spentDollars.dividedBy(elapsedDays);
    const projectedDollars = spentDollars.plus(dailyRate.times(remainingDays));
    projectedCents = toCents(projectedDollars);
  }

  // Status determination
  let status: BudgetStatus;
  if (spentCents > effectiveLimitCents) {
    status = "over-budget";
  } else if (projectedCents > effectiveLimitCents) {
    status = "heading-over";
  } else {
    status = "on-track";
  }

  return {
    effectiveLimitCents,
    remainingCents,
    paceCents,
    projectedCents,
    status,
  };
}

/**
 * Calculates rollover carryover amount from the previous period.
 * If rollover is disabled, returns 0 cents.
 * If rollover is enabled, returns previousLimit - previousSpent (can be positive or negative).
 */
export function calculateRollover(
  rolloverEnabled: boolean,
  previousLimitCents: Cents,
  previousSpentCents: Cents,
): Cents {
  if (!rolloverEnabled) {
    return 0 as Cents;
  }
  return cents(previousLimitCents - previousSpentCents);
}

/**
 * Calculates suggested limit from historical closed periods.
 * Limit suggestions calculate the mean spent over the last 6 closed periods of that cadence.
 * If fewer than 6 closed periods or no spending history exists, returns null.
 */
export function calculateLimitSuggestion(historicalPeriodSpents: readonly Cents[]): Cents | null {
  if (historicalPeriodSpents.length < 6) {
    return null;
  }
  // Take exactly the last 6 closed periods
  const last6 = historicalPeriodSpents.slice(-6);
  let totalSpentDollars = new Decimal(0);
  for (const spent of last6) {
    totalSpentDollars = totalSpentDollars.plus(new Decimal(spent).dividedBy(100));
  }
  const meanDollars = totalSpentDollars.dividedBy(6);
  return toCents(meanDollars);
}
