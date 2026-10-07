import { createRoute } from "@tanstack/react-router";
import { AccountPage } from "../pages/AccountPage.tsx";
import { AccountsPage } from "../pages/AccountsPage.tsx";
import { rootRoute } from "./root.tsx";
import { validateTransactionsSearch } from "./search.ts";

/** `/accounts`: the accounts the signed-in person can see, grouped. */
export const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: AccountsPage,
});

/**
 * `/accounts/:id`: one account with its transactions. The date range and paging position are the
 * same typed search params as `/transactions`.
 */
export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts/$id",
  validateSearch: validateTransactionsSearch,
  component: AccountPage,
});
