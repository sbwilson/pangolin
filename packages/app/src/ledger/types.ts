import type {
  SplitRow,
  TagRow,
  TransactionSummary,
  VisibleTransaction,
} from "../ports/unit-of-work.ts";

/** A split as a read returns it, with the tags it carries (only those the viewer may see). */
export type LedgerSplit = SplitRow & { readonly tags: readonly TagRow[] };

/**
 * A transaction as a read returns it: a hidden name reads "Hidden until <date>" (AD-4), so the
 * description is always text. `remainingCents` is the amount less the sum of its splits, worked
 * out by the server (0 when they add up).
 */
export type LedgerTransaction = Omit<VisibleTransaction, "descriptionRaw" | "splits"> & {
  readonly descriptionRaw: string;
  readonly splits: readonly LedgerSplit[];
  readonly remainingCents: number;
};

/** Where a page sits in the whole filtered list. */
export interface LedgerPage {
  /** Rows the filter leaves, over every page. */
  readonly total: number;
  /** At least 1, even with no rows. */
  readonly pageCount: number;
  /** The 1-based number of this page. */
  readonly page: number;
  /** Pass as `after` for the page that follows; null on the last page. */
  readonly next: string | null;
  /** Pass as `before` for the page that precedes; null on the first page. */
  readonly prev: string | null;
}

/** One page of the transaction list with the numbers the server owns (the web never sums). */
export interface LedgerTransactionList {
  readonly transactions: LedgerTransaction[];
  readonly page: LedgerPage;
  /** Count and money in and out over the whole filter, not just this page. */
  readonly summary: TransactionSummary;
  /** The net of every row the filter leaves on each date shown on this page. */
  readonly dayNets: Record<string, number>;
}
