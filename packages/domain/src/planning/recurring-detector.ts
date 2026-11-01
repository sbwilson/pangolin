// Pure domain detection algorithms for recurring series (CAP-5, AD-25).
import { cents } from "@pangolin/shared";
import { type PlainDate, Temporal } from "@pangolin/shared/temporal";

export type RecurringCadence = "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual";

export interface RecurringOccurrence {
  readonly postedOn: PlainDate;
  readonly amountCents: number;
}

export interface DetectedRecurringSeries {
  readonly cadence: RecurringCadence;
  readonly expectedCents: number;
  readonly toleranceBp: number;
  readonly nextDueOn: PlainDate;
}

/**
 * Calculates median value of an array of numbers.
 * For an even number of elements, returns the half-even rounded average (AD-13).
 */
export function calculateMedian(numbers: readonly number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midVal = sorted[mid];
  if (midVal === undefined) return 0;
  if (sorted.length % 2 === 1) {
    return midVal;
  }
  const prevVal = sorted[mid - 1];
  if (prevVal === undefined) return midVal;
  // Half-even round the average to avoid rounding bias (AD-13)
  const sum = prevVal + midVal;
  const half = sum / 2;
  if (Number.isInteger(half)) {
    return half;
  }
  // For half-integers (.5), round to the nearest even integer
  const floor = Math.floor(half);
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Cadence interval bounds (in days) per design notes:
 * - Weekly: 6–8 days (~7 days)
 * - Fortnightly: 13–15 days (~14 days)
 * - Monthly: 27–32 days (~30-31 days)
 * - Quarterly: 85–95 days (~91 days)
 * - Annual: 350–375 days (~365 days)
 */
export function classifyCadence(medianInterval: number): RecurringCadence | undefined {
  if (medianInterval >= 6 && medianInterval <= 8) return "weekly";
  if (medianInterval >= 13 && medianInterval <= 15) return "fortnightly";
  if (medianInterval >= 27 && medianInterval <= 32) return "monthly";
  if (medianInterval >= 85 && medianInterval <= 95) return "quarterly";
  if (medianInterval >= 350 && medianInterval <= 375) return "annual";
  return undefined;
}

/**
 * Predicts next due date from latest date according to cadence.
 * For monthly, advances by 1 month preserving day of month where possible.
 * For quarterly, advances by 3 months preserving day of month where possible.
 * For annual, advances by 1 year preserving day of month where possible.
 * For weekly, advances by 7 days.
 * For fortnightly, advances by 14 days.
 */
export function predictNextDueOn(latestDate: PlainDate, cadence: RecurringCadence): PlainDate {
  switch (cadence) {
    case "weekly":
      return latestDate.add({ days: 7 });
    case "fortnightly":
      return latestDate.add({ days: 14 });
    case "monthly":
      return latestDate.add({ months: 1 });
    case "quarterly":
      return latestDate.add({ months: 3 });
    case "annual":
      return latestDate.add({ years: 1 });
  }
}

/**
 * Detects whether a list of occurrences forms a recurring series.
 *
 * Rules:
 * 1. Requires >= 3 occurrences.
 * 2. Median interval must classify into a known cadence:
 *    weekly (6-8d), fortnightly (13-15d), monthly (27-32d), quarterly (85-95d), annual (350-375d).
 * 3. Interval stability: all intervals within +/- 3 days of median (or +/- 5 days for quarterly/annual).
 * 4. Amount stability: difference from median amount <= 15% (1500 bp) or standard deviation <= 15%.
 *    Here: all amounts within 15% of median amount.
 * 5. Expected amount: median amount (half-even rounded integer cents).
 * 6. Next due date: predicted next due date from latest occurrence.
 */
export function detectRecurringSeries(
  occurrences: readonly RecurringOccurrence[],
  options?: {
    readonly toleranceBp?: number; // default 1500 bp (15%)
  },
): DetectedRecurringSeries | undefined {
  if (occurrences.length < 3) {
    return undefined;
  }

  // Sort chronologically ascending
  const sorted = [...occurrences].sort((a, b) =>
    Temporal.PlainDate.compare(a.postedOn, b.postedOn),
  );

  // Compute intervals in days
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]?.postedOn;
    const curr = sorted[i]?.postedOn;
    if (!prev || !curr) continue;
    const days = prev.until(curr, { largestUnit: "days" }).days;
    intervals.push(days);
  }

  const medianInterval = calculateMedian(intervals);
  const cadence = classifyCadence(medianInterval);
  if (!cadence) {
    return undefined;
  }

  // Interval stability tolerance: +/- 5 days for quarterly/annual, +/- 3 days for weekly/fortnightly/monthly
  const intervalTolerance = cadence === "quarterly" || cadence === "annual" ? 5 : 3;

  for (const interval of intervals) {
    if (Math.abs(interval - medianInterval) > intervalTolerance) {
      return undefined;
    }
  }

  // Amount stability: evaluate absolute cents
  const absAmounts = sorted.map((o) => Math.abs(o.amountCents));
  const medianAmount = calculateMedian(absAmounts);

  if (medianAmount <= 0) {
    return undefined;
  }

  const toleranceBp = options?.toleranceBp ?? 1500; // 15%
  // Difference from median amount <= toleranceBp (15%)
  for (const amount of absAmounts) {
    const diff = Math.abs(amount - medianAmount);
    // diff / medianAmount <= toleranceBp / 10000
    if (diff * 10000 > medianAmount * toleranceBp) {
      return undefined;
    }
  }

  // Expected amount: median amount in cents
  const expectedCents = cents(medianAmount);

  // Next due date from latest date
  const latestDate = sorted[sorted.length - 1]?.postedOn;
  if (!latestDate) {
    return undefined;
  }
  const nextDueOn = predictNextDueOn(latestDate, cadence);

  return {
    cadence,
    expectedCents,
    toleranceBp,
    nextDueOn,
  };
}
