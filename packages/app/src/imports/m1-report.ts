import { daysApart, shiftDay } from "@pangolin/domain";
import type { UseCaseContext } from "../context.ts";
import type { BalanceSnapshotRow, ImportBatchRow, ReconcileStatus } from "../ports/unit-of-work.ts";

/** The start of the history the M1 gate covers (FY2025). */
export const M1_HISTORY_START = "2024-07-01";

/** A span of calendar days, both ends inclusive (`YYYY-MM-DD`). */
export interface DaySpan {
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

/** A batch whose printed running balances did not chain. */
export interface M1BrokenBatch {
  readonly batchId: string;
  readonly source: string;
  readonly firstPostedOn: string | null;
  readonly lastPostedOn: string | null;
  readonly gapCents: number;
}

/** Two batches that join end to end but disagree: the earlier closes at one balance, the next opens at another. */
export interface M1JoinBreak {
  readonly previousBatchId: string;
  readonly nextBatchId: string;
  /** The earlier batch's last date and closing balance. */
  readonly previousLastPostedOn: string;
  readonly closingCents: number;
  /** The next batch's first date and opening balance. */
  readonly nextFirstPostedOn: string;
  readonly openingCents: number;
}

/** The opening balance an account's coverage starts from. */
export interface M1OpeningStart {
  readonly asOf: string;
  readonly balanceCents: number;
}

/** The ledger's balance on the account's newest covered date, to compare with the bank. */
export interface M1LedgerBalance {
  readonly asOf: string;
  readonly balanceCents: number;
}

export interface M1AccountReport {
  readonly accountId: string;
  readonly name: string;
  /** Committed, non-undone batches. */
  readonly batches: number;
  /** Of those, batches the balance check could not run on (`unavailable`, or from before 0019). */
  readonly unchecked: number;
  /** The union of the batches' first-to-last posted dates, merged where they touch. */
  readonly covered: readonly DaySpan[];
  /** Calendar months with at least one covered day, from `M1_HISTORY_START`. */
  readonly monthsCovered: number;
  /** Uncovered spans between `M1_HISTORY_START` and the newest covered date. */
  readonly holes: readonly DaySpan[];
  readonly brokenBatches: readonly M1BrokenBatch[];
  /** Set when the leading span (before the first covered date) is accepted: the snapshot it starts from. */
  readonly startsFrom: M1OpeningStart | null;
  /** Consecutive non-overlapping batches whose closing and opening balances disagree. */
  readonly joinBreaks: readonly M1JoinBreak[];
  /** Consecutive non-overlapping batch pairs not compared because a closing or opening is not recorded. */
  readonly joinsUnchecked: number;
  /**
   * `balanceAsOf` at the newest covered date; null when no accepted opening snapshot precedes the
   * first covered date (the sum would start from 0), or when there is nothing to compare.
   */
  readonly ledgerBalance: M1LedgerBalance | null;
}

export interface M1Report {
  readonly from: string;
  readonly accounts: readonly M1AccountReport[];
  /** Accounts with no statement at all: no span to count, so listed apart from the gaps. */
  readonly accountsWithoutStatements: number;
  /** Totals the gate's machine check reads: both must be zero. */
  readonly totals: {
    readonly holes: number;
    readonly brokenBatches: number;
    readonly joinBreaks: number;
    readonly joinsUnchecked: number;
  };
}

function span(from: string, to: string): DaySpan {
  return { from, to, days: daysApart(from, to) + 1 };
}

/** Merges ranges that overlap or touch (the next starts the day after, or earlier). */
function union(ranges: readonly { from: string; to: string }[]): DaySpan[] {
  const sorted = [...ranges].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const merged: { from: string; to: string }[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && r.from <= shiftDay(last.to, 1)) {
      if (r.to > last.to) last.to = r.to;
    } else {
      merged.push({ from: r.from, to: r.to });
    }
  }
  return merged.map((m) => span(m.from, m.to));
}

