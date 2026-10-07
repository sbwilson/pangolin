import { createRoute, redirect } from "@tanstack/react-router";
import { rootRoute } from "./root.tsx";
import { validateTransactionsSearch } from "./search.ts";

/**
 * `/ledger` is the old path of the transaction list: it replaces itself with `/transactions`,
 * keeping the filters in its search params (a bad value is dropped), so a bookmark or a shared link still works and adds no history entry.
 */
export const ledgerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ledger",
  validateSearch: validateTransactionsSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/transactions",
      search: validateTransactionsSearch(search),
      replace: true,
    });
  },
});
