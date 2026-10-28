import { Link } from "@tanstack/react-router";
import type { ImportResult, PdfImportResult } from "../../api.ts";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Whether every row was already imported: open review items are shown by the link, not here. */
const nothingNew = (r: ImportResult) => r.newCount === 0 && r.dupCount > 0 && r.setAsideCount === 0;

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

/**
 * The result line for a finished PDF statement upload: a passing batch is verified and staged —
 * it never says "imported", because nothing was committed (a ready batch waits for review).
 */
export function pdfSummaryText(result: PdfImportResult): string {
  if (result.newCount === 0 && result.dupCount > 0)
    return "Nothing new. That statement is already verified and staged.";
  return `${result.newCount} ${plural(result.newCount, "row", "rows")} verified and staged.`;
}

export interface PdfImportSummaryProps {
  readonly result: PdfImportResult;
}

export function PdfImportSummary({ result }: PdfImportSummaryProps) {
  return (
    <div className="space-y-1 text-sm" data-testid="import-summary">
      <p className="font-semibold">{pdfSummaryText(result)}</p>
    </div>
  );
}

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
