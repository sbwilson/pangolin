import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type ReviewCard, type ReviewDetail, reviewAction } from "../../api.ts";
import { Button } from "../ui/button.tsx";
import { GoneNote, ReviewCardFrame, TransactionLine, useReviewAction } from "./ReviewCardFrame.tsx";

type TransactionDetail = Extract<ReviewDetail, { type: "transaction" }>;

interface Props {
  readonly card: ReviewCard;
  readonly detail: TransactionDetail;
}

/** An uncategorised transaction: nothing to press here, the category is set on the transaction. */
export function UnclassifiedCard({ card, detail }: Props) {
  return (
    <ReviewCardFrame card={card}>
      {detail.transaction === null ? (
        <GoneNote />
      ) : (
        <TransactionLine transaction={detail.transaction} />
      )}
      <p className="m-0 mt-2 text-xs text-muted-foreground">
        It clears when it has a category.{" "}
        <Link to="/transactions" className="font-medium underline hover:text-foreground">
          Open Transactions
        </Link>
      </p>
    </ReviewCardFrame>
  );
}

/** "Make this a rule?" after a correction. */
export function RuleOfferCard({ card, detail }: Props) {
  const { run, busy, error } = useReviewAction();
  return (
    <ReviewCardFrame card={card} error={error}>
      {detail.transaction === null ? (
        <GoneNote />
      ) : (
        <TransactionLine transaction={detail.transaction} />
      )}
      <p className="m-0 mt-1 text-xs text-muted-foreground">
        You categorised this one. Want a rule for others like it?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "accept-rule"))}
        >
          Make it a rule
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "dismiss-rule"))}
        >
          Not now
        </Button>
      </div>
    </ReviewCardFrame>
  );
}

/** A new transaction that looks like one already there. */
export function DuplicateCard({ card, detail }: Props) {
  const { run, busy, error } = useReviewAction();
  return (
    <ReviewCardFrame card={card} error={error}>
      {detail.transaction === null ? (
        <GoneNote />
      ) : (
        <TransactionLine transaction={detail.transaction} />
      )}
      <p className="m-0 mt-1 text-xs text-muted-foreground">
        It looks like another transaction in the same account a few days apart.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "keep-duplicate"))}
        >
          Keep both
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "remove-duplicate"))}
        >
          Remove this one
        </Button>
      </div>
    </ReviewCardFrame>
  );
}

/** A transaction that could be either side of several transfers: the person picks the other side. */
export function TransferCard({ card, detail }: Props) {
  const { run, busy, error } = useReviewAction();
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <ReviewCardFrame card={card} error={error}>
      {detail.transaction === null ? (
        <GoneNote />
      ) : (
        <TransactionLine transaction={detail.transaction} />
      )}
      {detail.candidates.length === 0 ? (
        <p className="m-0 mt-1 text-xs text-muted-foreground">
          Nothing matching is left to link it to.
        </p>
      ) : (
        <fieldset className="m-0 mt-2 border-0 p-0">
          <legend className="text-xs text-muted-foreground">
            Is it a transfer? Pick the other side.
          </legend>
          <ul className="m-0 mt-1 list-none space-y-1 p-0">
            {detail.candidates.map((candidate) => (
              <li key={candidate.id}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name={`transfer-${card.id}`}
                    checked={chosen === candidate.id}
                    onChange={() => setChosen(candidate.id)}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <TransactionLine transaction={candidate} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {detail.candidates.length === 0 ? null : (
          <Button
            type="button"
            size="sm"
            disabled={busy || chosen === null}
            onClick={() =>
              void run(() => reviewAction(card.id, "link-transfer", { candidateId: chosen }))
            }
          >
            Yes, it's a transfer
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "dismiss-transfer"))}
        >
          No, leave them
        </Button>
      </div>
    </ReviewCardFrame>
  );
}
