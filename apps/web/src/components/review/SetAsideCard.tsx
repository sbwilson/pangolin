import { useState } from "react";
import {
  type ReviewCard,
  type ReviewDetail,
  type ReviewSetAsideRow,
  reviewAction,
} from "../../api.ts";
import { formatCents, parseCents } from "../../lib/money.ts";
import { Button } from "../ui/button.tsx";
import { DateInput } from "../ui/date-input.tsx";
import { INPUT_CLASS_RING_DISABLED } from "../ui/input-class.ts";
import { ReviewCardFrame, useReviewAction } from "./ReviewCardFrame.tsx";

type BatchDetail = Extract<ReviewDetail, { type: "batch" }>;

function SetAsideRow({
  card,
  row,
  run,
  busy,
}: {
  readonly card: ReviewCard;
  readonly row: ReviewSetAsideRow;
  readonly run: (fn: () => Promise<unknown>) => Promise<void>;
  readonly busy: boolean;
}) {
  const [postedOn, setPostedOn] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const id = `${card.id}-${row.id}`;

  const save = () => {
    const cents = parseCents(amount);
    if (postedOn === "") return setProblem("Enter the date.");
    if (cents === undefined) return setProblem("Enter an amount like -12.50.");
    if (description.trim() === "") return setProblem("Enter a description.");
    setProblem(null);
    void run(() =>
      reviewAction(card.id, "fix-row", {
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
        Row {row.rowNumber}: <code className="break-all">{row.rawLine}</code>
        {row.reason === null ? null : <> · {row.reason}</>}
      </p>
      {row.proposal && (
        <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-primary">AI proposal:</span>{" "}
              <span>{row.proposal.postedOn}</span> ·{" "}
              <span>{formatCents(row.proposal.amountCents)}</span> ·{" "}
              <span className="font-medium">{row.proposal.description}</span>
              {row.proposal.confidence != null && (
                <span className="ml-1 text-muted-foreground">
                  ({Math.round(row.proposal.confidence * 100)}% sure)
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(() => reviewAction(card.id, "confirm-proposal", { rowId: row.id }))
                }
              >
                Confirm
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (row.proposal) {
                    setPostedOn(row.proposal.postedOn);
                    setAmount((row.proposal.amountCents / 100).toFixed(2));
                    setDescription(row.proposal.description);
                  }
                }}
              >
                Edit
              </Button>
            </div>
          </div>
          {row.proposal.explanation && (
            <p className="m-0 mt-1 text-muted-foreground">{row.proposal.explanation}</p>
          )}
        </div>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-[9rem_8rem_1fr]">
        <div>
          <label htmlFor={`${id}-date`} className="block text-xs text-muted-foreground">
            Date
          </label>
          <DateInput
            id={`${id}-date`}
            value={postedOn}
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
            className={INPUT_CLASS_RING_DISABLED}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-description`} className="block text-xs text-muted-foreground">
            Description
          </label>
          <input
            id={`${id}-description`}
            className={INPUT_CLASS_RING_DISABLED}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
      {problem === null ? null : (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          Save row {row.rowNumber}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "discard-row", { rowId: row.id }))}
        >
          Discard row {row.rowNumber}
        </Button>
      </div>
    </li>
  );
}

/** Rows of an import that could not be read: fix each one inline, or discard it. */
export function SetAsideCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: BatchDetail;
}) {
  const { run, busy, error } = useReviewAction();
  return (
    <ReviewCardFrame card={card} error={error}>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0">
          {detail.rows.length} {detail.rows.length === 1 ? "row" : "rows"} of{" "}
          <span className="font-medium">{detail.source ?? "an import"}</span>
          {detail.accountName === null ? null : <> into {detail.accountName}</>} could not be read.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "interpret-rows"))}
        >
          Ask Pangolin to read these
        </Button>
      </div>
      <ul className="m-0 mt-2 list-none space-y-2 p-0">
        {detail.rows.map((row) => (
          <SetAsideRow key={row.id} card={card} row={row} run={run} busy={busy} />
        ))}
      </ul>
    </ReviewCardFrame>
  );
}
