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
import type { ForecastData } from "../api.ts";
import * as api from "../api.ts";
import { parseSearch, stringifySearch, validateForecastSearch } from "../routes/search.ts";
import { ForecastPage } from "./ForecastPage.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchForecast: vi.fn(),
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
});
