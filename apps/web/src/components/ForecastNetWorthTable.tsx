import type { ForecastNetWorthReport } from "../api.ts";
import { formatCents } from "../lib/money.ts";
import { monthNameFromDate } from "./NetWorthTrendTable.tsx";

export interface ForecastNetWorthTableProps {
  readonly report: ForecastNetWorthReport;
}

/** Every monthly point the server returned — Today first — as a Low/Mid/High row. No sampling. */
export function ForecastNetWorthTable({ report }: ForecastNetWorthTableProps) {
  const months = report.lines.mid.points;

  return (
    // biome-ignore lint/a11y/useSemanticElements: WCAG 2.1.1 scrollable table region
    <div
      className="overflow-x-auto mt-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      data-testid="forecast-networth-table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: WCAG 2.1.1 scrollable container keyboard access
      tabIndex={0}
      role="region"
      aria-label="Net worth projection by month"
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <th scope="col" className="py-2 pr-4 font-semibold">
              Month
            </th>
            <th scope="col" className="py-2 px-4 text-right font-semibold">
              Low
            </th>
            <th scope="col" className="py-2 px-4 text-right font-semibold">
              Mid
            </th>
            <th scope="col" className="py-2 pl-4 text-right font-semibold">
              High
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {months.map((point, i) => (
            <tr key={point.date} className="hover:bg-muted/50 transition-colors">
              <th scope="row" className="py-2.5 pr-4 text-foreground font-medium text-left">
                {i === 0 ? "Today" : `${monthNameFromDate(point.date)} ${point.date.slice(0, 4)}`}
              </th>
              <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">
                {formatCents(report.lines.low.points[i]?.netWorthCents ?? 0)}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-primary">
                {formatCents(point.netWorthCents)}
              </td>
              <td className="py-2.5 pl-4 text-right tabular-nums text-muted-foreground">
                {formatCents(report.lines.high.points[i]?.netWorthCents ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
