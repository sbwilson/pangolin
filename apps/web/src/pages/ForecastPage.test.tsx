// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForecastData, ForecastNetWorthLine, ForecastNetWorthReport } from "../api.ts";
import * as api from "../api.ts";
import { parseSearch, stringifySearch, validateForecastSearch } from "../routes/search.ts";
import { ForecastPage } from "./ForecastPage.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchForecast: vi.fn(),
  fetchForecastNetWorth: vi.fn(),
}));

afterEach(() => cleanup());
beforeEach(() => {
  vi.resetAllMocks();
});

function points(from: string, days: number, start: number, step: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), balanceCents: start + i * step };
  });
}

const report = (horizonMonths: number): ForecastData => ({
  from: "2026-07-15",
  through: "2026-10-15",
  horizonMonths,
  missingDepositSource: false,
  accounts: [
    {
      accountId: "acc-1",
      name: "Joint everyday",
      lowBalanceThresholdCents: 6_000_000,
      points: points("2026-07-15", 93, 5_890_975, -1),
    },
    {
      accountId: "acc-2",
      name: "Person A private",
      lowBalanceThresholdCents: 0,
      points: points("2026-07-15", 93, -1_429_250, 0),
    },
  ],
  warnings: [
    {
      accountId: "acc-1",
      accountName: "Joint everyday",
      cents: 5_883_332,
      date: "2026-07-15",
    },
  ],
});

/** Point 0 is today on every line; each following month steps by `step` cents. */
function netWorthReport(years: number): ForecastNetWorthReport {
  const months = years * 12 + 1;
  const line = (bps: number, step: number): ForecastNetWorthLine => ({
    returnBps: bps,
    annualReturnPercent: String(bps / 100),
    points: Array.from({ length: months }, (_, month) => {
      const d = new Date(Date.UTC(2026, 10, 14));
      d.setUTCMonth(d.getUTCMonth() + month);
      return {
        month,
        date: d.toISOString().slice(0, 10),
        netWorthCents: 33_320_534 + month * step,
      };
    }),
  });
  return {
    asOf: "2026-11-14",
    horizonYears: years,
    lines: { low: line(300, 300_000), mid: line(500, 400_000), high: line(700, 500_000) },
  };
}

function renderPage(url: string) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/planning/forecast",
    validateSearch: validateForecastSearch,
    component: ForecastPage,
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

