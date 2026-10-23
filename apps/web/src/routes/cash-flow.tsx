import { createRoute } from "@tanstack/react-router";
import { CashFlowPage } from "../pages/CashFlowPage.tsx";
import { rootRoute } from "./root.tsx";
import { validateCashFlowSearch } from "./search.ts";

/** `/cash-flow`: the landing page; the range is `from`/`to` in the URL, else this quarter. */
export const cashFlowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cash-flow",
  validateSearch: validateCashFlowSearch,
  component: CashFlowPage,
});
