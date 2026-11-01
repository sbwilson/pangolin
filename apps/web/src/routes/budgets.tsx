import { createRoute } from "@tanstack/react-router";
import { BudgetsPage } from "../pages/BudgetsPage.tsx";
import { rootRoute } from "./root.tsx";

/** `/planning/budgets`: the budgets workspace UI. */
export const budgetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/planning/budgets",
  component: BudgetsPage,
});
