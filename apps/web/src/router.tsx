import { createMemoryHistory, createRouter, type RouterHistory } from "@tanstack/react-router";
import { accountRoute, accountsRoute } from "./routes/accounts.tsx";
import { cashFlowRoute } from "./routes/cash-flow.tsx";
import { homeRoute } from "./routes/home.tsx";
import { ledgerRoute } from "./routes/ledger.tsx";
import { netWorthRoute } from "./routes/net-worth.tsx";
import { recoverRoute } from "./routes/recover.tsx";
import { reviewRoute } from "./routes/review.tsx";
import { rootRoute } from "./routes/root.tsx";
import { parseSearch, stringifySearch } from "./routes/search.ts";
import { settingsRoute } from "./routes/settings.tsx";
import { setupRoute } from "./routes/setup.tsx";
import { signInRoute } from "./routes/sign-in.tsx";
import { spendingRoute } from "./routes/spending.tsx";
import { transactionsRoute } from "./routes/transactions.tsx";

// A later page adds its route object here, and nothing else in the shell changes.
const routeTree = rootRoute.addChildren([
  homeRoute,
  cashFlowRoute,
  netWorthRoute,
  spendingRoute,
  transactionsRoute,
  accountsRoute,
  accountRoute,
  ledgerRoute,
  reviewRoute,
  setupRoute,
  recoverRoute,
  signInRoute,
  settingsRoute,
]);

/** The app's router. It uses browser history unless given one (tests pass a memory history). */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    parseSearch,
    stringifySearch,
    ...(history === undefined ? {} : { history }),
  });
}

/** A router on a memory history, for tests in node (no DOM): `isServer: false` makes it commit
 * navigations to the history as a browser would. */
export function createTestRouter(initialEntries: string[]) {
  return createRouter({
    routeTree,
    parseSearch,
    stringifySearch,
    history: createMemoryHistory({ initialEntries }),
    isServer: false,
    origin: "http://localhost",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