function monthsTouched(covered: readonly DaySpan[], from: string): number {
  const months = new Set<string>();
  for (const s of covered) {
    let month = (s.from < from ? from : s.from).slice(0, 7);
    const last = s.to.slice(0, 7);
    while (month <= last) {
      months.add(month);
      const [y, m] = month.split("-").map(Number) as [number, number];
      month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  return months.size;
}

/** The report for one account from its committed, non-undone batches. */
export function accountReport(
  account: { readonly id: string; readonly name: string },
  batches: readonly ImportBatchRow[],
  from: string = M1_HISTORY_START,
  snapshots: readonly BalanceSnapshotRow[] = [],
  balanceOn?: (date: string) => number | undefined,
): M1AccountReport {
  const dated = batches.flatMap((b) =>
    b.firstPostedOn !== null && b.lastPostedOn !== null
      ? [{ from: b.firstPostedOn, to: b.lastPostedOn }]
      : [],
  );
  const covered = union(dated);
  const holes: DaySpan[] = [];
  let startsFrom: M1OpeningStart | null = null;
  // The openings the first covered batches derived from their own statements: a snapshot that
  // disagrees with them does not make the start trustworthy.
  const firstDate = covered[0]?.from;
  const firstOpenings = batches
    .filter((b) => b.firstPostedOn === firstDate && b.openingBalanceCents !== null)
    .map((b) => b.openingBalanceCents as number);
  const newest = covered[covered.length - 1]?.to;
  const firstCovered = covered[0]?.from;
  if (newest !== undefined && newest >= from) {
    let cursor = from;
    for (const s of covered) {
      if (s.to < cursor) continue;
      if (s.from > cursor) {
        // The leading span is accepted when a snapshot (the opening balance) precedes the first
        // covered date; interior holes are always counted.
        const leading = s.from === firstCovered;
        const opening = leading ? openingBefore(snapshots, s.from, firstOpenings) : undefined;
        if (opening !== undefined) startsFrom = opening;
        else holes.push(span(cursor, shiftDay(s.from, -1)));
      }
      cursor = shiftDay(s.to, 1);
    }
  }
  const brokenBatches = batches
    .filter((b) => b.reconcileStatus === "gap")
    .map(
      (b): M1BrokenBatch => ({
        batchId: b.id,
        source: b.source,
        firstPostedOn: b.firstPostedOn,
        lastPostedOn: b.lastPostedOn,
        gapCents: b.reconcileGapCents ?? 0,
      }),
    );
  const { breaks: joinBreaks, unchecked: joinsUnchecked } = joinBreaksOf(batches);
  let ledgerBalance: M1LedgerBalance | null = null;
  if (
    balanceOn !== undefined &&
    newest !== undefined &&
    firstCovered !== undefined &&
    openingBefore(snapshots, firstCovered, firstOpenings) !== undefined
  ) {
    const balanceCents = balanceOn(newest);
    if (balanceCents !== undefined) ledgerBalance = { asOf: newest, balanceCents };
  }
  const checked = (s: ReconcileStatus | null) => s === "ok" || s === "gap";
  return {
    accountId: account.id,
    name: account.name,
    batches: batches.length,
    unchecked: batches.filter((b) => !checked(b.reconcileStatus)).length,
    covered,
    monthsCovered: monthsTouched(covered, from),
    holes,
    brokenBatches,
    startsFrom,
    joinBreaks,
    joinsUnchecked,
    ledgerBalance,
  };
}

/**
 * The latest snapshot dated before `day`, if any; when the first batches derived openings of
 * their own (`balances`), only a snapshot with one of those balances counts.
 */
function openingBefore(
  snapshots: readonly BalanceSnapshotRow[],
  day: string,
  balances: readonly number[],
): M1OpeningStart | undefined {
  let best: BalanceSnapshotRow | undefined;
  for (const snap of snapshots) {
    if (balances.length > 0 && !balances.includes(snap.balanceCents)) continue;
    if (snap.asOf < day && (best === undefined || snap.asOf > best.asOf)) best = snap;
  }
  return best === undefined ? undefined : { asOf: best.asOf, balanceCents: best.balanceCents };
}

/**
 * Batches ordered by first date: where the next starts after the previous ends and both record
 * a closing/opening balance, they must agree. Overlapping batches are not checked.
 */
function joinBreaksOf(batches: readonly ImportBatchRow[]): {
  breaks: M1JoinBreak[];
  unchecked: number;
} {
  const dated = batches
    .filter((b) => b.firstPostedOn !== null && b.lastPostedOn !== null)
    .sort((a, b) =>
      (a.firstPostedOn as string) < (b.firstPostedOn as string)
        ? -1
        : (a.firstPostedOn as string) > (b.firstPostedOn as string)
          ? 1
          : (a.lastPostedOn as string) < (b.lastPostedOn as string)
            ? -1
            : (a.lastPostedOn as string) > (b.lastPostedOn as string)
              ? 1
              : 0,
    );
  const breaks: M1JoinBreak[] = [];
  let unchecked = 0;
  // Each batch is compared with the one reaching furthest so far, so a batch nested inside
  // another is skipped as an overlap and never hides the real predecessor.
  let reach: ImportBatchRow | undefined;
  for (const next of dated) {
    const nextFirst = next.firstPostedOn as string;
    if (reach !== undefined && nextFirst > (reach.lastPostedOn as string)) {
      const closing = reach.closingBalanceCents;
      const opening = next.openingBalanceCents;
      if (closing === null || opening === null) {
        unchecked += 1;
      } else if (closing !== opening) {
        breaks.push({
          previousBatchId: reach.id,
          nextBatchId: next.id,
          previousLastPostedOn: reach.lastPostedOn as string,
          closingCents: closing,
          nextFirstPostedOn: nextFirst,
          openingCents: opening,
        });
      }
    }
    if (reach === undefined || (next.lastPostedOn as string) > (reach.lastPostedOn as string)) {
      reach = next;
    }
  }
  return { breaks, unchecked };
}

/**
 * `imports.m1GateReport`: the M1 gate's machine check, read-only. For every account (closed ones
 * too) it lists the balance-chain breaks (batches `reconcile_status = gap`) and the holes in
 * statement coverage: calendar spans between 1 July 2024 and the account's newest covered date
 * that no non-undone batch's first-to-last posted dates reach, and the join breaks (consecutive
 * batches whose closing and opening balances disagree). A leading span that starts from an
 * opening balance snapshot is accepted, not a hole. The gate's check is zero of each;
 * whether a listed span is explained (a weekend, an account opened later) is the human's call.
 */
export function m1GateReport(ctx: UseCaseContext): M1Report {
  return ctx.uow.read((repos) => {
    const accounts = repos.accounts.list(ctx.viewer).map((a) => {
      const batches = repos.importBatches.listCommittedForAccount(ctx.viewer, a.id);
      return accountReport(
        a,
        batches,
        M1_HISTORY_START,
        repos.balanceSnapshots.listVisible(ctx.viewer, a.id),
        (date) => repos.balanceSnapshots.balanceAsOf(ctx.viewer, a.id, date),
      );
    });
    return {
      from: M1_HISTORY_START,
      accounts,
      accountsWithoutStatements: accounts.filter((a) => a.batches === 0).length,
      totals: {
        holes: accounts.reduce((n, a) => n + a.holes.length, 0),
        brokenBatches: accounts.reduce((n, a) => n + a.brokenBatches.length, 0),
        joinBreaks: accounts.reduce((n, a) => n + a.joinBreaks.length, 0),
        joinsUnchecked: accounts.reduce((n, a) => n + a.joinsUnchecked, 0),
      },
    };
  });
}