describe("ForecastPage", () => {
  it("calls out each warned account with its name, projected cents and date", async () => {
    vi.mocked(api.fetchForecast).mockResolvedValue(report(3));
    renderPage("/planning/forecast");

    await waitFor(() => expect(api.fetchForecast).toHaveBeenCalledWith(3));
    expect(await screen.findByText("Forecast")).toBeDefined();

    const warning = await screen.findByTestId("forecast-warning");
    expect(warning.textContent).toContain("Joint everyday");
    expect(warning.textContent).toContain("$58,833.32");
    expect(warning.textContent).toContain("15 Jul");

    expect(screen.getByTestId("forecast-chart")).toBeDefined();
  });

  it("defaults the horizon to 3 months and reflects ?horizon on arrival", async () => {
    vi.mocked(api.fetchForecast).mockResolvedValue(report(6));
    renderPage("/planning/forecast?horizon=6");
    await waitFor(() => expect(api.fetchForecast).toHaveBeenCalledWith(6));
    const six = screen.getByRole("button", { name: "6 months" });
    expect(six.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "3 months" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("ignores a junk horizon and asks the server for 3", async () => {
    vi.mocked(api.fetchForecast).mockResolvedValue(report(3));
    renderPage("/planning/forecast?horizon=99");
    await waitFor(() => expect(api.fetchForecast).toHaveBeenCalledWith(3));
    expect(screen.getByRole("button", { name: "3 months" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("changes the horizon through the button group, updating the URL and refetching", async () => {
    vi.mocked(api.fetchForecast).mockResolvedValue(report(12));
    const router = renderPage("/planning/forecast");
    await waitFor(() => expect(api.fetchForecast).toHaveBeenCalledWith(3));

    await userEvent.click(screen.getByRole("button", { name: "12 months" }));
    await waitFor(() => expect(api.fetchForecast).toHaveBeenCalledWith(12));
    await waitFor(() => expect(router.state.location.searchStr).toContain("horizon=12"));
    expect(screen.getByRole("button", { name: "12 months" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("renders no callout when the projection has no dips", async () => {
    vi.mocked(api.fetchForecast).mockResolvedValue({ ...report(3), warnings: [] });
    renderPage("/planning/forecast");
    await waitFor(() => expect(screen.getByTestId("forecast-chart")).toBeDefined());
    expect(screen.queryByTestId("forecast-warning")).toBeNull();
  });

  it("says when the forecast is unavailable", async () => {
    vi.mocked(api.fetchForecast).mockRejectedValue(new Error("offline"));
    renderPage("/planning/forecast");
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /The forecast is currently unavailable/,
    );
    expect(screen.queryByTestId("forecast-chart")).toBeNull();
  });

  it("shows cash flow mode on default arrival, with its own View as table toggle", async () => {
    vi.mocked(api.fetchForecast).mockResolvedValue(report(3));
    renderPage("/planning/forecast");
    await waitFor(() => expect(screen.getByTestId("forecast-chart")).toBeDefined());

    expect(screen.getByRole("button", { name: "Cash flow" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Net worth" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(api.fetchForecastNetWorth).not.toHaveBeenCalled();

    const toggle = screen.getByTestId("cashflow-view-toggle");
    expect(toggle.textContent).toBe("View as table");
    await userEvent.click(toggle);
    expect(screen.queryByTestId("forecast-chart")).toBeNull();
    const table = screen.getByTestId("forecast-cashflow-table");
    expect(table.getAttribute("role")).toBe("region");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(93);
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["Day", "Joint everyday", "Person A private"]);
    const firstRow = table.querySelector("tbody tr");
    expect(firstRow?.querySelector("th[scope='row']")?.textContent).toBe("Today");
    expect(toggle.textContent).toBe("View as chart");

    await userEvent.click(toggle);
    expect(screen.getByTestId("forecast-chart")).toBeDefined();
  });
});

describe("ForecastPage net worth mode", () => {
  it("switches through the segmented control: URL, horizon=2 request, lines and headline", async () => {
    vi.mocked(api.fetchForecast).mockResolvedValue(report(3));
    vi.mocked(api.fetchForecastNetWorth).mockResolvedValue(netWorthReport(2));
    const router = renderPage("/planning/forecast");
    await waitFor(() => expect(api.fetchForecast).toHaveBeenCalledWith(3));

    await userEvent.click(screen.getByRole("button", { name: "Net worth" }));
    await waitFor(() => expect(api.fetchForecastNetWorth).toHaveBeenCalledWith(2));
    await waitFor(() => expect(router.state.location.searchStr).toContain("mode=networth"));

    expect(screen.getByRole("button", { name: "2 yrs" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("forecast-networth-chart")).toBeDefined();
    expect(screen.queryByTestId("forecast-chart")).toBeNull();
    expect(screen.queryByTestId("forecast-warning")).toBeNull();
    // The cash flow query is asked once, before the switch — and never again.
    expect(api.fetchForecast).toHaveBeenCalledTimes(1);
  });

  it("arrives on net worth mode from a deep link with 10 yrs pressed and all 121 points", async () => {
    vi.mocked(api.fetchForecastNetWorth).mockResolvedValue(netWorthReport(10));
    renderPage("/planning/forecast?mode=networth&years=10");
    await waitFor(() => expect(api.fetchForecastNetWorth).toHaveBeenCalledWith(10));
    expect(api.fetchForecast).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "10 yrs" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await waitFor(() => expect(screen.getByTestId("forecast-networth-chart")).toBeDefined());

    await userEvent.click(screen.getByTestId("networth-view-toggle"));
    expect(screen.getByTestId("forecast-networth-table").querySelectorAll("tbody tr")).toHaveLength(
      121,
    );
  });

  it("falls back to 2 years on junk years and to cash flow on junk mode", async () => {
    vi.mocked(api.fetchForecast).mockResolvedValue(report(3));
    vi.mocked(api.fetchForecastNetWorth).mockResolvedValue(netWorthReport(2));
    renderPage("/planning/forecast?mode=networth&years=3");
    await waitFor(() => expect(api.fetchForecastNetWorth).toHaveBeenCalledWith(2));
    expect(screen.getByRole("button", { name: "2 yrs" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Cash flow" }));
    await waitFor(() => expect(api.fetchForecast).toHaveBeenCalledWith(3));
  });

  it("carries the mockup headline block built from the fetched lines", async () => {
    vi.mocked(api.fetchForecastNetWorth).mockResolvedValue(netWorthReport(2));
    renderPage("/planning/forecast?mode=networth");
    const headline = await screen.findByTestId("forecast-networth-headline");

    expect(await screen.findByText("Where will we be in 2 years?")).toBeDefined();
    expect(
      screen.getByText("Starting from today’s $333,205. Estimates, not advice."),
    ).toBeDefined();
    expect(headline.textContent).toContain("In 2 years");
    expect(headline.textContent).toContain("about $429,205");
    expect(headline.textContent).toContain("mid estimate · low $405,205 · high $453,205");
  });

  it("says In 1 year and refetches when a horizon button is clicked", async () => {
    vi.mocked(api.fetchForecastNetWorth).mockResolvedValue(netWorthReport(1));
    const router = renderPage("/planning/forecast?mode=networth");
    await waitFor(() => expect(api.fetchForecastNetWorth).toHaveBeenCalledWith(2));

    await userEvent.click(screen.getByRole("button", { name: "1 yr" }));
    await waitFor(() => expect(api.fetchForecastNetWorth).toHaveBeenCalledWith(1));
    await waitFor(() => expect(router.state.location.searchStr).toContain("years=1"));
    expect(await screen.findByText("Where will we be in 1 year?")).toBeDefined();
    expect(screen.getByText("In 1 year")).toBeDefined();
  });

  it("tables every monthly point and flips the label", async () => {
    vi.mocked(api.fetchForecastNetWorth).mockResolvedValue(netWorthReport(2));
    renderPage("/planning/forecast?mode=networth");
    const toggle = await screen.findByTestId("networth-view-toggle");
    expect(toggle.textContent).toBe("View as table");

    await userEvent.click(toggle);
    const table = screen.getByTestId("forecast-networth-table");
    expect(table.getAttribute("role")).toBe("region");
    expect(table.getAttribute("tabIndex")).toBe("0");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(25);
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["Month", "Low", "Mid", "High"]);
    const firstRow = table.querySelector("tbody tr");
    expect(firstRow?.querySelector("th[scope='row']")?.textContent).toBe("Today");
    expect(toggle.textContent).toBe("View as chart");
  });

  it("shows an alert and neither chart nor headline when the net-worth fetch fails", async () => {
    vi.mocked(api.fetchForecastNetWorth).mockRejectedValue(new Error("offline"));
    renderPage("/planning/forecast?mode=networth");
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /The net worth projection is currently unavailable/,
    );
    expect(screen.queryByTestId("forecast-networth-chart")).toBeNull();
    expect(screen.queryByTestId("forecast-networth-headline")).toBeNull();
  });

  it("keeps the cash flow months horizon when returning from net worth", async () => {
    vi.mocked(api.fetchForecast).mockResolvedValue(report(12));
    vi.mocked(api.fetchForecastNetWorth).mockResolvedValue(netWorthReport(2));
    const router = renderPage("/planning/forecast");
    await waitFor(() => expect(api.fetchForecast).toHaveBeenCalledWith(3));

    await userEvent.click(screen.getByRole("button", { name: "12 months" }));
    await waitFor(() => expect(api.fetchForecast).toHaveBeenCalledWith(12));

    await userEvent.click(screen.getByRole("button", { name: "Net worth" }));
    await waitFor(() => expect(api.fetchForecastNetWorth).toHaveBeenCalledWith(2));

    await userEvent.click(screen.getByRole("button", { name: "Cash flow" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "12 months" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(router.state.location.searchStr).toContain("horizon=12");
    expect(await screen.findByTestId("forecast-chart")).toBeDefined();
  });
});
