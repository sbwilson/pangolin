import { daysApart, shiftDay } from "@pangolin/domain";
import type { UseCaseContext } from "../context.ts";
import type { ImportBatchRow, ReconcileStatus } from "../ports/unit-of-work.ts";

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
}

export interface M1Report {
  readonly from: string;
  readonly accounts: readonly M1AccountReport[];
  /** Accounts with no statement at all: no span to count, so listed apart from the gaps. */
  readonly accountsWithoutStatements: number;
  /** Totals the gate's machine check reads: both must be zero. */
  readonly totals: { readonly holes: number; readonly brokenBatches: number };
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
): M1AccountReport {
  const dated = batches.flatMap((b) =>
    b.firstPostedOn !== null && b.lastPostedOn !== null
      ? [{ from: b.firstPostedOn, to: b.lastPostedOn }]
      : [],
  );
  const covered = union(dated);
  const holes: DaySpan[] = [];
  const newest = covered[covered.length - 1]?.to;
  if (newest !== undefined && newest >= from) {
    let cursor = from;
    for (const s of covered) {
      if (s.to < cursor) continue;
      if (s.from > cursor) holes.push(span(cursor, shiftDay(s.from, -1)));
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
  };
}

/**
 * `imports.m1GateReport`: the M1 gate's machine check, read-only. For every account (closed ones
 * too) it lists the balance-chain breaks (batches `reconcile_status = gap`) and the holes in
 * statement coverage: calendar spans between 1 July 2024 and the account's newest covered date
 * that no non-undone batch's first-to-last posted dates reach. The gate's check is zero of each;
 * whether a listed span is explained (a weekend, an account opened later) is the human's call.
 */
export function m1GateReport(ctx: UseCaseContext): M1Report {
  return ctx.uow.read((repos) => {
    const accounts = repos.accounts.list(ctx.viewer).map((a) => {
      const batches = repos.importBatches.listCommittedForAccount(ctx.viewer, a.id);
      return accountReport(a, batches);
    });
    return {
      from: M1_HISTORY_START,
      accounts,
      accountsWithoutStatements: accounts.filter((a) => a.batches === 0).length,
      totals: {
        holes: accounts.reduce((n, a) => n + a.holes.length, 0),
        brokenBatches: accounts.reduce((n, a) => n + a.brokenBatches.length, 0),
      },
    };
  });
}
