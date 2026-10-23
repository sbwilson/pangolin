import { useQuery } from "@tanstack/react-query";
import { fetchCashFlow } from "../api.ts";
import { localDay, quarterRange } from "../lib/date-range.ts";
import { formatCents } from "../lib/money.ts";

/** The query key of the cash-flow figures for one range. */
export const cashFlowKey = (range: { from: string; to: string }) =>
  ["reports", "cash-flow", range.from, range.to] as const;

/**
 * Cash flow, the landing page: money in, money out and kept for the current quarter, each a
 * figure the server summed (the web never sums money). Transfers between our own accounts and
 * money into investments count in neither.
 */
export function CashFlowPage() {
  const range = quarterRange(localDay(new Date()));
  const totals = useQuery({
    queryKey: cashFlowKey(range),
    queryFn: () => fetchCashFlow(range),
    retry: false,
  });
  const data = totals.data;

  return (
    <section aria-labelledby="cash-flow">
      <h2 id="cash-flow" className="m-0">
        Cash flow
      </h2>
      {totals.isPending ? <p>Loading…</p> : null}
      {data === undefined && totals.isError ? (
        <p role="alert">Cash flow is unavailable. Reload to try again.</p>
      ) : null}
      {data === undefined ? null : (
        <dl className="m-0 mt-3 grid gap-3 sm:grid-cols-3" data-testid="cash-flow-tiles">
          {[
            { label: "Money in", cents: data.moneyInCents },
            { label: "Money out", cents: data.moneyOutCents },
            { label: "Kept", cents: data.keptCents },
          ].map((tile) => (
            <div key={tile.label} className="rounded-lg border border-border bg-card p-4">
              <dt className="text-sm text-muted-foreground">{tile.label}</dt>
              <dd className="m-0 mt-1 text-2xl font-semibold tabular-nums">
                {formatCents(tile.cents)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
