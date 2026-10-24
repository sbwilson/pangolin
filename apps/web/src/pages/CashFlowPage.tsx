import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  fetchAccounts,
  fetchCashFlow,
  fetchCategories,
  fetchLeaks,
  fetchMerchants,
  fetchProfitAndLoss,
  fetchSharedShare,
  fetchTransactions,
  type SharedShare,
} from "../api.ts";
import { BarListsCard } from "../components/BarListsCard.tsx";
import { BiggestLittleLeaksCard } from "../components/BiggestLittleLeaksCard.tsx";
import { DateRangeControl } from "../components/DateRangeControl.tsx";
import { useOptionalImport } from "../components/import/index.ts";
import { LatestTransactionsCard } from "../components/LatestTransactionsCard.tsx";
import { MascotIcon } from "../components/MascotLogo.tsx";
import { SankeyCard } from "../components/SankeyCard.tsx";
import { type DateRange, localDay, quarterRange } from "../lib/date-range.ts";
import { formatCents } from "../lib/money.ts";
import { validateCashFlowSearch } from "../routes/search.ts";

/** The query key of the cash-flow figures for one range. */
export const cashFlowKey = (range: { from: string; to: string }, share?: "mine") =>
  ["reports", "cash-flow", range.from, range.to, share ?? "everything"] as const;

/** The query key of the shared total and the viewer's share for one range. */
export const sharedShareKey = (range: { from: string; to: string }) =>
  ["reports", "shared-apportionment", range.from, range.to] as const;

/**
 * "Your share: $X of $Y shared (N%)", every figure and the percent worked out by the server. With
 * nothing shared there is no percentage.
 */
export function formatShareLine(share: SharedShare): string {
  const line = `Your share: ${formatCents(share.shareCents)} of ${formatCents(share.sharedCents)} shared`;
  return share.sharePercent === null ? line : `${line} (${share.sharePercent}%)`;
}

