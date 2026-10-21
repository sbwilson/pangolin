import { Link } from "@tanstack/react-router";
import type { ImportResult } from "../../api.ts";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Whether the import skipped rows and nothing is waiting: every row was already imported. */
const nothingNew = (r: ImportResult) =>
  r.newCount === 0 && r.dupCount > 0 && r.setAsideCount === 0 && r.needReviewCount === 0;

/** The result line for a finished import, from counts only. */
export function summaryText(result: ImportResult): string {
  const { newCount, dupCount, setAsideCount } = result;
  if (nothingNew(result)) return "Nothing new. You've already imported all of this.";
  if (newCount === 0 && dupCount === 0 && setAsideCount === 0) {
    return "Nothing to import. That file had no transactions.";
  }
  const base =
    setAsideCount > 0 ? `${newCount} imported · ${setAsideCount} set aside` : `${newCount} new`;
  return dupCount > 0
    ? `${base} · ${dupCount} ${plural(dupCount, "duplicate", "duplicates")} skipped`
    : base;
}

/** The link's text: "1 needs review", "3 need review". */
export const reviewLinkText = (count: number): string =>
  `${count} ${plural(count, "needs", "need")} review`;

export interface ImportSummaryProps {
  readonly result: ImportResult;
  readonly onNavigate: () => void;
}

export function ImportSummary({ result, onNavigate }: ImportSummaryProps) {
  const needReview = result.needReviewCount;
  return (
    <div className="space-y-1 text-sm" data-testid="import-summary">
      <p className="font-semibold">{summaryText(result)}</p>
      {needReview === 0 ? null : (
        <p>
          <Link to="/review" onClick={onNavigate} className="font-semibold text-primary underline">
            {reviewLinkText(needReview)}
          </Link>
        </p>
      )}
    </div>
  );
}
