// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { ApiError } from "../api.ts";
import { formatCents } from "../lib/money.ts";
import { CashFlowPage } from "./CashFlowPage.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchCashFlow: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.resetAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CashFlowPage />
    </QueryClientProvider>,
  );
}

describe("CashFlowPage", () => {
  it("asks for the current quarter and shows the server's three figures", async () => {
    vi.useFakeTimers({ now: new Date(2026, 7, 14, 12), toFake: ["Date"] });
    vi.mocked(api.fetchCashFlow).mockResolvedValue({
      from: "2026-07-01",
      to: "2026-09-30",
      moneyInCents: 512345,
      moneyOutCents: 300000,
      keptCents: -1050,
    });
    renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Cash flow" })).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
    const tiles = await screen.findByTestId("cash-flow-tiles");
    expect(api.fetchCashFlow).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-09-30" });
    const figure = (label: string) =>
      within(tiles).getByText(label).parentElement?.querySelector("dd")?.textContent;
    expect(figure("Money in")).toBe(formatCents(512345));
    expect(figure("Money out")).toBe(formatCents(300000));
    expect(figure("Kept")).toBe(formatCents(-1050));
  });

  it("says when the figures are unavailable", async () => {
    vi.mocked(api.fetchCashFlow).mockRejectedValue(new ApiError(500, "Internal", "boom"));
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Cash flow is unavailable/);
    expect(screen.queryByTestId("cash-flow-tiles")).toBeNull();
  });
});
