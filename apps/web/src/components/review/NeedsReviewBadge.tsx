import { cn } from "@/lib/utils.ts";
import { useReviewCounts } from "./useReviewCounts.ts";

/**
 * The nav badge: the number of things waiting, or a check at zero. Nothing while the count is
 * loading or unavailable.
 */
export function NeedsReviewBadge({ className }: { readonly className?: string }) {
  const counts = useReviewCounts();
  if (counts.data === undefined) return null;
  const { open } = counts.data;
  if (open === 0) {
    return (
      <span
        data-testid="review-badge"
        className={cn("inline-flex size-4 items-center justify-center text-primary", className)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
        <span className="sr-only">, all clear</span>
      </span>
    );
  }
  return (
    <span
      data-testid="review-badge"
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground",
        className,
      )}
    >
      {open}
      <span className="sr-only"> waiting</span>
    </span>
  );
}
