import { describe, expect, it } from "vitest";
import { createTestRouter } from "./router.tsx";
import {
  clearedFilters,
  hasClearableFilters,
  hasFilters,
  oneTimeLink,
  validateTokenSearch,
  validateTransactionsSearch,
} from "./routes/search.ts";

/** The validated search params of the matched route (what `useSearch` gives a component). */
function search(router: Awaited<ReturnType<typeof load>>) {
  return router.state.matches.at(-1)?.search;
}

/** Loads a router at `href` and returns the location it settled on. */
async function load(href: string) {
  const router = createTestRouter([href]);
  await router.load();
  return router;
}

describe("typed search params", () => {
  it("round-trips the token through navigate and a reload", async () => {
    const router = await load("/");
    await router.navigate({ to: "/setup", search: { token: "abc_123-x" } });
    expect(router.state.location.pathname).toBe("/setup");
    expect(search(router)).toEqual({ token: "abc_123-x" });

    // A reload builds a new router from the URL the first one wrote.
    const reloaded = await load(router.history.location.href);
    expect(search(reloaded)).toEqual({ token: "abc_123-x" });
  });

  it("reads the token on /recover too", async () => {
    const router = await load("/recover?token=t0k3n");
    expect(search(router)).toEqual({ token: "t0k3n" });
  });

  it("falls back to no token for a bad value", () => {
    expect(validateTokenSearch({ token: "" })).toEqual({});
    expect(validateTokenSearch({ token: 42 })).toEqual({});
    expect(validateTokenSearch({ token: ["a", "b"] })).toEqual({});
    expect(validateTokenSearch({})).toEqual({});
    expect(validateTokenSearch({ token: "ok", other: 1 })).toEqual({ token: "ok" });
  });

  it("drops the token when navigating with a replace", async () => {
    const router = await load("/setup?token=abc");
    await router.navigate({ to: "/setup", search: {}, replace: true });
    expect(router.history.location.href).toBe("/setup");
    expect(router.history.length).toBe(1);
  });

  it("replaces /ledger with /transactions, keeping its filters, in one history entry", async () => {
    const router = await load("/ledger?type=in&account=a1&from=2026-07-01&to=2026-09-30");
    expect(router.state.location.pathname).toBe("/transactions");
    expect(router.history.location.href).toBe(
      "/transactions?account=a1&from=2026-07-01&to=2026-09-30&type=in",
    );
    expect(search(router)).toEqual({
      type: "in",
      account: "a1",
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(router.history.length).toBe(1);
  });

  it("drops a bad filter value and anything it does not know on /transactions", async () => {
    const router = await load(
      "/ledger?token=abc&type=sideways&from=yesterday&page=0&transfers=true",
    );
    expect(router.state.location.pathname).toBe("/transactions");
    expect(search(router)).toEqual({ transfers: "true" });
  });

  it("keeps a numeric-looking token a string", async () => {
    for (const token of ["1e5", "007", "12345", "true", "null"]) {
      const router = await load(`/setup?token=${token}`);
      expect(search(router), token).toEqual({ token });
      await router.navigate({ to: "/recover", search: { token } });
      expect(router.history.location.href).toBe(`/recover?token=${token}`);
    }
  });
});

describe("one-time link search", () => {
  it("reads the token only on /setup and /recover", () => {
    expect(oneTimeLink("/setup", { token: "x" })).toEqual({ token: "x", strip: true });
    expect(oneTimeLink("/recover", { token: "x" })).toEqual({ token: "x", strip: true });
    expect(oneTimeLink("/transactions", { token: "x" })).toEqual({ token: "", strip: false });
    expect(oneTimeLink("/", { token: "x" })).toEqual({ token: "", strip: false });
  });

  it("strips any search on those paths, valid or not", () => {
    expect(oneTimeLink("/recover", { x: "1" })).toEqual({ token: "", strip: true });
    expect(oneTimeLink("/recover", { token: "" })).toEqual({ token: "", strip: true });
    expect(oneTimeLink("/setup", {})).toEqual({ token: "", strip: false });
  });
});

describe("transactions search", () => {
  it("keeps well-formed filters and the paging position, as strings", () => {
    const given = {
      account: "01J0000000000000000000ACCT",
      category: "c-1",
      from: "2026-07-01",
      to: "2026-09-30",
      type: "out",
      uncategorised: "true",
      minCents: "100",
      after: "2026-08-01~01J0000000000000000000ABCD",
    };
    expect(validateTransactionsSearch(given)).toEqual(given);
    expect(validateTransactionsSearch({ page: "2" })).toEqual({ page: "2" });
  });

  it("drops what is malformed, unknown or not a string", () => {
    expect(
      validateTransactionsSearch({
        type: "x",
        uncategorised: "false",
        from: "2026-1-1",
        page: "1e5",
        after: "nonsense",
        account: "a b",
        tag: 5,
        other: "1",
      }),
    ).toEqual({});
  });

  it("drops what the server would refuse: fake dates, reversed pairs, two paging positions", () => {
    const cursor = "2026-08-01~01J0000000000000000000ABCD";
    expect(validateTransactionsSearch({ from: "2026-13-45", to: "2026-02-30" })).toEqual({});
    expect(validateTransactionsSearch({ from: "2026-02-28", to: "2026-03-01" })).toEqual({
      from: "2026-02-28",
      to: "2026-03-01",
    });
    expect(
      validateTransactionsSearch({ from: "2026-09-02", to: "2026-09-01", type: "in" }),
    ).toEqual({ type: "in" });
    expect(validateTransactionsSearch({ minCents: "9", maxCents: "1", hidden: "true" })).toEqual({
      hidden: "true",
    });
    expect(validateTransactionsSearch({ page: "2", after: cursor })).toEqual({ after: cursor });
    expect(validateTransactionsSearch({ page: "2", before: cursor })).toEqual({ before: cursor });
    expect(validateTransactionsSearch({ after: cursor, before: cursor })).toEqual({
      after: cursor,
    });
    expect(validateTransactionsSearch({ page: "1000000" })).toEqual({ page: "1000000" });
    expect(validateTransactionsSearch({ page: "1000001" })).toEqual({});
  });

  it("tells a filter Clear filters resets from the date range, which it keeps", () => {
    expect(hasClearableFilters({ from: "2026-07-01", to: "2026-09-30" })).toBe(false);
    expect(hasClearableFilters({ from: "2026-07-01", type: "in" })).toBe(true);
    expect(hasClearableFilters({ page: "2" })).toBe(false);
  });

  it("clears every filter but the date range, and the paging position", () => {
    const search = {
      type: "in",
      from: "2026-07-01",
      to: "2026-09-30",
      account: "a",
      page: "2",
    } as const;
    expect(hasFilters({ page: "2" })).toBe(false);
    expect(hasFilters({ from: "2026-07-01" })).toBe(true);
    expect(clearedFilters(search)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(clearedFilters({ type: "in" })).toEqual({});
  });
});
