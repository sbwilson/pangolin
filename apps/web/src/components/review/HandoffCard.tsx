import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listAccounts, type ReviewCard, type ReviewDetail, reviewAction } from "../../api.ts";
import { Button } from "../ui/button.tsx";
import { NativeSelect } from "../ui/select.tsx";
import { ReviewCardFrame, useReviewAction } from "./ReviewCardFrame.tsx";

type HandoffDetail = Extract<ReviewDetail, { type: "handoff" }>;

/**
 * A statement a partner imported "for" this person: pick any of their accounts and import it, or
 * discard it. The sender never learns which account it lands in.
 */
export function HandoffCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: HandoffDetail;
}) {
  const { run, busy, error } = useReviewAction();
  const accounts = useQuery({
    queryKey: ["accounts", "list"],
    queryFn: listAccounts,
    retry: false,
  });
  const [accountId, setAccountId] = useState("");
  const selectId = `handoff-account-${card.id}`;
  return (
    <ReviewCardFrame card={card} error={error}>
      <p className="m-0 mt-1">
        <span className="font-medium">{detail.senderName ?? "Your partner"}</span> sent you{" "}
        <span className="font-medium">{detail.filename ?? "a statement"}</span> to import.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor={selectId} className="block text-xs text-muted-foreground">
            Import into
          </label>
          <NativeSelect
            id={selectId}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            disabled={busy}
          >
            <option value="">Choose an account</option>
            {(accounts.data ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={busy || accountId === ""}
          onClick={() => void run(() => reviewAction(card.id, "accept-handoff", { accountId }))}
        >
          Import
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => reviewAction(card.id, "dismiss-handoff"))}
        >
          Discard file
        </Button>
      </div>
      {accounts.isError ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Your accounts could not be loaded.
        </p>
      ) : null}
    </ReviewCardFrame>
  );
}
