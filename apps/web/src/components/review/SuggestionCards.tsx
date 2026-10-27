import {
  bulkAcceptSuggestions,
  type ReviewCard,
  type ReviewDetail,
  reviewAction,
} from "../../api.ts";
import { formatCents } from "../../lib/money.ts";
import { Button } from "../ui/button.tsx";
import { GoneNote, ReviewCardFrame, TransactionLine, useReviewAction } from "./ReviewCardFrame.tsx";

type TransactionDetail = Extract<ReviewDetail, { type: "transaction" }>;

interface AiSuggestionCardProps {
  readonly card: ReviewCard;
  readonly detail: TransactionDetail;
}

/** Individual card for an AI categorisation suggestion. */
export function AiSuggestionCard({ card, detail }: AiSuggestionCardProps) {
  const { run, busy, error } = useReviewAction();
  const suggestion = detail.suggestion;
  const confidence = suggestion?.confidence ?? null;
  const isHighConfidence = (confidence ?? 0) >= 0.9;
  const confidencePct = confidence !== null ? Math.round(confidence * 100) : null;
  const confidenceText =
    confidencePct === null
      ? "AI suggestion"
      : isHighConfidence
        ? "Very sure · 90%+"
        : `Fairly sure · ${confidencePct}%`;
  const meterWidth =
    confidencePct === null
      ? 50
      : isHighConfidence
        ? 95
        : Math.max(10, Math.min(100, confidencePct));

  return (
    <ReviewCardFrame card={card} error={error}>
      {detail.transaction === null ? (
        <GoneNote />
      ) : (
        <TransactionLine transaction={detail.transaction} />
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm">
          <span className="text-muted-foreground">Suggested category: </span>
          <span className="font-semibold">
            {suggestion?.categoryName ?? suggestion?.suggestedValue}
          </span>
        </p>
        <div className="flex items-center gap-1.5" title={confidenceText}>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${meterWidth}%` }} />
          </div>
          <span className="text-xs text-muted-foreground font-medium">{confidenceText}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "accept-suggestion"))}
        >
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "dismiss-suggestion"))}
        >
          Dismiss
        </Button>
      </div>
    </ReviewCardFrame>
  );
}

interface BulkAcceptCardProps {
  readonly items: readonly ReviewCard[];
  readonly onUntick: (id: string) => void;
}

/** Grouped card at top of /review for bulk-accepting high-confidence (≥ 90%) suggestions. */
export function BulkAcceptCard({ items, onUntick }: BulkAcceptCardProps) {
  const { run, busy, error } = useReviewAction();

  if (items.length === 0) return null;

  const handleAcceptAll = () => {
    const ids = items.map((item) => item.id);
    void run(() => bulkAcceptSuggestions({ ids }));
  };

  return (
    <li
      data-kind="classify.bulk_accept"
      className="rounded-lg border border-border bg-card p-3 text-sm"
      aria-label="Bulk accept suggestions"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">
          {items.length === 1
            ? "1 we're very sure about"
            : `${items.length} more we're very sure about`}
        </h3>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: "95%" }} />
          </div>
          <span className="text-xs text-muted-foreground font-medium">Very sure · 90%+</span>
        </div>
      </div>
      <div className="divide-y divide-border/50">
        {items.map((card) => {
          const detail = card.detail;
          const txn = detail.type === "transaction" ? detail.transaction : null;
          const suggestion = detail.type === "transaction" ? detail.suggestion : null;
          return (
            <div key={card.id} className="flex items-center justify-between gap-3 py-1.5">
              <label className="flex min-w-0 cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={true}
                  disabled={busy}
                  onChange={() => onUntick(card.id)}
                  className="h-4 w-4 rounded border-border"
                  aria-label={`Include ${txn?.description ?? "transaction"} as ${suggestion?.categoryName ?? suggestion?.suggestedValue ?? "category"}`}
                />
                <span className="truncate text-sm">
                  <span className="font-medium">{txn?.description}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="font-medium text-primary">
                    {suggestion?.categoryName ?? suggestion?.suggestedValue}
                  </span>
                </span>
              </label>
              <span className="shrink-0 text-right text-sm font-medium tabular-nums">
                {txn ? formatCents(txn.amountCents) : null}
              </span>
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3">
        <Button
          type="button"
          size="sm"
          disabled={busy || items.length === 0}
          onClick={handleAcceptAll}
        >
          Accept all
        </Button>
      </div>
    </li>
  );
}
