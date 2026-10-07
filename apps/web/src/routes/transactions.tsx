import { createRoute } from "@tanstack/react-router";
import { TransactionsPage } from "../pages/TransactionsPage.tsx";
import { rootRoute } from "./root.tsx";
import { validateTransactionsSearch } from "./search.ts";

/** `/transactions`: filters, date range and paging position are typed search params. */
export const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  validateSearch: validateTransactionsSearch,
  component: TransactionsPage,
});
