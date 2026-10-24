import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  fetchAccounts,
  fetchCategories,
  fetchLeaks,
  fetchMerchants,
  fetchProfitAndLoss,
  fetchSharedShare,
} from "../api.ts";
import { BarListsCard } from "../components/BarListsCard.tsx";
import { BiggestLittleLeaksCard } from "../components/BiggestLittleLeaksCard.tsx";
import { DateRangeControl } from "../components/DateRangeControl.tsx";
import { useOptionalImport } from "../components/import/index.ts";
import { MascotIcon } from "../components/MascotLogo.tsx";
import { SpendingCategoryBarsCard } from "../components/SpendingCategoryBarsCard.tsx";
import { type DateRange, localDay, quarterRange, stepRange } from "../lib/date-range.ts";
import { validateCashFlowSearch } from "../routes/search.ts";
import { formatShareLine, sharedShareKey } from "./CashFlowPage.tsx";

export function SpendingPage() {
  const rawSearch = useSearch({ from: "/spending" });
  const search = useMemo(() => validateCashFlowSearch(rawSearch), [rawSearch]);
  const navigate = useNavigate({ from: "/spending" });
  const today = localDay(new Date());
  const importControls = useOptionalImport();

  const range: DateRange =
    search.from !== undefined && search.to !== undefined
      ? { from: search.from, to: search.to }
      : quarterRange(today);
  const share = search.share;

  const prevRange = stepRange(range, -1, today);

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
    pnlGroup.data !== undefined &&
    pnlGroup.data.income.totalCents === 0 &&
    pnlGroup.data.expense.totalCents === 0 &&
    pnlCategory.data !== undefined &&
    pnlCategory.data.expense.rows.length === 0;

  const isError =
    (pnlGroup.data === undefined && pnlGroup.isError) ||
    (pnlCategory.data === undefined && pnlCategory.isError) ||
    (prevPnlCategory.data === undefined && prevPnlCategory.isError) ||
    (incomeMerchants.data === undefined && incomeMerchants.isError) ||
    (expenseMerchants.data === undefined && expenseMerchants.isError);

  const isPending =
    pnlGroup.isPending ||
    pnlCategory.isPending ||
    prevPnlCategory.isPending ||
    incomeMerchants.isPending ||
    expenseMerchants.isPending;

  return (
    <section aria-labelledby="spending">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="spending" className="m-0">
          Spending
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

      {isPending ? <p>Loading…</p> : null}
      {isError ? <p role="alert">Spending is unavailable. Reload to try again.</p> : null}

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
            Connect or import your bank accounts to see your spending.
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
        <>
          {pnlGroup.data && pnlCategory.data && incomeMerchants.data && expenseMerchants.data ? (
            <BarListsCard
              pnlGroup={pnlGroup.data}
              pnlCategory={pnlCategory.data}
              incomeMerchants={incomeMerchants.data}
              expenseMerchants={expenseMerchants.data}
              range={range}
            />
          ) : null}

          {pnlGroup.data && pnlCategory.data && prevPnlCategory.data ? (
            <SpendingCategoryBarsCard
              pnlGroup={pnlGroup.data}
              pnlCategory={pnlCategory.data}
              prevPnlCategory={prevPnlCategory.data}
              categories={categories.data}
              range={range}
              today={today}
            />
          ) : null}

          {leaks.data ? <BiggestLittleLeaksCard leaks={leaks.data.rows} range={range} /> : null}
        </>
      )}
    </section>
  );
}
