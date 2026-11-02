import { Link } from "@tanstack/react-router";
import { dismissBillAlert, type ReviewCard, type ReviewDetail } from "../../api.ts";
import { formatCents } from "../../lib/money.ts";
import { Button } from "../ui/button.tsx";
import { ReviewCardFrame, useReviewAction } from "./ReviewCardFrame.tsx";

type BillAlertDetail = Extract<ReviewDetail, { type: "bill_alert" }>;

function cadenceToNoun(cadence: string): string {
  switch (cadence) {
    case "weekly":
      return "week";
    case "fortnightly":
      return "fortnight";
    case "monthly":
      return "month";
    case "quarterly":
      return "quarter";
    case "annual":
      return "year";
    default:
      return cadence;
  }
}

/**
 * BillAlertCard: Shows a missed bill payment or price rise alert card with warning tokens,
 * summary, details, and actions: "Got it", "View transactions", and "Open bill".
 * Follows Calm & Cheeky design system rules: warning tokens (`var(--warning)`, `var(--warning-bg)`),
 * and no mascots on warning cards.
 */
export function BillAlertCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: BillAlertDetail;
}) {
  const { run, busy, error } = useReviewAction();

  const isMissed = detail.kind === "missed";
  const expectedFormatted = formatCents(detail.expectedCents);
  const actualFormatted = detail.actualCents ? formatCents(detail.actualCents) : null;
  const cadenceNoun = cadenceToNoun(detail.cadence);

  // Headings & nudge copy per UX EXPERIENCE.md & plan:
  // Missed: "${payeeName} didn't turn up this ${cadenceNoun}" / "${payeeName} payment of ${expected} expected by ${dueDate} was not found."
  // Price rise: "${payeeName} is up ${increasePct}% (${actual} vs ${expected})"
  const heading = isMissed
    ? `${detail.payeeName} didn't turn up this ${cadenceNoun}`
    : `${detail.payeeName} is up ${detail.increasePct ?? 0}% (${actualFormatted} vs ${expectedFormatted})`;

  const description = isMissed
    ? `${detail.payeeName} payment of ${expectedFormatted} expected by ${detail.dueDate} was not found in ${detail.accountName}.`
    : `Payment of ${actualFormatted} was detected for ${detail.payeeName} (previously expected ${expectedFormatted}) in ${detail.accountName}.`;

  return (
    <ReviewCardFrame card={card} error={error}>
      <div className="mt-1 space-y-2">
        <p className="m-0 font-medium text-foreground">{heading}</p>
        <p className="m-0 text-xs text-muted-foreground">{description}</p>

        {/* Warning accent banner / bar */}
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
          role="status"
          aria-label={isMissed ? "Missed payment alert" : "Price rise alert"}
        >
          <div className="h-full w-full bg-warning" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => dismissBillAlert(card.id))}
          >
            Got it
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/transactions" search={{ payee: detail.payeeId }}>
              View transactions
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/planning/budgets">Open bill</Link>
          </Button>
        </div>
      </div>
    </ReviewCardFrame>
  );
}
