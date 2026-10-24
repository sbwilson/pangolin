import { useMemo } from "react";
import type { NetWorthTrendPoint } from "../api.ts";
import { formatCents } from "../lib/money.ts";

const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthNameFromDate(day: string): string {
  return FULL_MONTHS[Number(day.slice(5, 7)) - 1] ?? "";
}

export interface NetWorthTrendTableProps {
  readonly trend: readonly NetWorthTrendPoint[];
}

export function NetWorthTrendTable({ trend }: NetWorthTrendTableProps) {
  const reversedTrend = useMemo(() => [...trend].reverse(), [trend]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: WCAG 2.1.1 scrollable table region
    <div
      className="overflow-x-auto mt-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      data-testid="net-worth-table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: WCAG 2.1.1 scrollable container keyboard access
      tabIndex={0}
      role="region"
      aria-label="12-month net worth trend"
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <th scope="col" className="py-2 pr-4 font-semibold">
              Month
            </th>
            <th scope="col" className="py-2 px-4 text-right font-semibold">
              Net worth
            </th>
            <th scope="col" className="py-2 px-4 text-right font-semibold">
              Assets
            </th>
            <th scope="col" className="py-2 pl-4 text-right font-semibold">
              Liabilities
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reversedTrend.map((point) => (
            <tr key={point.date} className="hover:bg-muted/50 transition-colors">
              <th scope="row" className="py-2.5 pr-4 text-foreground font-medium text-left">
                {`${monthNameFromDate(point.date)} ${point.date.slice(0, 4)}`}
              </th>
              <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-primary">
                {formatCents(point.netWorthCents)}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums text-foreground">
                {formatCents(point.assetsCents)}
              </td>
              <td className="py-2.5 pl-4 text-right tabular-nums text-destructive">
                {formatCents(point.liabilitiesCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
