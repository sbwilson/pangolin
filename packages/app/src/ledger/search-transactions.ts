import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import {
  type LedgerTransactionList,
  type ListTransactionsInput,
  listTransactions,
  listTransactionsInput,
} from "./list-transactions.ts";
import { parseSearch } from "./search-query.ts";

/**
 * `ledger.searchTransactions`: `listTransactions` with a search (`q`) required, so the result has
 * the same rows, page, summary and day nets for the same filters. A `q` with nothing to search
 * for (blank, or only punctuation) is `Validation`; the list takes it as no filter. A row whose
 * name is hidden from the viewer never matches, by name, notes or amount.
 */
export function searchTransactions(
  ctx: UseCaseContext,
  input: ListTransactionsInput,
): LedgerTransactionList {
  const query = parseInput(listTransactionsInput, input);
  if (query.q === undefined || parseSearch(query.q) === undefined) {
    throw new AppError("Validation", "Enter something to search for");
  }
  return listTransactions(ctx, query);
}
