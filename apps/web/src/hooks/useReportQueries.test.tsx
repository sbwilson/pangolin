// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { useReportQueries } from "./useReportQueries.ts";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchCashFlow: vi.fn(),
  fetchSharedShare: vi.fn(),
  fetchAccounts: vi.fn(),
  fetchCategories: vi.fn(),
  fetchProfitAndLoss: vi.fn(),
  fetchMerchants: vi.fn(),
  fetchLeaks: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useReportQueries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches totals, share, P&L, merchants, leaks, accounts and categories with includePrev and share", async () => {
    const range = { from: "2026-07-01", to: "2026-09-30" };

    vi.mocked(api.fetchCashFlow).mockResolvedValue({
      from: range.from,
      to: range.to,
      moneyInCents: 100000,
      moneyOutCents: 50000,
      keptCents: 50000,
      savingsRatePermille: 500,
    });

    vi.mocked(api.fetchSharedShare).mockResolvedValue({
      from: range.from,
      to: range.to,
      setting: "contribution",
      basis: "contribution",
      sharedCents: 80000,
      shareCents: 40000,
      sharePercent: 50,
    });

    vi.mocked(api.fetchAccounts).mockResolvedValue([]);
    vi.mocked(api.fetchCategories).mockResolvedValue([]);

    vi.mocked(api.fetchProfitAndLoss).mockImplementation(async (params) => ({
      from: params.from,
      to: params.to,
      by: params.by,
      income: { totalCents: 100000, rows: [] },
      expense: { totalCents: 50000, rows: [] },
      uncategorised: { inCents: 0, outCents: 0 },
    }));

    vi.mocked(api.fetchMerchants).mockImplementation(async (params) => ({
      from: params.from,
      to: params.to,
      flow: params.flow,
      totalCents: 0,
      rows: [],
    }));

    vi.mocked(api.fetchLeaks).mockResolvedValue({
      from: range.from,
      to: range.to,
      rows: [],
    });

    const { result } = renderHook(
      () =>
        useReportQueries(range, {
          includePrev: true,
          share: "mine",
          today: "2026-10-01",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.totals.isSuccess).toBe(true);
      expect(result.current.shared.isSuccess).toBe(true);
      expect(result.current.pnlGroup.isSuccess).toBe(true);
      expect(result.current.pnlCategory.isSuccess).toBe(true);
      expect(result.current.prevPnlCategory.isSuccess).toBe(true);
      expect(result.current.incomeMerchants.isSuccess).toBe(true);
      expect(result.current.expenseMerchants.isSuccess).toBe(true);
      expect(result.current.leaks.isSuccess).toBe(true);
      expect(result.current.accounts.isSuccess).toBe(true);
      expect(result.current.categories.isSuccess).toBe(true);
    });

    expect(result.current.totals.data?.keptCents).toBe(50000);
    expect(result.current.shared.data?.sharePercent).toBe(50);
    expect(api.fetchCashFlow).toHaveBeenCalledWith({ ...range, share: "mine" });
    expect(api.fetchSharedShare).toHaveBeenCalledWith(range);
    expect(api.fetchProfitAndLoss).toHaveBeenCalledWith({
      from: range.from,
      to: range.to,
      by: "group",
    });
    expect(api.fetchProfitAndLoss).toHaveBeenCalledWith({
      from: range.from,
      to: range.to,
      by: "category",
    });
    // prevPnlCategory called with previous quarter (2026-04-01 to 2026-06-30)
    expect(api.fetchProfitAndLoss).toHaveBeenCalledWith({
      from: "2026-04-01",
      to: "2026-06-30",
      by: "category",
    });
  });

  it("does not fetch prevPnlCategory when includePrev is falsy", async () => {
    const range = { from: "2026-07-01", to: "2026-09-30" };

    vi.mocked(api.fetchCashFlow).mockResolvedValue({
      from: range.from,
      to: range.to,
      moneyInCents: 100000,
      moneyOutCents: 50000,
      keptCents: 50000,
      savingsRatePermille: 500,
    });
    vi.mocked(api.fetchSharedShare).mockResolvedValue({
      from: range.from,
      to: range.to,
      setting: "contribution",
      basis: "contribution",
      sharedCents: 0,
      shareCents: 0,
      sharePercent: null,
    });
    vi.mocked(api.fetchAccounts).mockResolvedValue([]);
    vi.mocked(api.fetchCategories).mockResolvedValue([]);
    vi.mocked(api.fetchProfitAndLoss).mockResolvedValue({
      from: range.from,
      to: range.to,
      by: "group",
      income: { totalCents: 0, rows: [] },
      expense: { totalCents: 0, rows: [] },
      uncategorised: { inCents: 0, outCents: 0 },
    });
    vi.mocked(api.fetchMerchants).mockResolvedValue({
      from: range.from,
      to: range.to,
      flow: "income",
      totalCents: 0,
      rows: [],
    });
    vi.mocked(api.fetchLeaks).mockResolvedValue({
      from: range.from,
      to: range.to,
      rows: [],
    });

    const { result } = renderHook(() => useReportQueries(range), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.totals.isSuccess).toBe(true);
    });

    expect(result.current.prevPnlCategory.fetchStatus).toBe("idle");
  });

  it("leaves totals disabled/idle when includeTotals is false", async () => {
    const range = { from: "2026-07-01", to: "2026-09-30" };

    vi.mocked(api.fetchSharedShare).mockResolvedValue({
      from: range.from,
      to: range.to,
      setting: "contribution",
      basis: "contribution",
      sharedCents: 0,
      shareCents: 0,
      sharePercent: null,
    });
    vi.mocked(api.fetchAccounts).mockResolvedValue([]);
    vi.mocked(api.fetchCategories).mockResolvedValue([]);
    vi.mocked(api.fetchProfitAndLoss).mockResolvedValue({
      from: range.from,
      to: range.to,
      by: "group",
      income: { totalCents: 0, rows: [] },
      expense: { totalCents: 0, rows: [] },
      uncategorised: { inCents: 0, outCents: 0 },
    });
    vi.mocked(api.fetchMerchants).mockResolvedValue({
      from: range.from,
      to: range.to,
      flow: "income",
      totalCents: 0,
      rows: [],
    });
    vi.mocked(api.fetchLeaks).mockResolvedValue({
      from: range.from,
      to: range.to,
      rows: [],
    });

    const { result } = renderHook(() => useReportQueries(range, { includeTotals: false }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.shared.isSuccess).toBe(true);
    });

    expect(result.current.totals.fetchStatus).toBe("idle");
    expect(result.current.totals.isPending).toBe(true);
    expect(api.fetchCashFlow).not.toHaveBeenCalled();
  });
});
