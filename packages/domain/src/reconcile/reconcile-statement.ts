/** The outcome of checking a statement's printed running balances (import pipeline step 7). */
export type ReconcileStatus = "ok" | "gap" | "unavailable";

export interface ReconcileResult {
  readonly status: ReconcileStatus;
  /** The sum of the absolute mismatches between adjacent printed balances, in cents; 0 unless `gap`. */
  readonly gapCents: number;
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
  if (pairs === 0) return { status: "unavailable", gapCents: 0 };
  const useAsc = ascBroken !== descBroken ? ascBroken < descBroken : ascMismatch <= descMismatch;
  const broken = useAsc ? ascBroken : descBroken;
  const gapCents = useAsc ? ascMismatch : descMismatch;
  return broken === 0 ? { status: "ok", gapCents: 0 } : { status: "gap", gapCents };
}
