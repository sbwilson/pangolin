import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { fetchCashFlow } from "../api.ts";
import { DateRangeControl } from "../components/DateRangeControl.tsx";
import { type DateRange, localDay, quarterRange } from "../lib/date-range.ts";
import { formatCents } from "../lib/money.ts";
import { validateCashFlowSearch } from "../routes/search.ts";

/** The query key of the cash-flow figures for one range. */
export const cashFlowKey = (range: { from: string; to: string }) =>
  ["reports", "cash-flow", range.from, range.to] as const;

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
  const range: DateRange =
    search.from !== undefined && search.to !== undefined
      ? { from: search.from, to: search.to }
      : quarterRange(today);
  const totals = useQuery({
    queryKey: cashFlowKey(range),
    queryFn: () => fetchCashFlow(range),
    // Keep the last range's tiles on screen while the new range loads.
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = totals.data;

  return (
    <section aria-labelledby="cash-flow">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="cash-flow" className="m-0">
          Cash flow
        </h2>
        <DateRangeControl
          range={range}
          today={today}
          onChange={(next) => void navigate({ search: { from: next.from, to: next.to } })}
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
    </section>
  );
}
