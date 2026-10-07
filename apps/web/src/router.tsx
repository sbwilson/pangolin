import { createMemoryHistory, createRouter, type RouterHistory } from "@tanstack/react-router";
import { homeRoute } from "./routes/home.tsx";
import { ledgerRoute } from "./routes/ledger.tsx";
import { recoverRoute } from "./routes/recover.tsx";
import { rootRoute } from "./routes/root.tsx";
import { parseSearch, stringifySearch } from "./routes/search.ts";
import { setupRoute } from "./routes/setup.tsx";
import { transactionsRoute } from "./routes/transactions.tsx";

// A later page adds its route object here, and nothing else in the shell changes.
const routeTree = rootRoute.addChildren([
  homeRoute,
  transactionsRoute,
  ledgerRoute,
  setupRoute,
  recoverRoute,
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
