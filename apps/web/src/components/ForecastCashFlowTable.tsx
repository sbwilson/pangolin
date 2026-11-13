import type { ForecastAccountData } from "../api.ts";
import { formatCents } from "../lib/money.ts";
import { shortDayLabel } from "./ForecastCashFlowChart.tsx";

export interface ForecastCashFlowTableProps {
  readonly accounts: readonly ForecastAccountData[];
}

/** Every projected day as a row, one column per visible account. No sampling. */
export function ForecastCashFlowTable({ accounts }: ForecastCashFlowTableProps) {
  const dates = accounts[0]?.points.map((p) => p.date) ?? [];
  const centsByDate = accounts.map((a) => new Map(a.points.map((p) => [p.date, p.balanceCents])));

  return (
    // biome-ignore lint/a11y/useSemanticElements: WCAG 2.1.1 scrollable table region
    <div
      className="overflow-x-auto mt-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      data-testid="forecast-cashflow-table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: WCAG 2.1.1 scrollable container keyboard access
      tabIndex={0}
      role="region"
      aria-label="Projected balance by day"
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <th scope="col" className="py-2 pr-4 font-semibold">
              Day
            </th>
            {accounts.map((account, i) => (
              <th
                key={account.accountId}
                scope="col"
                className={`py-2 text-right font-semibold ${i === accounts.length - 1 ? "pl-4" : "px-4"}`}
              >
                {account.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {dates.map((date, dayIndex) => (
            <tr key={date} className="hover:bg-muted/50 transition-colors">
              <th scope="row" className="py-2.5 pr-4 text-foreground font-medium text-left">
                {dayIndex === 0 ? "Today" : shortDayLabel(date)}
              </th>
              {centsByDate.map((byDate, i) => {
                const cents = byDate.get(date);
                return (
                  <td
                    key={accounts[i]?.accountId ?? i}
                    className={`py-2.5 text-right tabular-nums text-foreground ${
                      i === centsByDate.length - 1 ? "pl-4" : "px-4"
                    }`}
                  >
                    {cents === undefined ? "—" : formatCents(cents)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
