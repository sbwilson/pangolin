// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { ApiError } from "../api.ts";
import { formatCents } from "../lib/money.ts";
import { parseSearch, stringifySearch, validateCashFlowSearch } from "../routes/search.ts";
import { CashFlowPage, formatSavingsRate } from "./CashFlowPage.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchCashFlow: vi.fn(),
  fetchSharedShare: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.resetAllMocks();
});

const report = (range: { from: string; to: string }) => ({
  ...range,
  moneyInCents: 512345,
  moneyOutCents: 300000,
  keptCents: 212345,
  savingsRatePermille: 414,
});

const shareReport = (range: { from: string; to: string }) => ({
  ...range,
  setting: "contribution" as const,
  basis: "contribution" as const,
  sharedCents: 123456,
  shareCents: 74074,
  sharePercent: 60,
});

function renderPage(url: string) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/cash-flow",
    validateSearch: validateCashFlowSearch,
    component: CashFlowPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    parseSearch,
    stringifySearch,
    history: createMemoryHistory({ initialEntries: [url] }),
    isServer: false,
    origin: "http://localhost",
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const figure = (tiles: HTMLElement, label: string) =>
  within(tiles).getByText(label).parentElement?.querySelector("dd")?.textContent;

describe("CashFlowPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 7, 14, 12), toFake: ["Date"] });
    vi.mocked(api.fetchCashFlow).mockImplementation(async (range) => report(range));
    vi.mocked(api.fetchSharedShare).mockImplementation(async (range) => shareReport(range));
  });

  it("shows the share line under the tiles with the server's figures and percent", async () => {
    renderPage("/cash-flow?from=2026-07-01&to=2026-09-30");
    const line = await screen.findByTestId("share-line-text");
    expect(line.textContent).toBe(
      `Your share: ${formatCents(74074)} of ${formatCents(123456)} shared (60%)`,
    );
    expect(api.fetchSharedShare).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-09-30" });
    const tiles = screen.getByTestId("cash-flow-tiles");
    expect(tiles.nextElementSibling).toBe(screen.getByTestId("share-line"));
    expect(
      screen.getByRole("button", { name: "Everything I can see" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps the toggle when the share fetch fails, so My share can be left", async () => {
    vi.mocked(api.fetchSharedShare).mockRejectedValue(new ApiError(500, "Internal", "boom"));
    renderPage("/cash-flow?share=mine");
    await screen.findByTestId("cash-flow-tiles");
    expect(screen.getByRole("button", { name: "Everything I can see" })).toBeTruthy();
    expect(screen.queryByTestId("share-line-text")).toBeNull();
  });

  it("drops the percentage when nothing is shared", async () => {
    vi.mocked(api.fetchSharedShare).mockImplementation(async (range) => ({
      ...shareReport(range),
      sharedCents: 0,
      shareCents: 0,
      sharePercent: null,
    }));
    renderPage("/cash-flow");
    expect((await screen.findByTestId("share-line-text")).textContent).toBe(
      "Your share: $0.00 of $0.00 shared",
    );
  });

  it("holds My share in the URL, refetches the tiles, and keeps it across range changes", async () => {
    const user = userEvent.setup();
    const router = renderPage("/cash-flow?from=2026-02-03&to=2026-03-14");
    await screen.findByTestId("share-line");
    expect(api.fetchCashFlow).toHaveBeenLastCalledWith({ from: "2026-02-03", to: "2026-03-14" });
    await user.click(screen.getByRole("button", { name: "My share" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        from: "2026-02-03",
        to: "2026-03-14",
        share: "mine",
      }),
    );
    await waitFor(() =>
      expect(api.fetchCashFlow).toHaveBeenLastCalledWith({
        from: "2026-02-03",
        to: "2026-03-14",
        share: "mine",
      }),
    );
    expect(screen.getByRole("button", { name: "My share" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await user.click(screen.getByRole("button", { name: "FY to date" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        from: "2026-07-01",
        to: "2026-08-14",
        share: "mine",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Everything I can see" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ from: "2026-07-01", to: "2026-08-14" }),
    );
  });

  it("reads share=mine from the URL on a fresh load, with or without a range", async () => {
    renderPage("/cash-flow?share=mine");
    await screen.findByTestId("cash-flow-tiles");
    expect(api.fetchCashFlow).toHaveBeenCalledWith({
      from: "2026-07-01",
      to: "2026-09-30",
      share: "mine",
    });
  });

  it("asks for the current quarter without a range and shows the server's four figures", async () => {
    renderPage("/cash-flow");
    expect(await screen.findByRole("heading", { level: 2, name: "Cash flow" })).toBeTruthy();
    const tiles = await screen.findByTestId("cash-flow-tiles");
    expect(api.fetchCashFlow).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-09-30" });
    expect(figure(tiles, "Money in")).toBe(formatCents(512345));
    expect(figure(tiles, "Money out")).toBe(formatCents(300000));
    expect(figure(tiles, "Kept")).toBe(formatCents(212345));
    expect(figure(tiles, "Savings rate")).toBe("41.4%");
    expect(screen.getByTestId("range-label").textContent).toBe("Jul – Sep 2026");
    expect(screen.getByRole("button", { name: "Quarter" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("drops a malformed or reversed range and shows the current quarter", async () => {
    for (const url of [
      "/cash-flow?from=x&to=2026-01-01",
      "/cash-flow?from=2026-03-01&to=2026-02-01",
      "/cash-flow?from=2026-02-30&to=2026-03-01",
      "/cash-flow?from=2026-03-01",
    ]) {
      vi.mocked(api.fetchCashFlow).mockClear();
      renderPage(url);
      await screen.findByTestId("cash-flow-tiles");
      expect(api.fetchCashFlow, url).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-09-30" });
      expect(api.fetchCashFlow, url).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("reads the range from the URL, and the control writes it back and refetches", async () => {
    const user = userEvent.setup();
    const router = renderPage("/cash-flow?from=2026-02-03&to=2026-03-14");
    await screen.findByTestId("cash-flow-tiles");
    expect(api.fetchCashFlow).toHaveBeenCalledWith({ from: "2026-02-03", to: "2026-03-14" });
    expect(screen.getByTestId("range-label").textContent).toBe("3 Feb – 14 Mar 2026");
    expect(screen.getByRole("button", { name: "Custom" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await user.click(screen.getByRole("button", { name: "FY to date" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        from: "2026-07-01",
        to: "2026-08-14",
      }),
    );
    await waitFor(() =>
      expect(api.fetchCashFlow).toHaveBeenLastCalledWith({ from: "2026-07-01", to: "2026-08-14" }),
    );
    await user.click(screen.getByRole("button", { name: "Previous year" }));
    await waitFor(() =>
      expect(api.fetchCashFlow).toHaveBeenLastCalledWith({ from: "2025-07-01", to: "2026-06-30" }),
    );
    expect(screen.getByTestId("range-label").textContent).toBe("FY2026");
  });

  it("shows a savings rate of —% when the server has none", async () => {
    vi.mocked(api.fetchCashFlow).mockImplementation(async (range) => ({
      ...report(range),
      moneyInCents: 0,
      keptCents: -300000,
      savingsRatePermille: null,
    }));
    renderPage("/cash-flow");
    const tiles = await screen.findByTestId("cash-flow-tiles");
    expect(figure(tiles, "Savings rate")).toBe("—%");
  });

  it("says when the figures are unavailable", async () => {
    vi.mocked(api.fetchCashFlow).mockRejectedValue(new ApiError(500, "Internal", "boom"));
    renderPage("/cash-flow");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Cash flow is unavailable/);
    expect(screen.queryByTestId("cash-flow-tiles")).toBeNull();
  });
});

describe("validateCashFlowSearch", () => {
  it("keeps share=mine only, with or without a valid range", () => {
    expect(validateCashFlowSearch({ share: "mine" })).toEqual({ share: "mine" });
    expect(validateCashFlowSearch({ share: "everything" })).toEqual({});
    expect(validateCashFlowSearch({ share: "x", from: "2026-01-01", to: "2026-02-01" })).toEqual({
      from: "2026-01-01",
      to: "2026-02-01",
    });
    expect(validateCashFlowSearch({ share: "mine", from: "bad", to: "2026-02-01" })).toEqual({
      share: "mine",
    });
  });
});

describe("formatSavingsRate", () => {
  it("shows permille with one decimal", () => {
    expect(formatSavingsRate(373)).toBe("37.3%");
    expect(formatSavingsRate(0)).toBe("0.0%");
    expect(formatSavingsRate(5)).toBe("0.5%");
    expect(formatSavingsRate(-5)).toBe("-0.5%");
    expect(formatSavingsRate(-2500)).toBe("-250.0%");
    expect(formatSavingsRate(1000)).toBe("100.0%");
    expect(formatSavingsRate(null)).toBe("—%");
  });
});
