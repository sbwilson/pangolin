import { createRoute } from "@tanstack/react-router";
import { LedgerPage } from "../pages/LedgerPage.tsx";
import { rootRoute } from "./root.tsx";

export const ledgerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ledger",
  component: LedgerPage,
});
