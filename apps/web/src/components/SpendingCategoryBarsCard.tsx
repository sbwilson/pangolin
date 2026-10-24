import { Link } from "@tanstack/react-router";
import type { CategorySummary, ProfitAndLossReport } from "../api.ts";
import { type DateRange, rangeLabel, rangeUnit, stepRange } from "../lib/date-range.ts";
import { formatCents } from "../lib/money.ts";

export interface SpendingCategoryBarsCardProps {
  readonly pnlGroup: ProfitAndLossReport;
  readonly pnlCategory: ProfitAndLossReport;
  readonly prevPnlCategory?: ProfitAndLossReport | undefined;
  readonly categories?: readonly CategorySummary[] | undefined;
  readonly range: DateRange;
  readonly today: string;
}

const RAMP_FILLS = [
  "fill-chart-1",
  "fill-chart-2",
  "fill-chart-3",
  "fill-chart-4",
  "fill-chart-5",
  "fill-chart-6",
  "fill-chart-7",
  "fill-chart-8",
  "fill-chart-9",
] as const;

const RAMP_BG_CLASSES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
  "bg-chart-7",
  "bg-chart-8",
  "bg-chart-9",
] as const;

const WHOLE_DOLLAR_FORMATTER = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** Formats dollar difference without cents (e.g. "$86", "$1,640"). */
export function formatDiffAmount(cents: number): string {
  const dollars = Math.round(Math.abs(cents) / 100);
  return WHOLE_DOLLAR_FORMATTER.format(dollars);
}

/** Formats change vs previous equal period: "↑ $X", "↓ $X", or "same as last <quarter/period>". */
export function formatCategoryChange(
  currCents: number,
  prevCents: number,
  range: DateRange,
  today: string,
): string {
  const diffCents = currCents - prevCents;
  if (diffCents === 0 || Math.round(Math.abs(diffCents) / 100) === 0) {
    const periodName = rangeUnit(range, today) === "quarter" ? "quarter" : "period";
    return `same as last ${periodName}`;
  }
  if (diffCents > 0) {
    return `↑ ${formatDiffAmount(diffCents)}`;
  }
  return `↓ ${formatDiffAmount(Math.abs(diffCents))}`;
}

export function SpendingCategoryBarsCard({
  pnlGroup,
  pnlCategory,
  prevPnlCategory,
  categories = [],
  range,
  today,
}: SpendingCategoryBarsCardProps) {
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Map previous period category rows by id
  const prevCategorySpend = new Map<string | null, number>();
  if (prevPnlCategory) {
    for (const r of prevPnlCategory.expense.rows) {
      prevCategorySpend.set(r.id, r.cents);
    }
  }

  // Sort rows descending by amount (cents), with category name as secondary tie-breaker
  const rows = [...pnlCategory.expense.rows].sort(
    (a, b) => b.cents - a.cents || (a.name ?? "").localeCompare(b.name ?? ""),
  );
  const maxExpenseCents = rows.length > 0 ? Math.max(...rows.map((i) => i.cents), 1) : 1;

  const prevRange = prevPnlCategory
    ? { from: prevPnlCategory.from, to: prevPnlCategory.to }
    : stepRange(range, -1, today);
  const prevPeriodLabel = rangeLabel(prevRange, today);

  return (
    <div
      className="mt-6 rounded-lg border border-border bg-card p-4"
      data-testid="spending-category-bars-card"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div>
          <h3 className="m-0 text-base font-semibold">Spending by category</h3>
          <p className="m-0 text-xs text-muted-foreground">
            Biggest first. Flexible ones are where the wiggle room lives. Change is against{" "}
            {prevPeriodLabel}.
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No expenses in this period</p>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: WCAG 2.1.1 scrollable table container
        <div
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WCAG 2.1.1 scrollable container keyboard access
          tabIndex={0}
          role="region"
          aria-label="Category spending breakdown"
        >
          <div className="min-w-[500px]">
            {/* Table header */}
            <div className="grid grid-cols-[minmax(180px,280px)_1fr_100px_140px] items-center gap-3 pb-2 text-xs font-medium text-muted-foreground">
              <span>Category</span>
              <span aria-hidden="true" />
              <span className="text-right">Amount</span>
              <span className="text-right">vs {prevPeriodLabel}</span>
            </div>

            {/* Category rows */}
            <div className="divide-y divide-border/50">
              {rows.map((row) => {
                const isUncat = row.id === null;
                const catSummary = row.id ? categoryMap.get(row.id) : undefined;
                const name = isUncat ? "Uncategorised" : (row.name ?? "Unnamed");
                const groupName = isUncat ? "" : (row.groupName ?? catSummary?.groupName ?? "");
                const isFlexible = catSummary?.isFixedCost === false;

                const groupIndex = pnlGroup.expense.rows.findIndex((g) => g.id === row.groupId);
                const colorClass = isUncat
                  ? "bg-warning"
                  : groupIndex >= 0 && groupIndex < RAMP_BG_CLASSES.length
                    ? RAMP_BG_CLASSES[groupIndex]
                    : "bg-muted-foreground";
                const fillClass = isUncat
                  ? "fill-warning"
                  : groupIndex >= 0 && groupIndex < RAMP_FILLS.length
                    ? RAMP_FILLS[groupIndex]
                    : "fill-muted-foreground";

                const percentOfMax = Math.max(
                  0,
                  Math.min(100, Math.round((row.cents / maxExpenseCents) * 100)),
                );

                const prevCents = prevCategorySpend.get(row.id) ?? 0;
                const changeText = formatCategoryChange(row.cents, prevCents, range, today);

                const searchParams = isUncat
                  ? { uncategorised: "true" as const, from: range.from, to: range.to }
                  : { category: row.id, from: range.from, to: range.to };

                return (
                  <Link
                    key={`category-row-${row.id ?? "null"}`}
                    to="/transactions"
                    search={searchParams}
                    className="group grid grid-cols-[minmax(180px,280px)_1fr_100px_140px] items-center gap-3 py-2.5 text-sm transition-colors hover:bg-muted/40 cursor-pointer no-underline text-foreground"
                    data-testid={`category-row-${row.id ?? "uncategorised"}`}
                  >
                    {/* Category column */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-xs shrink-0 ${colorClass}`}
                        aria-hidden="true"
                        data-testid="group-color-square"
                      />
                      <span className="font-medium text-foreground group-hover:underline truncate">
                        {name}
                      </span>
                      {isFlexible ? (
                        <span
                          className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-primary not-italic shrink-0"
                          data-testid="flexible-badge"
                        >
                          flexible
                        </span>
                      ) : null}
                      {groupName ? (
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                          {groupName}
                        </span>
                      ) : null}
                    </div>

                    {/* Progress track bar */}
                    <div className="w-full">
                      <svg
                        className="h-2 w-full rounded-full bg-muted overflow-hidden"
                        viewBox="0 0 100 8"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <rect
                          x="0"
                          y="0"
                          width={percentOfMax}
                          height="8"
                          rx="4"
                          className={fillClass}
                        />
                      </svg>
                    </div>

                    {/* Amount */}
                    <div className="text-right font-semibold text-foreground tabular-nums">
                      {formatCents(row.cents)}
                    </div>

                    {/* Change vs previous period */}
                    <div
                      className="text-right text-xs text-muted-foreground tabular-nums truncate"
                      data-testid={`category-change-${row.id ?? "uncategorised"}`}
                    >
                      {changeText}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
