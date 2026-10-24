import { createRoute } from "@tanstack/react-router";
import { NetWorthPage } from "../pages/NetWorthPage.tsx";
import { rootRoute } from "./root.tsx";

/** `/net-worth`: view household and personal net worth, 12-month trend, assets and liabilities breakdown. */
export const netWorthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/net-worth",
  component: NetWorthPage,
});
