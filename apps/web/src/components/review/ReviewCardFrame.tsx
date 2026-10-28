import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { ApiError, type ReviewCard, type ReviewTransaction } from "../../api.ts";
import { formatCents } from "../../lib/money.ts";

/** TanStack Query keys of the Needs review inbox: the cards, and the nav badge's counts. */
export const REVIEW_KEY = ["review", "items"] as const;
export const REVIEW_COUNT_KEY = ["review", "count"] as const;

/** The heading each kind's card carries. */
const KIND_LABEL: Readonly<Record<string, string>> = {
  "classify.unclassified": "Needs a category",
  "classify.rule_offer": "Rule offer",
  "import.probable_duplicate": "Possible duplicate",
  "import.transfer_ambiguous": "Possible transfer",
  "import.transfer_ambiguous_private": "Possible transfer",
  "import.set_aside": "Rows set aside",
  "import.balance_gap": "Balance gap",
  "import.pdf_failed": "Statement PDF not verified",
  "imports.handoff": "File from your partner",
  "identity.partner-reset": "Account recovery",
  "identity.recovery-code-used": "Recovery code used",
  "accounts.closing-balance": "Closed with a balance",
  "system.upgrade-failed": "Upgrade failed",
  "system.restored": "Restored from a backup",
  "system.backup-verification-failed": "Backup check failed",
  "job.dead": "A background job failed",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/**
 * Runs a review action, shows its failure on the card, and refetches the inbox either way: an
 * item someone already dealt with (`NotFound`) then drops out of the list. The actions also touch
 * transactions and accounts, so those lists refetch too.
 */
export function useReviewAction() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["review"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger"] }),
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
    ]);
  };
  return { run, busy, error };
}

/** One card of the inbox: the shared border, heading and date, with the kind's body inside. */
export function ReviewCardFrame({
  card,
  error,
  children,
}: {
  readonly card: ReviewCard;
  readonly error?: string | null;
  readonly children: ReactNode;
}) {
  return (
    <li
      data-kind={card.kind}
      className="rounded-lg border border-border bg-card p-3 text-sm"
      aria-label={kindLabel(card.kind)}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {kindLabel(card.kind)}
        </h3>
        <time className="text-xs text-muted-foreground" dateTime={card.createdAt}>
          {card.createdAt.slice(0, 10)}
        </time>
      </div>
      {children}
      {error === null || error === undefined ? null : (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

/** A transaction in one line: what, where, when and how much. */
export function TransactionLine({ transaction }: { readonly transaction: ReviewTransaction }) {
  return (
    <p className="m-0 mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="min-w-0">
        <span className="font-medium">{transaction.description}</span>
        <span className="text-xs text-muted-foreground">
          {" "}
          · {transaction.accountName} · {transaction.postedOn}
        </span>
      </span>
      <span className="tabular-nums font-medium">{formatCents(transaction.amountCents)}</span>
    </p>
  );
}

/** What a card says when the transaction it is about has gone or is no longer visible. */
export function GoneNote() {
  return <p className="m-0 mt-1 text-muted-foreground">That transaction is no longer there.</p>;
}
