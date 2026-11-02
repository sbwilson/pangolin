// Pure domain calculations for bill alerts (CAP-5, AD-13, AD-14).
import { type PlainDate, Temporal } from "@pangolin/shared/temporal";
import type { RecurringCadence } from "./recurring-detector.ts";

/**
 * Grace period in days per cadence:
 * - Weekly: 3 days
 * - Fortnightly: 5 days
 * - Monthly: 7 days
 * - Quarterly: 7 days
 * - Annual: 7 days
 */
export function getCadenceGraceDays(cadence: RecurringCadence): number {
  switch (cadence) {
    case "weekly":
      return 3;
    case "fortnightly":
      return 5;
    case "monthly":
    case "quarterly":
    case "annual":
      return 7;
  }
}

/**
 * Checks whether an expected payment is past its due window.
 * Returns true if today > nextDueOn + graceDays.
 */
export function isPaymentPastDueWindow(
  nextDueOn: PlainDate,
  today: PlainDate,
  cadence: RecurringCadence,
): boolean {
  const graceDays = getCadenceGraceDays(cadence);
  const cutoff = nextDueOn.add({ days: graceDays });
  return Temporal.PlainDate.compare(today, cutoff) > 0;
}

/**
 * Computes the matching payment window `[nextDueOn - graceDays, today]`.
 */
export function getPaymentMatchingWindow(
  nextDueOn: PlainDate,
  today: PlainDate,
  cadence: RecurringCadence,
): { readonly windowStart: PlainDate; readonly windowEnd: PlainDate } {
  const graceDays = getCadenceGraceDays(cadence);
  const windowStart = nextDueOn.subtract({ days: graceDays });
  return {
    windowStart,
    windowEnd: today,
  };
}

/**
 * Evaluates whether an actual payment transaction amount represents a price rise > 10%
 * above the expected bill amount.
 * Note: Transaction amounts for bills are typically negative or positive depending on representation.
 * We evaluate absolute cents: `actualCents > expectedCents * 1.10`.
 * Integer math: `(actualCents - expectedCents) * 100 > expectedCents * 10` i.e. `actualCents * 10 > expectedCents * 11`.
 */
export function isPriceRise(actualCents: number, expectedCents: number): boolean {
  const actualAbs = Math.abs(actualCents);
  const expectedAbs = Math.abs(expectedCents);
  if (expectedAbs <= 0) return false;
  // strictly greater than 10% increase (actual > expected * 1.10)
  return actualAbs * 10 > expectedAbs * 11;
}

/**
 * Computes the price rise percentage as an integer or rounded number.
 * e.g. for $114 vs $100 -> returns 14.
 */
export function calculatePriceRisePercentage(actualCents: number, expectedCents: number): number {
  const actualAbs = Math.abs(actualCents);
  const expectedAbs = Math.abs(expectedCents);
  if (expectedAbs <= 0) return 0;
  const increase = actualAbs - expectedAbs;
  if (increase <= 0) return 0;
  return Math.round((increase / expectedAbs) * 100);
}
