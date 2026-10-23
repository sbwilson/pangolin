import { createRoute } from "@tanstack/react-router";
import { CashFlowPage } from "../pages/CashFlowPage.tsx";
import { rootRoute } from "./root.tsx";

/** `/cash-flow`: the landing page, money in, money out and kept this quarter. */
export const cashFlowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cash-flow",
  component: CashFlowPage,
});
