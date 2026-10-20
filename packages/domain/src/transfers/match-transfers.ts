// Pure rules for pipeline stage 6: transfer matching and probable-duplicate detection.
import { Temporal } from "@pangolin/shared/temporal";

/** The window, in days either side, within which two legs of a transfer may be dated. */
export const TRANSFER_WINDOW_DAYS = 3;

/** A transaction as the matcher sees it. */
export interface TransferLeg {
  readonly id: string;
  readonly accountId: string;
  /** `YYYY-MM-DD`. */
  readonly postedOn: string;
  readonly amountCents: number;
}

const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** `day` (`YYYY-MM-DD`) moved by `days` (negative goes back). */
export function shiftDay(day: string, days: number): string {
  return Temporal.PlainDate.from(day).add({ days }).toString();
}

/** The absolute number of days between two `YYYY-MM-DD` days. */
export function daysApart(a: string, b: string): number {
  return Math.abs(dayNumber(a) - dayNumber(b));
}

/**
 * The legs in `pool` that could be the other side of `leg`: another account, the opposite
 * non-zero amount, and a date within `TRANSFER_WINDOW_DAYS`.
 */
export function transferCandidates<T extends TransferLeg>(
  leg: TransferLeg,
  pool: readonly T[],
): T[] {
  if (leg.amountCents === 0) return [];
  return pool.filter(
    (c) =>
      c.id !== leg.id &&
      c.accountId !== leg.accountId &&
      c.amountCents === -leg.amountCents &&
      daysApart(c.postedOn, leg.postedOn) <= TRANSFER_WINDOW_DAYS,
  );
}

export type TransferMatchResult<T> =
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "match"; readonly candidate: T };

/**
 * Uniqueness from both ends: `leg` matches only when it has exactly one candidate in `pool` and
 * that candidate has exactly one opposing counterpart in `counterparts` (which must include
 * `leg` itself, and any batch sibling that also fits). No candidate is `none`; more than one on
 * either end is `ambiguous`.
 */
export function findTransferMatch<T extends TransferLeg>(
  leg: TransferLeg,
  pool: readonly T[],
  counterparts: (candidate: T) => readonly TransferLeg[],
): TransferMatchResult<T> {
  const candidates = transferCandidates(leg, pool);
  if (candidates.length === 0) return { kind: "none" };
  const [only] = candidates;
  if (candidates.length > 1 || only === undefined) return { kind: "ambiguous" };
  const back = transferCandidates(only, counterparts(only));
  return back.length === 1 ? { kind: "match", candidate: only } : { kind: "ambiguous" };
}

/** The fields of a transaction the duplicate rule reads. */
export interface DuplicateSubject {
  readonly postedOn: string;
  readonly amountCents: number;
  readonly normalisedDescription: string;
  readonly externalId: string | null;
}

/**
 * Whether `row` looks like the same transaction as `existing` in one account, shifted by one to
 * three days: same amount, same normalised description, and not two distinct bank IDs. Same-day
 * twins are not duplicates here (occurrence counts govern them).
 */
export function isProbableDuplicate(row: DuplicateSubject, existing: DuplicateSubject): boolean {
  const apart = daysApart(row.postedOn, existing.postedOn);
  if (apart < 1 || apart > TRANSFER_WINDOW_DAYS) return false;
  if (row.amountCents !== existing.amountCents) return false;
  if (row.normalisedDescription !== existing.normalisedDescription) return false;
  if (row.externalId !== null && existing.externalId !== null) return false;
  return true;
}
