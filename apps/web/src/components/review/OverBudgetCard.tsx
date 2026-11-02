import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  adjustBudgetLimitFromReview,
  dismissBudgetReviewItem,
  type ReviewCard,
  type ReviewDetail,
} from "../../api.ts";
import { formatCents } from "../../lib/money.ts";
import { Button } from "../ui/button.tsx";
import { INPUT_CLASS_RING_DISABLED } from "../ui/input-class.ts";
import { ReviewCardFrame, useReviewAction } from "./ReviewCardFrame.tsx";

type BudgetDetail = Extract<ReviewDetail, { type: "budget" }>;

/**
 * OverBudgetCard: Shows an over-budget review card with a warning progress bar,
 * cheeky nudge line, and actions: "Got it", "Adjust limit", and "Open budget".
 * Follows DESIGN.md: warning color tokens (`var(--warning)`, `var(--warning-bg)`), no mascots.
 */
export function OverBudgetCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: BudgetDetail;
}) {
  const { run, busy, error } = useReviewAction();
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [newLimitStr, setNewLimitStr] = useState((detail.limitCents / 100).toFixed(0));

  const spentFormatted = formatCents(detail.spentCents);
  const limitFormatted = formatCents(detail.limitCents);
  const overFormatted = formatCents(detail.overCents);

  // Cheeky nudge line per UX EXPERIENCE.md & plan:
  // "${targetName}'s had a big ${cadence}: $${spent} of $${limit}"
  const nudge = `${detail.targetName}'s had a big ${detail.cadence}: ${spentFormatted} of ${limitFormatted}`;

  const pct =
    detail.limitCents > 0
      ? Math.min(100, Math.round((detail.spentCents / detail.limitCents) * 100))
      : 100;

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dollars = parseFloat(newLimitStr);
    if (isNaN(dollars) || dollars <= 0) return;
    const cents = Math.round(dollars * 100);
    void run(async () => {
      await adjustBudgetLimitFromReview(card.id, cents);
      setIsAdjusting(false);
    });
  };

  return (
    <ReviewCardFrame card={card} error={error}>
      <div className="mt-1 space-y-2">
        <p className="m-0 font-medium text-foreground">{nudge}</p>
        <p className="m-0 text-xs text-muted-foreground">
          Over by <span className="font-semibold text-warning">{overFormatted}</span>
        </p>

        {/* Warning bar */}
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-warning transition-all" style={{ width: `${pct}%` }} />
        </div>

        {isAdjusting ? (
          <form onSubmit={handleAdjustSubmit} className="mt-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">$</span>
            <input
              type="number"
              step="1"
              min="1"
              value={newLimitStr}
              onChange={(e) => setNewLimitStr(e.target.value)}
              className={`${INPUT_CLASS_RING_DISABLED} h-8 w-24 text-xs`}
              placeholder="500"
              // biome-ignore lint/a11y/noAutofocus: user clicked "Adjust limit" to edit inline
              autoFocus
              disabled={busy}
            />
            <Button type="submit" size="sm" disabled={busy}>
              Save limit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setIsAdjusting(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => dismissBudgetReviewItem(card.id))}
            >
              Got it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setIsAdjusting(true)}
            >
              Adjust limit
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/planning/budgets">Open budget</Link>
            </Button>
          </div>
        )}
      </div>
    </ReviewCardFrame>
  );
}
