import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils.ts";
import type { BudgetSummaryData } from "../api.ts";
import { formatCents } from "../lib/money.ts";

export interface BudgetCardProps {
  readonly summary: BudgetSummaryData;
  readonly targetName: string;
  readonly ownerDisplayName?: string | null;
  readonly ownerColour?: string | null;
  readonly onEdit: () => void;
  readonly className?: string;
}

/** Formats a date string like "2026-10-07" to "7 Oct" or "24 Sep". */
function formatShortDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    if (!year || !month || !day) return dateStr;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}

export function BudgetCard({
  summary,
  targetName,
  ownerDisplayName,
  ownerColour,
  onEdit,
  className,
}: BudgetCardProps) {
  const {
    budget,
    period,
    spentCents,
    remainingCents,
    projectedCents,
    rolloverCents,
    effectiveLimitCents,
    status,
  } = summary;

  const isShared = budget.personId === null;
  const isOver = status === "over-budget";
  const isProjectedOver = status === "heading-over";

  // Cadence & Period text
  const cadenceLabel = budget.cadence === "fortnight" ? "Fortnight" : "Month";
  const periodEndFormatted = formatShortDate(period.end);
  const periodStartFormatted = formatShortDate(period.start);
  const periodText = `${cadenceLabel} to ${periodEndFormatted}`;

  // Limit formatting: e.g. limitCents 40000 -> $400.00
  const limitFormatted = formatCents(budget.limitCents);
  const spentFormatted = formatCents(spentCents);

  // Left vs Over figure
  const overCents = spentCents - effectiveLimitCents;
  const isCurrentlyOver = overCents > 0;

  // Percentage calculations
  const limitBase = effectiveLimitCents > 0 ? effectiveLimitCents : 1;
  const spentPercent = Math.min(100, Math.max(0, (spentCents / limitBase) * 100));
  const projectedPercent = Math.min(100, Math.max(0, (projectedCents / limitBase) * 100));

  // Elapsed fraction across period [start, end)
  let elapsedPercent = 50;
  try {
    const s = new Date(period.start).getTime();
    const e = new Date(period.end).getTime();
    const now = Date.now();
    if (e > s) {
      elapsedPercent = Math.min(100, Math.max(0, ((now - s) / (e - s)) * 100));
    }
  } catch {
    elapsedPercent = 50;
  }

  // Mini trendline points
  // 300x64 coordinate space
  // y: 0 is top (high amount), 64 is bottom (0 amount)
  const maxScale = Math.max(effectiveLimitCents, projectedCents, spentCents, 1) * 1.15;
  const getY = (val: number) => {
    const ratio = Math.min(1, Math.max(0, val / maxScale));
    return (58 - ratio * 48).toFixed(1);
  };
  const limitY = getY(effectiveLimitCents);
  const spentY = getY(spentCents);
  const projY = getY(projectedCents);

  // Elapsed x on 300 width
  const elapsedX = Number(((elapsedPercent / 100) * 300).toFixed(1));

  return (
    <div
      data-testid="budget-card"
      data-status={status}
      className={cn(
        "rounded-xl border bg-card p-5 transition-shadow hover:shadow-sm",
        isOver && "border-warning/50",
        className,
      )}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-base leading-tight text-foreground">{targetName}</h3>
          {isShared ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="8" cy="9" r="3" />
                <circle cx="16" cy="9" r="3" />
                <path d="M2.5 19a5.5 5.5 0 0 1 11 0M10.5 19a5.5 5.5 0 0 1 11 0" />
              </svg>
              <span>Shared</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: ownerColour ?? "var(--person-simon)" }}
                aria-hidden="true"
              />
              <span>{ownerDisplayName ?? "Personal"}</span>
            </span>
          )}
          <span className="text-xs text-muted-foreground">{periodText}</span>
        </div>

        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${targetName} budget`}
          className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 20h4L19 9l-4-4L4 16z" />
            <path d="M13.5 6.5l4 4" />
          </svg>
        </button>
      </div>

      {/* Figures Row */}
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-xl font-bold tabular-nums text-foreground">{spentFormatted}</span>
        <span className="text-sm text-muted-foreground">of {limitFormatted}</span>
        <div className="ml-auto text-sm tabular-nums">
          {isCurrentlyOver ? (
            <span className="font-semibold text-warning">{formatCents(overCents)} over</span>
          ) : (
            <span className="text-muted-foreground">{formatCents(remainingCents)} left</span>
          )}
        </div>
      </div>

      {/* Progress Bar with Projection & Elapsed Tick */}
      <div
        role="img"
        aria-label={`${targetName}: ${spentFormatted} of ${limitFormatted}`}
        className="relative mt-2.5 h-2 w-full rounded-full bg-border overflow-hidden"
      >
        {/* Spent Fill */}
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 rounded-full transition-all",
            isOver ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${spentPercent}%` }}
        />

        {/* Projected Fill (hatching) */}
        {!isOver && projectedPercent > spentPercent && (
          <div
            className={cn(
              "absolute top-0 bottom-0 opacity-60 rounded-r-full",
              isProjectedOver
                ? "bg-[repeating-linear-gradient(135deg,var(--warning)_0_2px,transparent_2px_5px)]"
                : "bg-[repeating-linear-gradient(135deg,var(--primary)_0_2px,transparent_2px_5px)]",
            )}
            style={{
              left: `${spentPercent}%`,
              width: `${Math.min(100 - spentPercent, projectedPercent - spentPercent)}%`,
            }}
          />
        )}

        {/* Elapsed Time Tick Mark */}
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-0.5 bg-foreground/50 z-10"
          style={{ left: `calc(${elapsedPercent}% - 1px)` }}
        />
      </div>

      {/* Pace and Rollover line */}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
        <div>
          {isOver ? (
            <span className="font-semibold text-warning">
              Heading for {formatCents(projectedCents)} by {periodEndFormatted}
            </span>
          ) : isProjectedOver ? (
            <span className="font-semibold text-warning">
              Heading for {formatCents(projectedCents)} by {periodEndFormatted}
            </span>
          ) : (
            <span className="text-muted-foreground">
              On track for {formatCents(projectedCents)} by {periodEndFormatted}
            </span>
          )}
        </div>
        {rolloverCents !== 0 && (
          <span className="tabular-nums text-muted-foreground">
            {rolloverCents > 0
              ? `+ ${formatCents(rolloverCents)} rolled over`
              : `- ${formatCents(Math.abs(rolloverCents))} carried over`}
          </span>
        )}
      </div>

      {/* Mini Trend Sparkline */}
      <div className="mt-3">
        <svg
          viewBox="0 0 300 64"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Spent ${spentFormatted} so far, projected ${formatCents(projectedCents)} by period end, limit ${limitFormatted}`}
          className="h-16 w-full"
        >
          {/* Limit line */}
          <line x1="0" x2="300" y1={limitY} y2={limitY} stroke="var(--border)" strokeWidth="1.5" />
          {/* Actual spent line */}
          <polyline
            fill="none"
            stroke={isOver ? "var(--warning)" : "var(--primary)"}
            strokeWidth="2"
            points={`0.0,58.0 ${(elapsedX * 0.33).toFixed(1)},${(58 - (58 - Number(spentY)) * 0.3).toFixed(1)} ${(elapsedX * 0.66).toFixed(1)},${(58 - (58 - Number(spentY)) * 0.7).toFixed(1)} ${elapsedX},${spentY}`}
          />
          {/* Projected line */}
          <line
            x1={elapsedX}
            y1={spentY}
            x2="300"
            y2={projY}
            fill="none"
            stroke={isOver || isProjectedOver ? "var(--warning)" : "var(--muted-foreground)"}
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        </svg>

        <div className="mt-0.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{periodStartFormatted}</span>
          <span>to today</span>
          <span>{periodEndFormatted}</span>
        </div>
      </div>

      {/* Over Budget Notice Banner */}
      {isOver && (
        <div className="mt-3 rounded-lg bg-warning-bg p-2.5 text-xs text-warning flex items-center gap-2.5">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-warning font-bold text-[10px]">
            !
          </span>
          <span className="font-medium">
            {targetName}&#8217;s had a big {cadenceLabel.toLowerCase()}.
          </span>
          <Link to="/review" className="ml-auto font-semibold underline hover:opacity-80">
            Open in Needs review
          </Link>
        </div>
      )}
    </div>
  );
}
