import { parseDate } from "@pangolin/shared/temporal";
import { cn } from "@/lib/utils.ts";
import type { RecurringSeriesData } from "../api.ts";
import { formatCents } from "../lib/money.ts";
import { Button } from "./ui/button.tsx";

export interface RecurringBillCardProps {
  readonly series: RecurringSeriesData;
  readonly payeeName: string;
  readonly accountName: string;
  readonly onConfirm?: () => void;
  readonly onDismiss?: () => void;
  readonly onDelete?: () => void;
  readonly isConfirming?: boolean;
  readonly isDismissing?: boolean;
  readonly isDeleting?: boolean;
}

/** Formats a date string like "2026-10-07" to "7 Oct 2026". */
function formatShortDate(dateStr: string): string {
  try {
    const plainDate = parseDate(dateStr);
    return plainDate.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function cadenceBadgeLabel(cadence: RecurringSeriesData["cadence"]): string {
  switch (cadence) {
    case "weekly":
      return "Weekly";
    case "fortnightly":
      return "Fortnightly";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "annual":
      return "Annual";
  }
}

export function RecurringBillCard({
  series,
  payeeName,
  accountName,
  onConfirm,
  onDismiss,
  onDelete,
  isConfirming = false,
  isDismissing = false,
  isDeleting = false,
}: RecurringBillCardProps) {
  const isCandidate = series.status === "candidate";
  const formattedAmount = formatCents(series.expectedCents);
  const formattedDueDate = formatShortDate(series.nextDueOn);

  return (
    <div
      data-testid={`recurring-bill-card-${series.id}`}
      className={cn(
        "rounded-xl border p-4 transition-all bg-card text-card-foreground shadow-xs flex flex-col justify-between gap-3",
        isCandidate
          ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10"
          : "border-border hover:border-border/80",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-foreground text-sm tracking-tight truncate">
              {payeeName}
            </h4>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                isCandidate
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              {cadenceBadgeLabel(series.cadence)}
            </span>
            {isCandidate && (
              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-900 dark:text-amber-200">
                Candidate
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{accountName}</p>
        </div>

        <div className="text-right shrink-0">
          <div className="text-base font-bold text-foreground tabular-nums">{formattedAmount}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Due {formattedDueDate}</div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
        {isCandidate ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isDismissing || isConfirming}
              onClick={onDismiss}
              className="text-xs text-muted-foreground hover:text-foreground h-8 px-2.5"
            >
              {isDismissing ? "Dismissing..." : "Dismiss"}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isConfirming || isDismissing}
              onClick={onConfirm}
              className="text-xs font-medium h-8 px-3 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isConfirming ? "Confirming..." : "Confirm bill"}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isDeleting}
            onClick={onDelete}
            className="text-xs text-muted-foreground hover:text-destructive h-8 px-2.5"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>
    </div>
  );
}
