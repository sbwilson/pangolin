import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type {
  TransactionCursor,
  TransactionPageAt,
  TransactionRow,
} from "../ports/unit-of-work.ts";
import {
  decodeCursor,
  encodeCursor,
  type ListTransactionsInput,
  listTransactionsInput,
  TRANSACTION_PAGE_SIZE,
  toTransactionFilter,
} from "./transaction-query.ts";
import { toLedgerTransaction } from "./transaction-view.ts";
import type { LedgerPage, LedgerSplit, LedgerTransaction, LedgerTransactionList } from "./types.ts";

export type { LedgerPage, LedgerSplit, LedgerTransaction, LedgerTransactionList };
export { type ListTransactionsInput, listTransactionsInput };

const cursorOf = (row: Pick<TransactionRow, "postedOn" | "id">) =>
  encodeCursor({ postedOn: row.postedOn, id: row.id });

/**
 * `ledger.listTransactions`: a page of the transactions in every account the viewer can see
 * (public accounts and their own private ones), newest first, each with its splits, narrowed by
 * the filters in `input` and paged by keyset cursor (`after` or `before`) or by `page` (which
 * counts rows to find the page's first row and hands back the cursors for paging on). Names
 * hidden from the viewer are projected away in SQL for `ctx.clock.today()` and rendered by
 * `redact`. Filters read the projection, so another person's scoped payee, tag or hidden name
 * cannot be probed. A `page` past the last is `Validation`.
 */
export function listTransactions(
  ctx: UseCaseContext,
  input: ListTransactionsInput = {},
): LedgerTransactionList {
  const query = parseInput(listTransactionsInput, input);
  const filter = toTransactionFilter(query);
  const today = ctx.clock.today().toString();
  const size = TRANSACTION_PAGE_SIZE;
  return ctx.uow.read((repos) => {
    const txns = repos.transactions;
    const summary = txns.summarise(ctx.viewer, today, filter);
    const pageCount = Math.max(1, Math.ceil(summary.count / size));
    const fetch = (at: TransactionPageAt) => txns.listPage(ctx.viewer, today, filter, at, size);

    let at: TransactionPageAt = { offset: 0 };
    if (query.page !== undefined) {
      if (query.page > pageCount) throw new AppError("Validation", "That page does not exist");
      at = { offset: (query.page - 1) * size };
    } else if (query.after !== undefined) {
      at = { after: decode(query.after) };
    } else if (query.before !== undefined) {
      at = { before: decode(query.before) };
    }

    let rows = fetch(at);
    // A cursor whose neighbours have gone: a short run before it is the first page, nothing after
    // it is the last, so a stale cursor still lands on a whole page.
    if ("before" in at && rows.length < size && summary.count > rows.length) {
      at = { offset: 0 };
      rows = fetch(at);
    } else if ("after" in at && rows.length === 0 && summary.count > 0) {
      at = { offset: (pageCount - 1) * size };
      rows = fetch(at);
    }

    const first = rows[0];
    const last = rows[rows.length - 1];
    const preceding =
      "offset" in at
        ? at.offset
        : first === undefined
          ? 0
          : txns.countBefore(ctx.viewer, today, filter, {
              postedOn: first.postedOn,
              id: first.id,
            });

    const tags = repos.tags.listForSplits(
      ctx.viewer,
      rows.flatMap((row) => row.splits.map((s) => s.id)),
    );
    const days = [...new Set(rows.map((row) => row.postedOn))];
    return {
      transactions: rows.map((row) => toLedgerTransaction(ctx.viewer, row, tags)),
      page: {
        total: summary.count,
        pageCount,
        page: Math.min(pageCount, Math.floor(preceding / size) + 1),
        next: last !== undefined && preceding + rows.length < summary.count ? cursorOf(last) : null,
        prev: first !== undefined && preceding > 0 ? cursorOf(first) : null,
      },
      summary,
      dayNets: days.length === 0 ? {} : txns.dayNets(ctx.viewer, today, filter, days),
    };
  });
}

/** A cursor `parseInput` has already checked. */
function decode(cursor: string): TransactionCursor {
  const found = decodeCursor(cursor);
  if (found === undefined) throw new AppError("Validation", "Invalid cursor");
  return found;
}

/**
 * Every row `listTransactions` would return over all its pages, in list order, by following the
 * `next` cursor. For seeds, checks and tests that need the whole list; the web pages.
 */
export function listAllTransactions(
  ctx: UseCaseContext,
  input: Omit<ListTransactionsInput, "page" | "after" | "before"> = {},
): LedgerTransaction[] {
  const rows: LedgerTransaction[] = [];
  let after: string | undefined;
  for (;;) {
    const list = listTransactions(ctx, after === undefined ? input : { ...input, after });
    rows.push(...list.transactions);
    if (list.page.next === null) return rows;
    after = list.page.next;
  }
}
