import { useQuery } from "@tanstack/react-query";
import { fetchReviewItems } from "../api.ts";
import { REVIEW_KEY, ReviewCardView } from "../components/review/index.ts";
import { useReviewCounts } from "../components/review/useReviewCounts.ts";

/** "1 thing needs you", "3 things need you". */
export function reviewHeading(count: number): string {
  return count === 1 ? "1 thing needs you" : `${count} things need you`;
}

/**
 * Needs review: every open item the signed-in person may see, oldest first, one card per item
 * with the actions its kind allows. The partner chip is a number only: how many items both of
 * them can see are still open.
 */
export function ReviewPage() {
  const items = useQuery({ queryKey: REVIEW_KEY, queryFn: fetchReviewItems, retry: false });
  const counts = useReviewCounts();
  const partner = counts.data?.partner ?? null;

  return (
    <section aria-labelledby="review">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="review" className="m-0">
          {items.data === undefined
            ? "Needs review"
            : items.data.length === 0
              ? "Needs review"
              : reviewHeading(items.data.length)}
        </h2>
        {partner === null ? null : (
          <p
            data-testid="partner-chip"
            className="m-0 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
          >
            {partner.displayName}: {partner.pending} left
          </p>
        )}
      </header>

      {items.isPending ? <p>Loading…</p> : null}
      {items.isError ? <p role="alert">Needs review is unavailable. Reload to try again.</p> : null}
      {items.data?.length === 0 ? <p>Nothing needs you. Nice.</p> : null}
      {items.data === undefined || items.data.length === 0 ? null : (
        <ul className="m-0 mt-3 list-none space-y-2 p-0">
          {items.data.map((card) => (
            <ReviewCardView key={card.id} card={card} />
          ))}
        </ul>
      )}
    </section>
  );
}
