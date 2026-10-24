import { keepPreviousData, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type AccountSummary,
  type CashFlowTotals,
  type CategorySummary,
  fetchAccounts,
  fetchCashFlow,
  fetchCategories,
  fetchLeaks,
  fetchMerchants,
  fetchProfitAndLoss,
  fetchSharedShare,
  type LeaksReport,
  type MerchantsReport,
  type ProfitAndLossReport,
  type SharedShare,
} from "../api.ts";
import { type DateRange, localDay, stepRange } from "../lib/date-range.ts";

/** The query key of the cash-flow figures for one range. */
export const cashFlowKey = (range: { from: string; to: string }, share?: "mine") =>
  ["reports", "cash-flow", range.from, range.to, share ?? "everything"] as const;

/** The query key of the shared total and the viewer's share for one range. */
export const sharedShareKey = (range: { from: string; to: string }) =>
  ["reports", "shared-apportionment", range.from, range.to] as const;

export interface UseReportQueriesOptions {
  readonly share?: "mine" | undefined;
  readonly includePrev?: boolean | undefined;
  readonly includeTotals?: boolean | undefined;
  readonly today?: string | undefined;
}

export interface UseReportQueriesResult {
  readonly totals: UseQueryResult<CashFlowTotals, Error>;
  readonly shared: UseQueryResult<SharedShare, Error>;
  readonly accounts: UseQueryResult<readonly AccountSummary[], Error>;
  readonly categories: UseQueryResult<readonly CategorySummary[], Error>;
  readonly pnlGroup: UseQueryResult<ProfitAndLossReport, Error>;
  readonly pnlCategory: UseQueryResult<ProfitAndLossReport, Error>;
  readonly prevPnlCategory: UseQueryResult<ProfitAndLossReport, Error>;
  readonly incomeMerchants: UseQueryResult<MerchantsReport, Error>;
  readonly expenseMerchants: UseQueryResult<MerchantsReport, Error>;
  readonly leaks: UseQueryResult<LeaksReport, Error>;
  readonly prevRange: DateRange;
}

export function useReportQueries(
  range: DateRange,
  options: UseReportQueriesOptions = {},
): UseReportQueriesResult {
  const share = options.share;
  const includeTotals = options.includeTotals ?? true;
  const includePrev = Boolean(options.includePrev);
  const today = options.today ?? localDay(new Date());

  const prevRange = useMemo(() => stepRange(range, -1, today), [range, today]);

  const totals = useQuery({
    queryKey: cashFlowKey(range, share),
    queryFn: () => fetchCashFlow(share === undefined ? range : { ...range, share }),
    enabled: includeTotals,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const shared = useQuery({
    queryKey: sharedShareKey(range),
    queryFn: () => fetchSharedShare(range),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const pnlGroup = useQuery({
    queryKey: ["reports", "pnl", range.from, range.to, "group"],
    queryFn: () => fetchProfitAndLoss({ from: range.from, to: range.to, by: "group" }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const pnlCategory = useQuery({
    queryKey: ["reports", "pnl", range.from, range.to, "category"],
    queryFn: () => fetchProfitAndLoss({ from: range.from, to: range.to, by: "category" }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const prevPnlCategory = useQuery({
    queryKey: ["reports", "pnl", prevRange.from, prevRange.to, "category"],
    queryFn: () => fetchProfitAndLoss({ from: prevRange.from, to: prevRange.to, by: "category" }),
    enabled: includePrev,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const incomeMerchants = useQuery({
    queryKey: ["reports", "merchants", range.from, range.to, "income"],
    queryFn: () => fetchMerchants({ from: range.from, to: range.to, flow: "income" }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const expenseMerchants = useQuery({
    queryKey: ["reports", "merchants", range.from, range.to, "expense"],
    queryFn: () => fetchMerchants({ from: range.from, to: range.to, flow: "expense" }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const leaks = useQuery({
    queryKey: ["reports", "leaks", range.from, range.to],
    queryFn: () => fetchLeaks(range),
    placeholderData: keepPreviousData,
    retry: false,
  });

  return {
    totals,
    shared,
    accounts,
    categories,
    pnlGroup,
    pnlCategory,
    prevPnlCategory,
    incomeMerchants,
    expenseMerchants,
    leaks,
    prevRange,
  };
}
