import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  adjustBufferForMismatch,
  dismissSavingsReviewItem,
  fetchGoalsSummary,
  linkWithdrawalToGoal,
  type ReviewCard,
  type ReviewDetail,
  takeFromBufferReviewItem,
} from "../../api.ts";
import { formatCents } from "../../lib/money.ts";
import { CoverExpenseSheet } from "../CoverExpenseSheet.tsx";
import { Button } from "../ui/button.tsx";
import { ReviewCardFrame, TransactionLine, useReviewAction } from "./ReviewCardFrame.tsx";

type LargeWithdrawalDetail = Extract<ReviewDetail, { type: "savings_large_withdrawal" }>;
type ShortfallDetail = Extract<ReviewDetail, { type: "savings_shortfall" }>;
type MismatchDetail = Extract<ReviewDetail, { type: "savings_mismatch" }>;

export function LargeWithdrawalCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: LargeWithdrawalDetail;
}) {
  const { run, busy, error } = useReviewAction();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [linkingGoal, setLinkingGoal] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string>("");

  const summaryQuery = useQuery({
    queryKey: ["planning", "goals", "summary"],
    queryFn: () => fetchGoalsSummary(),
  });

  const goals = summaryQuery.data?.goals ?? [];
  const poolGoals = goals.filter((g) => {
    if (detail.pool === "shared") return g.personId === null;
    return g.personId === detail.pool;
  });

  const txn = detail.transaction;
  const absAmount = txn ? Math.abs(txn.amountCents) : 0;
  const poolLabel = detail.pool === "shared" ? "Shared savings" : "Personal savings";
  const summaryLine = `${formatCents(absAmount)} came out of ${poolLabel}${txn ? ` on ${txn.postedOn}` : ""}`;

  return (
    <ReviewCardFrame card={card} error={error}>
      <div className="mt-1 space-y-3">
        <p className="m-0 font-medium text-foreground">{summaryLine}</p>

        {txn && (
          <div className="rounded-md border border-border/60 bg-muted/40 p-2 text-sm">
            <TransactionLine transaction={txn} />
          </div>
        )}

        {linkingGoal ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
            <label
              htmlFor={`link-goal-select-${card.id}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Select goal:
            </label>
            <select
              id={`link-goal-select-${card.id}`}
              className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
              value={selectedGoalId}
              onChange={(e) => setSelectedGoalId(e.target.value)}
              disabled={busy}
            >
              <option value="">-- Choose goal --</option>
              {poolGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({formatCents(g.currentBalance)})
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={busy || !selectedGoalId}
              onClick={() => {
                if (!selectedGoalId) return;
                void run(async () => {
                  await linkWithdrawalToGoal(card.id, selectedGoalId);
                  setLinkingGoal(false);
                });
              }}
            >
              Confirm link
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setLinkingGoal(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={busy}
              onClick={() => setSheetOpen(true)}
            >
              Cover it
            </Button>

            {poolGoals.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setLinkingGoal(true)}
              >
                It's for a goal
              </Button>
            )}

            {detail.canTakeFromBuffer && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => takeFromBufferReviewItem(card.id))}
              >
                Take it from the buffer
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => dismissSavingsReviewItem(card.id, "not an expense"))}
            >
              Not an expense
            </Button>
          </div>
        )}
      </div>

      {sheetOpen && (
        <CoverExpenseSheet
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
          pool={detail.pool}
          initialReason="large_purchase"
          initialAmountCents={absAmount}
          initialLabel={txn?.payeeName ?? txn?.description ?? "Large withdrawal"}
          initialTransactionId={txn?.id}
          goals={poolGoals}
          activeStage={summaryQuery.data?.activeStage ?? null}
          rules={summaryQuery.data?.rules ?? []}
          onCovered={(_result) => {
            setSheetOpen(false);
            void run(() => Promise.resolve());
          }}
        />
      )}
    </ReviewCardFrame>
  );
}

export function ShortfallCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: ShortfallDetail;
}) {
  const { run, busy, error } = useReviewAction();
  const [sheetOpen, setSheetOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ["planning", "goals", "summary"],
    queryFn: () => fetchGoalsSummary(),
  });

  const goals = summaryQuery.data?.goals ?? [];
  const poolGoals = goals.filter((g) => {
    if (detail.pool === "shared") return g.personId === null;
    return g.personId === detail.pool;
  });

  const summaryLine = `Your goals are ${formatCents(detail.shortfallCents)} ahead of what's in the bank`;

  return (
    <ReviewCardFrame card={card} error={error}>
      <div className="mt-1 space-y-3">
        <p className="m-0 font-medium text-foreground">{summaryLine}</p>

        {detail.hasOpenLargeWithdrawal ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-foreground">
            <p className="m-0 font-medium">Large withdrawal detected in this pool</p>
            <p className="m-0 mt-1 text-xs text-muted-foreground">
              This pool has an open large withdrawal review item. Resolve or cover the withdrawal
              above to eliminate this shortfall.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={busy}
              onClick={() => setSheetOpen(true)}
            >
              Cover it
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/goals">Open goals</Link>
            </Button>
          </div>
        )}
      </div>

      {sheetOpen && (
        <CoverExpenseSheet
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
          pool={detail.pool}
          initialReason="shortfall"
          initialAmountCents={detail.shortfallCents}
          initialLabel="Goal shortfall"
          goals={poolGoals}
          activeStage={summaryQuery.data?.activeStage ?? null}
          rules={summaryQuery.data?.rules ?? []}
          onCovered={(_result) => {
            setSheetOpen(false);
            void run(() => Promise.resolve());
          }}
        />
      )}
    </ReviewCardFrame>
  );
}

export function MismatchCard({
  card,
  detail,
}: {
  readonly card: ReviewCard;
  readonly detail: MismatchDetail;
}) {
  const { run, busy, error } = useReviewAction();
  const summaryLine = `Savings and goals are ${formatCents(detail.differenceCents)} apart`;

  return (
    <ReviewCardFrame card={card} error={error}>
      <div className="mt-1 space-y-3">
        <p className="m-0 font-medium text-foreground">{summaryLine}</p>
        <p className="m-0 text-xs text-muted-foreground">
          A change in your savings accounts or balance adjustments has created a difference with
          your goal targets.
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => adjustBufferForMismatch(card.id))}
          >
            Put the difference in the buffer
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/goals">Open goals</Link>
          </Button>
        </div>
      </div>
    </ReviewCardFrame>
  );
}
