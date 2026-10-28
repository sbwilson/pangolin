import { lazy, Suspense, useState } from "react";
import {
  type ReviewCard,
  type ReviewDetail,
  type ReviewPdfRow,
  recheckPdfReviewItem,
  reviewAction,
} from "../../api.ts";
import { centsToText, parseCents } from "../../lib/money.ts";
import { Button } from "../ui/button.tsx";
import { DateInput } from "../ui/date-input.tsx";
import { ReviewCardFrame, useReviewAction } from "./ReviewCardFrame.tsx";

// pdf.js only loads when a PDF card actually renders its page image: it stays out of the
// main chunk (and the service worker's precache budget) until a statement needs it.
const PdfPageCanvas = lazy(() =>
  import("./PdfPageCanvas.tsx").then((m) => ({ default: m.PdfPageCanvas })),
);

type PdfDetail = Extract<ReviewDetail, { type: "pdf_batch" }>;

const INPUT =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function PdfRow({
  card,
  row,
  run,
  busy,
  onShowPage,
}: {
  readonly card: ReviewCard;
  readonly row: ReviewPdfRow;
  readonly run: (fn: () => Promise<unknown>) => Promise<void>;
  readonly busy: boolean;
  readonly onShowPage: (page: number) => void;
}) {
  const [postedOn, setPostedOn] = useState(row.corrected.postedOn);
  const [amount, setAmount] = useState(centsToText(row.corrected.amountCents));
  const [description, setDescription] = useState(row.corrected.description);
  const [problem, setProblem] = useState<string | null>(null);
  const id = `${card.id}-${row.id}`;

  const save = () => {
    const cents = parseCents(amount);
    if (postedOn === "") return setProblem("Enter the date.");
    if (cents === undefined) return setProblem("Enter an amount like -12.50.");
    if (description.trim() === "") return setProblem("Enter a description.");
    setProblem(null);
    void run(() =>
      reviewAction(card.id, "correct-pdf-row", {
        rowId: row.id,
        postedOn,
        amountCents: cents,
        description: description.trim(),
      }),
    );
  };

  return (
    <li className="rounded-md border border-border p-2">
      <p className="m-0 text-xs text-muted-foreground">
        Row {row.rowNumber}
        {row.pdfPage === null ? null : (
          <>
            {" · "}
            <button
              type="button"
              className="font-semibold text-primary underline"
              onClick={() => onShowPage(row.pdfPage as number)}
            >
              page {row.pdfPage}
            </button>
          </>
        )}
        {row.reason === null ? null : <> · {row.reason}</>}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[9rem_8rem_1fr]">
        <div>
          <label htmlFor={`${id}-date`} className="block text-xs text-muted-foreground">
            Date
          </label>
          <DateInput
            id={`${id}-date`}
            value={postedOn}
            disabled={busy}
            onChange={(e) => setPostedOn(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-amount`} className="block text-xs text-muted-foreground">
            Amount
          </label>
          <input
            id={`${id}-amount`}
            inputMode="decimal"
            className={INPUT}
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-description`} className="block text-xs text-muted-foreground">
            Description
          </label>
          <input
            id={`${id}-description`}
            className={INPUT}
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
      {problem === null ? null : (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="mt-2">
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          Save row {row.rowNumber}
        </Button>
      </div>
    </li>
  );
}

/**
 * A statement PDF whose deterministic checks failed: the extracted rows on one side, each
 * inline-correctable, beside the page they were read from. Re-check re-runs the checks with no
 * LLM: a passing batch turns ready and this card resolves; a failing one reports its exact error.
 */
export function PdfStatementCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: PdfDetail;
}) {
  const { run, busy, error } = useReviewAction();
  const [recheckError, setRecheckError] = useState<string | null>(null);
  const pages = detail.rows.map((r) => r.pdfPage).filter((p): p is number => p !== null);
  const [page, setPage] = useState(() => pages[0] ?? 1);

  const recheck = () => {
    setRecheckError(null);
    void run(async () => {
      const result = await recheckPdfReviewItem(card.id);
      if (!result.ok) setRecheckError(result.error ?? "The statement still does not balance.");
    });
  };

  return (
    <ReviewCardFrame card={card} error={error}>
      <div className="mt-1">
        <p className="m-0">
          <span className="font-medium">{detail.rows.length}</span>{" "}
          {detail.rows.length === 1 ? "row was" : "rows were"} read from a statement PDF
          {detail.accountName === null ? null : <> into {detail.accountName}</>} that could not be
          verified. Correct the rows against the page, then re-check.
        </p>
        {detail.error === null ? null : (
          <p role="alert" className="m-0 mt-1 text-xs text-destructive">
            {detail.error}
          </p>
        )}
      </div>

      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        <ol className="m-0 list-none space-y-2 p-0">
          {detail.rows.map((row) => (
            <PdfRow key={row.id} card={card} row={row} run={run} busy={busy} onShowPage={setPage} />
          ))}
        </ol>

        <div className="space-y-2">
          <Suspense
            fallback={
              <p className="m-0 rounded-md border border-border p-3 text-xs text-muted-foreground">
                Loading the page viewer…
              </p>
            }
          >
            <PdfPageCanvas batchId={detail.batchId} page={page} />
          </Suspense>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous page
            </Button>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              Page {page}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pages.length === 0 || page >= Math.max(...pages)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next page
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={recheck}>
          Re-check
        </Button>
        {recheckError === null ? null : (
          <p role="alert" className="m-0 text-xs text-destructive">
            {recheckError}
          </p>
        )}
      </div>
    </ReviewCardFrame>
  );
}
