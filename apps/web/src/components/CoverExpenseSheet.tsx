import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Temporal } from "@pangolin/shared/temporal";
import { cn } from "@/lib/utils.ts";
import {
  type AllocationStageData,
  applyBufferDivert,
  executeDrawdown,
  type ExecuteDrawdownResultData,
  type GoalData,
  type GoalRuleData,
  proposeDrawdown,
  type ProposeDrawdownResultData,
} from "../api.ts";
import { centsToText, formatCents, parseCents } from "../lib/money.ts";
import { Button } from "./ui/button.tsx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function formatMonthYear(isoDay: string): string {
  try {
    return Temporal.PlainDate.from(isoDay).toLocaleString("en-AU", {
      month: "short",
      year: "numeric",
    });
  } catch {
    return isoDay;
  }
}

export interface CoverExpenseSheetProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly pool?: "shared" | string;
  readonly initialReason?: "large_purchase" | "shortfall";
  readonly initialAmountCents?: number;
  readonly initialLabel?: string;
  readonly initialTransactionId?: string;
  readonly goals: readonly GoalData[];
  readonly activeStage: AllocationStageData | null;
  readonly rules: readonly GoalRuleData[];
  readonly onCovered: (result: ExecuteDrawdownResultData, summaryMessage: string) => void;
  readonly onBufferDiverted?: (message: string) => void;
}

interface GoalCoverRow {
  readonly goalId: string;
  readonly goalName: string;
  readonly kind: "flexible" | "protected";
  readonly isEmergencyFund: boolean;
  readonly currentBalanceCents: number;
  readonly proposedAmountCents: number;
  readonly userAmountCents: number;
}

