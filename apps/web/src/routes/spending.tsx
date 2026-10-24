import { createRoute } from "@tanstack/react-router";
import { SpendingPage } from "../pages/SpendingPage.tsx";
import { rootRoute } from "./root.tsx";
import { validateCashFlowSearch } from "./search.ts";

/** `/spending`: explore spending patterns, breakdown income vs expenses, category bars. */
export const spendingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spending",
  validateSearch: validateCashFlowSearch,
  component: SpendingPage,
});
