import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { TransactionWithSplits } from "../ports/unit-of-work.ts";

export const listTransactionsInput = z.object({}).strict();
export type ListTransactionsInput = z.input<typeof listTransactionsInput>;

/** A transaction as the list returns it. */
export type LedgerTransaction = TransactionWithSplits;

/**
 * `ledger.listTransactions`: the transactions in every account the viewer can see (public
 * accounts and their own private ones), newest first, each with its splits.
 */
export function listTransactions(
  ctx: UseCaseContext,
  input: ListTransactionsInput = {},
): LedgerTransaction[] {
  parseInput(listTransactionsInput, input);
  return ctx.uow.read((repos) => repos.transactions.listVisible(ctx.viewer));
}