export function CoverExpenseSheet({
  isOpen,
  onClose,
  pool = "shared",
  initialReason = "large_purchase",
  initialAmountCents,
  initialLabel,
  initialTransactionId,
  goals,
  activeStage,
  rules,
  onCovered,
  onBufferDiverted,
}: CoverExpenseSheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const [reason, setReason] = useState<"large_purchase" | "shortfall">(initialReason);
  const [amountInput, setAmountInput] = useState<string>(
    initialAmountCents ? centsToText(initialAmountCents) : "",
  );
  const [label, setLabel] = useState<string>(initialLabel ?? "");
  const [transactionId, setTransactionId] = useState<string | undefined>(initialTransactionId);

  const [isProtectedUnlocked, setIsProtectedUnlocked] = useState(false);
  const [proposal, setProposal] = useState<ProposeDrawdownResultData | null>(null);
  const [userAmounts, setUserAmounts] = useState<Record<string, number>>({});
  const [inputTexts, setInputTexts] = useState<Record<string, string>>({});
  const [isAltered, setIsAltered] = useState(false);
  const [loadingProposal, setLoadingProposal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when sheet opens
  useEffect(() => {
    if (isOpen) {
      setReason(initialReason);
      setAmountInput(initialAmountCents ? centsToText(initialAmountCents) : "");
      setLabel(initialLabel ?? (initialReason === "shortfall" ? "Goals ahead of the bank" : ""));
      setTransactionId(initialTransactionId);
      setIsProtectedUnlocked(false);
      setIsAltered(false);
      setError(null);
    }
  }, [isOpen, initialReason, initialAmountCents, initialLabel, initialTransactionId]);

  // Trap focus & Escape
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [isOpen]);

  const targetAmountCents = parseCents(amountInput) ?? 0;

  // Fetch proposal whenever amount, reason, pool or unlockProtected changes
  useEffect(() => {
    if (!isOpen || targetAmountCents <= 0) {
      setProposal(null);
      setUserAmounts({});
      setInputTexts({});
      setIsAltered(false);
      return;
    }

    let cancelled = false;
    setLoadingProposal(true);
    setError(null);

    void proposeDrawdown({
      pool,
      reason,
      amountCents: targetAmountCents,
      unlockProtected: isProtectedUnlocked,
    })
      .then((res) => {
        if (cancelled) return;
        setProposal(res);
        const initialMap: Record<string, number> = {};
        const textMap: Record<string, string> = {};
        for (const p of res.proposals) {
          initialMap[p.goalId] = p.proposedAmountCents;
          textMap[p.goalId] = (p.proposedAmountCents / 100).toFixed(2);
        }
        setUserAmounts(initialMap);
        setInputTexts(textMap);
        setIsAltered(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingProposal(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, pool, reason, targetAmountCents, isProtectedUnlocked]);

  // Visible goals belonging to this pool
  const poolGoals = useMemo(() => {
    return goals.filter((g) => (g.personId === null ? "shared" : g.personId) === pool);
  }, [goals, pool]);

  // Rules share for active stage
  const stageBufferBp = useMemo(() => {
    if (!activeStage) return 0;
    const stageRules = rules.filter(
      (r) => r.stageId === activeStage.id && r.source !== "shortfall_override",
    );
    const sum = stageRules.reduce((acc, r) => acc + r.shareBp, 0);
    return Math.max(0, 10000 - sum);
  }, [activeStage, rules]);

  // Combine proposal and goals
  const rows = useMemo<GoalCoverRow[]>(() => {
    if (!proposal) return [];
    return proposal.proposals.map((p) => {
      const userAmount = userAmounts[p.goalId] ?? p.proposedAmountCents;
      return {
        goalId: p.goalId,
        goalName: p.goalName,
        kind: p.kind,
        isEmergencyFund: p.isEmergencyFund,
        currentBalanceCents: p.currentBalanceCents,
        proposedAmountCents: p.proposedAmountCents,
        userAmountCents: userAmount,
      };
    });
  }, [proposal, userAmounts]);

  // Separate into tiers
  const efRow = rows.find((r) => r.isEmergencyFund);
  const flexRows = rows.filter((r) => !r.isEmergencyFund && r.kind === "flexible");
  const protectedRows = rows.filter((r) => !r.isEmergencyFund && r.kind === "protected");

  // If protected is locked, ensure userAmounts for protected goals are 0
  useEffect(() => {
    if (!isProtectedUnlocked) {
      setUserAmounts((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const r of protectedRows) {
          if (next[r.goalId] && next[r.goalId] !== 0) {
            next[r.goalId] = 0;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setInputTexts((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const r of protectedRows) {
          if (next[r.goalId] && next[r.goalId] !== "0.00" && next[r.goalId] !== "0") {
            next[r.goalId] = "0.00";
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [isProtectedUnlocked, protectedRows]);

  // Sum of covered amount by user
  const totalUserCoveredCents = rows.reduce((acc, r) => {
    // If protected is locked, do not count any protected adjustments
    if (r.kind === "protected" && !isProtectedUnlocked) return acc;
    return acc + r.userAmountCents;
  }, 0);

  const leftToCoverCents = Math.max(0, targetAmountCents - totalUserCoveredCents);

  // Check if earlier tiers are exhausted
  const earlierExhausted = useMemo(() => {
    if (reason === "large_purchase") {
      const efFull = !efRow || efRow.userAmountCents >= efRow.currentBalanceCents;
      const flexFull = flexRows.every((r) => r.userAmountCents >= r.currentBalanceCents);
      return efFull && flexFull;
    } else {
      const flexFull = flexRows.every((r) => r.userAmountCents >= r.currentBalanceCents);
      const efFull = !efRow || efRow.userAmountCents >= efRow.currentBalanceCents;
      return flexFull && efFull;
    }
  }, [reason, efRow, flexRows]);

  // Are all currently eligible tiers exhausted?
  const allEligibleExhausted = useMemo(() => {
    if (isProtectedUnlocked) {
      return (
        earlierExhausted &&
        protectedRows.every((r) => r.userAmountCents >= r.currentBalanceCents)
      );
    }
    return earlierExhausted;
  }, [isProtectedUnlocked, earlierExhausted, protectedRows]);

  const canConfirm =
    targetAmountCents > 0 &&
    (leftToCoverCents === 0 || allEligibleExhausted) &&
    totalUserCoveredCents > 0 &&
    !submitting;

  const handleSliderOrInputChange = (
    goalId: string,
    maxCents: number,
    newCents: number,
    textVal?: string,
  ) => {
    const clamped = Math.max(0, Math.min(maxCents, Math.round(newCents)));
    setUserAmounts((prev) => ({
      ...prev,
      [goalId]: clamped,
    }));
    setInputTexts((prev) => ({
      ...prev,
      [goalId]: textVal !== undefined ? textVal : (clamped / 100).toFixed(2),
    }));
    setIsAltered(true);
  };

  const handleResetToProposal = () => {
    if (!proposal) return;
    const initialMap: Record<string, number> = {};
    const textMap: Record<string, string> = {};
    for (const p of proposal.proposals) {
      initialMap[p.goalId] = p.proposedAmountCents;
      textMap[p.goalId] = (p.proposedAmountCents / 100).toFixed(2);
    }
    setUserAmounts(initialMap);
    setInputTexts(textMap);
    setIsAltered(false);
  };

  const handleConfirmCover = async () => {
    if (!canConfirm) return;
    try {
      setSubmitting(true);
      setError(null);
      const adjustments = rows
        .filter((r) => {
          if (r.kind === "protected" && !isProtectedUnlocked) return false;
          return r.userAmountCents > 0;
        })
        .map((r) => ({
          goalId: r.goalId,
          amountCents: r.userAmountCents,
        }));

      const res = await executeDrawdown({
        pool,
        reason,
        label: label.trim() || (reason === "shortfall" ? "Shortfall cover" : "Cover an expense"),
        amountCents: targetAmountCents,
        transactionId: transactionId ?? null,
        adjustments,
      });

      // Construct nice summary toast text matching mockup:
      // "Covered Car repair, $16,400: Rainy day $8,000, Japan trip $6,000, House deposit $2,400."
      const parts = adjustments
        .map((a) => {
          const gName = rows.find((r) => r.goalId === a.goalId)?.goalName ?? "Goal";
          return `${gName} ${formatCents(a.amountCents)}`;
        })
        .join(", ");
      const displayLabel = label.trim() || (reason === "shortfall" ? "shortfall" : "expense");
      const summaryMessage = `Covered ${displayLabel}, ${formatCents(totalUserCoveredCents)}: ${parts}.`;

      onClose();
      onCovered(res, summaryMessage);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBufferDivertClick = async () => {
    try {
      setSubmitting(true);
      setError(null);
      await applyBufferDivert({
        pool,
        shareBp: 0,
        shortfallCents: targetAmountCents,
      });
      onClose();
      if (onBufferDiverted) {
        onBufferDiverted(
          `Buffer divert applied for ${pool === "shared" ? "shared" : "personal"} savings. Shortfall remains flagged until covered.`,
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="cover-expense-sheet">
      {/* Backdrop */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className="fixed inset-0 h-full w-full cursor-default bg-black/40 transition-opacity"
        onClick={onClose}
      />

      {/* Sheet panel */}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex h-full w-full max-w-lg flex-col border-l border-border bg-background shadow-xl outline-none",
          "overflow-hidden",
        )}
      >
        {/* Header */}
        <header className="border-b border-border p-5">
          <div className="flex items-center justify-between">
            <h2 id={titleId} className="text-xl font-bold tracking-tight text-foreground">
              Cover an expense
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {reason === "large_purchase"
              ? "Things break. Here's where it can come from."
              : "Small withdrawals added up. Here's where it can come from."}
          </p>

          {/* Amount and label */}
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
                ${amountInput || "0"}
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                {label || (reason === "shortfall" ? "Goals ahead of the bank" : "Expense")}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 font-medium capitalize text-foreground">
                {pool === "shared" ? "Shared" : "Personal"}
              </span>
              <span>
                {pool === "shared" ? "Shared savings" : "Personal savings"} &bull;{" "}
                {reason === "large_purchase" ? "large purchase" : "gradual shortfall"}
              </span>
            </div>
          </div>
        </header>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {loadingProposal && (
            <p className="text-xs text-muted-foreground animate-pulse">Calculating proposal...</p>
          )}

          {/* Reason ordering sections */}
          {reason === "large_purchase" ? (
            <>
              {/* Emergency fund section */}
              {renderEmergencyFundSection()}
              {/* Flexible section */}
              {renderFlexibleSection()}
              {/* Protected section */}
              {renderProtectedSection()}
            </>
          ) : (
            <>
              {/* Flexible section */}
              {renderFlexibleSection()}
              {/* Emergency fund section */}
              {renderEmergencyFundSection()}
              {/* Protected section */}
              {renderProtectedSection()}
              {/* Buffer divert callout */}
              {renderBufferDivertCallout()}
            </>
          )}
        </div>

        {/* Footer (sticky) */}
        <footer className="border-t border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">Left to cover</span>
            <span
              className={cn(
                "text-xl font-bold tabular-nums",
                leftToCoverCents > 0 && !allEligibleExhausted ? "text-warning" : "text-foreground",
              )}
            >
              {formatCents(leftToCoverCents)}
            </span>
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {leftToCoverCents === 0 ? (
              reason === "large_purchase" && efRow && efRow.userAmountCents > 0 ? (
                (() => {
                  const efTarget = goals.find((g) => g.id === efRow.goalId)?.targetCents ?? efRow.currentBalanceCents;
                  const postBal = efRow.currentBalanceCents - efRow.userAmountCents;
                  const fallsBelow80 = postBal < efTarget * 0.8;
                  return fallsBelow80 ? (
                    <span className="text-warning">
                      {efRow.goalName}'s below 80%. Stage 1 comes back until it's topped up.
                    </span>
                  ) : (
                    "Covered from savings. Prior goals untouched."
                  );
                })()
              ) : (
                "Covered from flexible goals. Emergency fund untouched."
              )
            ) : allEligibleExhausted ? (
              `Goals can cover ${formatCents(totalUserCoveredCents)} of ${formatCents(targetAmountCents)}. The rest stays with the buffer.`
            ) : (
              "Adjust sliders to distribute the remaining amount."
            )}
          </p>

          <div className="mt-4 flex items-center justify-between gap-3">
            {isAltered ? (
              <button
                type="button"
                onClick={handleResetToProposal}
                className="text-xs font-medium text-primary hover:underline"
              >
                Back to Pangolin's split
              </button>
            ) : (
              <div />
            )}

            <Button
              type="button"
              onClick={handleConfirmCover}
              disabled={!canConfirm}
              className="px-5 py-2 text-sm font-semibold"
            >
              {submitting ? "Confirming..." : "Confirm cover"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );

  function renderEmergencyFundSection() {
    if (!efRow) return null;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-border/50 pb-1">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Emergency fund
          </span>
          <span className="text-xs text-muted-foreground">
            {reason === "large_purchase" ? "first, for a large purchase" : "next, for a shortfall"}
          </span>
        </div>
        {renderRow(efRow)}
      </div>
    );
  }

  function renderFlexibleSection() {
    if (flexRows.length === 0) return null;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-border/50 pb-1">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Flexible
          </span>
          <span className="text-xs text-muted-foreground">
            {isAltered ? "you changed Pangolin's split" : "Pangolin's split, by balance"}
          </span>
        </div>
        <div className="space-y-4">
          {flexRows.map((row) => renderRow(row))}
        </div>
      </div>
    );
  }

  function renderProtectedSection() {
    if (protectedRows.length === 0) return null;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-border/50 pb-1">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Protected
          </span>
          <span className="text-xs text-muted-foreground">
            {isProtectedUnlocked ? "unlocked" : "last resort"}
          </span>
        </div>

        {/* Warning callout */}
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
          <div className="flex items-start gap-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-white">
              !
            </span>
            <div className="flex-1 leading-relaxed">
              {isProtectedUnlocked ? (
                <span>
                  Protected goals are unlocked. Drawing from them will postpone their target arrival dates.
                </span>
              ) : (
                <span>
                  Protected goals are set aside and shielded from routine drawdowns. Unlocking them will delay their target arrival dates.
                </span>
              )}
            </div>
            {!isProtectedUnlocked && (
              <button
                type="button"
                onClick={() => setIsProtectedUnlocked(true)}
                className="shrink-0 rounded border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
              >
                Use protected goals
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {protectedRows.map((row) => renderRow(row, !isProtectedUnlocked))}
        </div>
      </div>
    );
  }

  function renderBufferDivertCallout() {
    if (reason !== "shortfall" || stageBufferBp <= 0) return null;
    const divertPct = Math.round(stageBufferBp / 100);
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-xs text-foreground">
        <div className="font-semibold text-foreground">Rather leave your goals alone?</div>
        <p className="mt-1 leading-relaxed text-muted-foreground">
          {activeStage?.name ?? "Active stage"} gives the buffer {divertPct}% of each period. Move $50/fortnight from the buffer until the shortfall is covered. The shortfall stays flagged till then.
        </p>
        <div className="mt-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleBufferDivertClick}
            disabled={submitting}
            className="text-xs"
          >
            Move from the buffer instead
          </Button>
        </div>
      </div>
    );
  }

  function renderRow(row: GoalCoverRow, isLocked: boolean = false) {
    const balance = row.currentBalanceCents;
    const userVal = row.userAmountCents;
    const balanceAfter = Math.max(0, balance - userVal);
    const sliderVal = isLocked ? 0 : userVal;

    return (
      <div key={row.goalId} className={cn("space-y-1.5", isLocked && "opacity-60")}>
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <span>{row.goalName}</span>
            {row.isEmergencyFund && (
              <span className="rounded bg-accent/80 px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                Emergency fund
              </span>
            )}
            {row.kind === "protected" && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                Protected
              </span>
            )}
            {isLocked && (
              <span className="text-muted-foreground" aria-label="Locked">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
            )}
          </div>
          <span className="tabular-nums text-muted-foreground">
            {formatCents(balance)} saved
          </span>
        </div>

        {/* Slider + numeric text input */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <input
              type="range"
              min="0"
              max={balance}
              step="100" // $1 steps in cents
              value={sliderVal}
              disabled={isLocked || balance === 0}
              onChange={(e) =>
                handleSliderOrInputChange(row.goalId, balance, Number(e.target.value))
              }
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary disabled:cursor-not-allowed"
              aria-label={`${row.goalName} cover amount`}
            />
          </div>

          <div className="relative flex w-24 items-center">
            <span className="absolute left-2 text-xs text-muted-foreground">$</span>
            <input
              type="text"
              inputMode="decimal"
              disabled={isLocked || balance === 0}
              value={isLocked ? "0" : (inputTexts[row.goalId] ?? (userVal / 100).toFixed(2))}
              onChange={(e) => {
                const text = e.target.value;
                // Allow empty or numbers with optional decimal point and up to 2 decimal places
                if (text === "" || /^\d*\.?\d{0,2}$/.test(text)) {
                  const centsParsed = text === "" || text === "." ? 0 : Math.round(parseFloat(text) * 100);
                  handleSliderOrInputChange(row.goalId, balance, centsParsed, text);
                }
              }}
              onBlur={() => {
                // On blur, format to standard currency decimals
                setInputTexts((prev) => ({
                  ...prev,
                  [row.goalId]: (userVal / 100).toFixed(2),
                }));
              }}
              className="h-8 w-full rounded border border-input bg-background pl-6 pr-2 text-right text-xs font-medium tabular-nums text-foreground outline-none focus:border-primary disabled:bg-muted"
            />
          </div>
        </div>

        {/* Arrival status / preview */}
        <div className="text-[11px] text-muted-foreground">
          {row.isEmergencyFund ? (
            balanceAfter === 0 ? (
              <span className="text-warning">
                Drops to $0. Stage 1 comes back until topped up.
              </span>
            ) : userVal > 0 ? (
              <span>Drops to {formatCents(balanceAfter)}.</span>
            ) : (
              <span>Not needed. Stays full.</span>
            )
          ) : userVal > 0 ? (
            <span>
              Balance drops to {formatCents(balanceAfter)}. Arrival date may shift.
            </span>
          ) : (
            <span>Untouched. Arrival date unchanged.</span>
          )}
        </div>
      </div>
    );
  }
}
