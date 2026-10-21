/** The outcome of checking a statement's printed running balances (import pipeline step 7). */
export type ReconcileStatus = "ok" | "gap" | "unavailable";

export interface ReconcileResult {
  readonly status: ReconcileStatus;
  /** The sum of the absolute mismatches between adjacent printed balances, in cents; 0 unless `gap`. */
  readonly gapCents: number;
  /**
   * The balance before the oldest balanced row (its balance minus its amount), in cents; null
   * unless `ok`.
   */
  readonly openingCents: number | null;
  /** The printed balance of the newest balanced row, in cents; null unless `ok`. */
  readonly closingCents: number | null;
}

/** The two fields of a parsed row that reconciling reads. */
export interface ReconcileRow {
  readonly amountCents: number;
  readonly balanceCents?: number | null | undefined;
}

/**
 * Checks that a statement's printed running balances chain, in file order. The file may list
 * newest first or oldest first; the orientation that fits more adjacent pairs is used (on a tie, the one with the smaller
 * mismatch).
 *
 * Oldest first: `b[i] - b[i-1] = amount[i]`. Newest first: `b[i-1] - b[i] = amount[i-1]`. Only
 * pairs where both rows print a balance are tested. With no such pair (no balances, or a single
 * balanced row) the result is `unavailable`, never a failure. Otherwise `gap` when any pair
 * breaks in the chosen orientation, with the absolute mismatches summed.
 *
 * When `ok`, also returns the statement's opening and closing balances. The orientation decides
 * which end of the file is oldest, so same-day rows keep their file order: the opening is the
 * oldest balanced row's balance minus its amount, the closing the newest balanced row's balance.
 */
export function reconcileStatement(rows: readonly ReconcileRow[]): ReconcileResult {
  let pairs = 0;
  let ascMismatch = 0;
  let ascBroken = 0;
  let descMismatch = 0;
  let descBroken = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const pb = prev?.balanceCents;
    const cb = cur?.balanceCents;
    if (prev === undefined || cur === undefined) continue;
    if (pb === null || pb === undefined || cb === null || cb === undefined) continue;
    pairs += 1;
    const asc = Math.abs(cb - pb - cur.amountCents);
    if (asc !== 0) {
      ascBroken += 1;
      ascMismatch += asc;
    }
    const desc = Math.abs(pb - cb - prev.amountCents);
    if (desc !== 0) {
      descBroken += 1;
      descMismatch += desc;
    }
  }
  if (pairs === 0) {
    return { status: "unavailable", gapCents: 0, openingCents: null, closingCents: null };
  }
  const useAsc = ascBroken !== descBroken ? ascBroken < descBroken : ascMismatch <= descMismatch;
  const broken = useAsc ? ascBroken : descBroken;
  const gapCents = useAsc ? ascMismatch : descMismatch;
  if (broken !== 0) return { status: "gap", gapCents, openingCents: null, closingCents: null };
  // Opening and closing are only trustworthy when the orientation is unambiguous (the other
  // one does not chain too) and the oldest row itself prints a balance.
  const ambiguous = ascBroken === 0 && descBroken === 0;
  const oldest = useAsc ? rows[0] : rows[rows.length - 1];
  const balanced = rows.filter((r) => r.balanceCents !== null && r.balanceCents !== undefined);
  const newest = useAsc ? balanced[balanced.length - 1] : balanced[0];
  const oldestBalance = oldest?.balanceCents;
  if (
    ambiguous ||
    oldest === undefined ||
    newest === undefined ||
    oldestBalance === null ||
    oldestBalance === undefined
  ) {
    return { status: "ok", gapCents: 0, openingCents: null, closingCents: null };
  }
  return {
    status: "ok",
    gapCents: 0,
    openingCents: oldestBalance - oldest.amountCents,
    closingCents: newest.balanceCents as number,
  };
}