/** A savings rate the server worked out, in permille, as "37.3%" ("—%" when there is none). */
export function formatSavingsRate(permille: number | null): string {
  if (permille === null) return "—%";
  const sign = permille < 0 ? "-" : "";
  const abs = Math.abs(permille);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}%`;
}

/**
 * Cash flow, the landing page: money in, money out, kept and the savings rate over the range in
 * the URL (the current quarter when it has none), each a figure the server worked out (the web
 * never sums money). Transfers between our own accounts and money into investments count in
 * neither.
 */
export function CashFlowPage() {
  // The route's search is merged over the raw URL's, so read it through the validator again.
  const rawSearch = useSearch({ from: "/cash-flow" });
  const search = useMemo(() => validateCashFlowSearch(rawSearch), [rawSearch]);
  const navigate = useNavigate({ from: "/cash-flow" });
  const today = localDay(new Date());
  const importControls = useOptionalImport();
  const range: DateRange =
    search.from !== undefined && search.to !== undefined
      ? { from: search.from, to: search.to }
      : quarterRange(today);
  const share = search.share;

  const totals = useQuery({
    queryKey: cashFlowKey(range, share),
    queryFn: () => fetchCashFlow(share === undefined ? range : { ...range, share }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = totals.data;

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

  const latestTxns = useQuery({
    queryKey: ["ledger", "transactions", range.from, range.to],
    queryFn: () => fetchTransactions({ from: range.from, to: range.to, page: "1" }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const leaks = useQuery({
    queryKey: ["reports", "leaks", range.from, range.to],
    queryFn: () => fetchLeaks(range),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // The range and the share both live in the URL; changing one keeps the other.
  const setShare = (next: "mine" | undefined) =>
    void navigate({
      search: {
        ...(search.from === undefined || search.to === undefined
          ? {}
          : { from: search.from, to: search.to }),
        ...(next === undefined ? {} : { share: next }),
      },
    });

  const isEmptyDatabase = accounts.data !== undefined && accounts.data.length === 0;

  const isNothingInRange =
    accounts.data !== undefined &&
    accounts.data.length > 0 &&
    data !== undefined &&
    data.moneyInCents === 0 &&
    data.moneyOutCents === 0 &&
    latestTxns.data !== undefined &&
    latestTxns.data.transactions.length === 0;

  return (
    <section aria-labelledby="cash-flow">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="cash-flow" className="m-0">
          Cash flow
        </h2>
        <DateRangeControl
          range={range}
          today={today}
          onChange={(next) =>
            void navigate({
              search: { from: next.from, to: next.to, ...(share === undefined ? {} : { share }) },
            })
          }
        />
      </header>

      {totals.isPending ? <p>Loading…</p> : null}
      {data === undefined && totals.isError ? (
        <p role="alert">Cash flow is unavailable. Reload to try again.</p>
      ) : null}

      {data === undefined ? null : (
        <dl
          className="m-0 mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4"
          data-testid="cash-flow-tiles"
        >
          {[
            { label: "Money in", figure: formatCents(data.moneyInCents) },
            { label: "Money out", figure: formatCents(data.moneyOutCents) },
            { label: "Kept", figure: formatCents(data.keptCents) },
            { label: "Savings rate", figure: formatSavingsRate(data.savingsRatePermille) },
          ].map((tile) => (
            <div key={tile.label} className="rounded-lg border border-border bg-card p-4">
              <dt className="text-sm text-muted-foreground">{tile.label}</dt>
              <dd className="m-0 mt-1 text-2xl font-semibold tabular-nums">{tile.figure}</dd>
            </div>
          ))}
        </dl>
      )}

      <div
        className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3"
        data-testid="share-line"
      >
        {shared.data === undefined ? (
          <span />
        ) : (
          <p className="m-0 text-sm tabular-nums" data-testid="share-line-text">
            {formatShareLine(shared.data)}
          </p>
        )}
        {/* biome-ignore lint/a11y/useSemanticElements: a pill toggle, not a form fieldset */}
        <div
          role="group"
          aria-label="Scope of the figures"
          className="inline-flex rounded-lg border border-border bg-muted p-1"
        >
          {(
            [
              { id: undefined, label: "Everything I can see" },
              { id: "mine", label: "My share" },
            ] as const
          ).map((option) => {
            const pressed = share === option.id;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={pressed}
                onClick={() => setShare(option.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  pressed
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty Database State */}
      {isEmptyDatabase ? (
        <div
          className="mt-6 rounded-lg border border-border bg-card p-8 text-center"
          data-testid="empty-database-state"
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <MascotIcon size="lg" />
          </div>
          <h3 className="m-0 text-lg font-semibold">Nothing to sniff at yet</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Connect or import your bank accounts to see your cash flow.
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => importControls?.openImport()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
            >
              Import a bank file
            </button>
          </div>
        </div>
      ) : isNothingInRange ? (
        /* In-Range Empty State */
        <div
          className="mt-6 rounded-lg border border-border bg-card p-8 text-center"
          data-testid="nothing-in-range-state"
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <MascotIcon size="lg" />
          </div>
          <h3 className="m-0 text-lg font-semibold">Nothing in this period</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            There are no transactions in the chosen date range. Try selecting a different period
            above.
          </p>
        </div>
      ) : (
        /* Regular content with Sankey, Bar Lists, and Latest Transactions */
        <>
          {pnlGroup.data && pnlCategory.data && data ? (
            <SankeyCard
              pnlGroup={pnlGroup.data}
              pnlCategory={pnlCategory.data}
              range={range}
              keptCents={data.keptCents}
            />
          ) : null}

          {pnlGroup.data && pnlCategory.data && incomeMerchants.data && expenseMerchants.data ? (
            <BarListsCard
              pnlGroup={pnlGroup.data}
              pnlCategory={pnlCategory.data}
              incomeMerchants={incomeMerchants.data}
              expenseMerchants={expenseMerchants.data}
              range={range}
            />
          ) : null}

          {latestTxns.data ? (
            <LatestTransactionsCard
              transactions={latestTxns.data.transactions}
              categories={categories.data ?? []}
              range={range}
            />
          ) : null}

          {leaks.data ? <BiggestLittleLeaksCard leaks={leaks.data.rows} range={range} /> : null}
        </>
      )}
    </section>
  );
}
