import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { SplitRow, TagRow, VisibleTransaction } from "../ports/unit-of-work.ts";
import { toLedgerTransaction } from "./transaction-view.ts";

export const listTransactionsInput = z.object({}).strict();
export type ListTransactionsInput = z.input<typeof listTransactionsInput>;

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

/**
 * `ledger.listTransactions`: the transactions in every account the viewer can see (public
 * accounts and their own private ones), newest first, each with its splits. Names hidden from
 * the viewer are projected away in SQL for `ctx.clock.today()` and rendered by `redact`.
 */
export function listTransactions(
  ctx: UseCaseContext,
  input: ListTransactionsInput = {},
): LedgerTransaction[] {
  parseInput(listTransactionsInput, input);
  const today = ctx.clock.today().toString();
  return ctx.uow.read((repos) => {
    const rows = repos.transactions.listVisible(ctx.viewer, today);
    const tags = repos.tags.listForSplits(
      ctx.viewer,
      rows.flatMap((row) => row.splits.map((s) => s.id)),
    );
    return rows.map((row) => toLedgerTransaction(ctx.viewer, row, tags));
  });
}
