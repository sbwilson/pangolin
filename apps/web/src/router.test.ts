import { describe, expect, it } from "vitest";
import { createTestRouter } from "./router.tsx";
import { oneTimeLink, validateTokenSearch } from "./routes/search.ts";

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

  it("serves /ledger without search params", async () => {
    const router = await load("/ledger?token=abc");
    expect(router.state.location.pathname).toBe("/ledger");
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
    expect(oneTimeLink("/ledger", { token: "x" })).toEqual({ token: "", strip: false });
    expect(oneTimeLink("/", { token: "x" })).toEqual({ token: "", strip: false });
  });

  it("strips any search on those paths, valid or not", () => {
    expect(oneTimeLink("/recover", { x: "1" })).toEqual({ token: "", strip: true });
    expect(oneTimeLink("/recover", { token: "" })).toEqual({ token: "", strip: true });
    expect(oneTimeLink("/setup", {})).toEqual({ token: "", strip: false });
  });
});
