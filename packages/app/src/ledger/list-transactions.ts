import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { VisibleTransaction } from "../ports/unit-of-work.ts";
import { redact } from "../redact.ts";

export const listTransactionsInput = z.object({}).strict();
export type ListTransactionsInput = z.input<typeof listTransactionsInput>;

/**
 * A transaction as the list returns it: a hidden name reads "Hidden until <date>" (AD-4), so
 * the description is always text.
 */
export type LedgerTransaction = Omit<VisibleTransaction, "descriptionRaw"> & {
  readonly descriptionRaw: string;
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
  const rows = ctx.uow.read((repos) => repos.transactions.listVisible(ctx.viewer, today));
  return redact(ctx.viewer, rows) as LedgerTransaction[];
}
