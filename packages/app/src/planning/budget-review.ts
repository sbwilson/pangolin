// Over-budget review item generator (AD-17, AD-22, CAP-4).
import { calculateRollover } from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import { cents } from "@pangolin/shared";
import type { UseCaseContext } from "../context.ts";
import type { BudgetRow, TxRepos } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { defineReviewKind, raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import { personViewer } from "../viewer.ts";
import type { Audit } from "../write.ts";
import { write } from "../write.ts";
import { resolveBudgetPayCalendar } from "./budgets.ts";

/**
 * Review kind for over-budget alerts.
 * Note on AD-22 scoping:
 * For shared budgets (personId === null), scope is "household" (both partners see it).
 * For personal budgets (personId !== null), scope is "person" (visible only to that person).
 * Per review system rules, each ReviewKind has a fixed scope, so we define both.
 */
export const OVER_BUDGET_HOUSEHOLD_REVIEW = defineReviewKind({
  kind: "planning.over_budget",
  module: "planning",
  scope: "household",
});

export const OVER_BUDGET_PERSONAL_REVIEW = defineReviewKind({
  kind: "planning.over_budget.personal",
  module: "planning",
  scope: "person",
});

export const OVER_BUDGET_REVIEW_KINDS = [
  OVER_BUDGET_HOUSEHOLD_REVIEW.kind,
  OVER_BUDGET_PERSONAL_REVIEW.kind,
] as const;

/**
 * Deterministic dedupe key for an over-budget review item:
 * `budget:over_budget:<budgetId>:<periodStart>`
 */
export function budgetOverBudgetDedupeKey(budgetId: string, periodStart: string): string {
  return `budget:over_budget:${budgetId}:${periodStart}`;
}

/**
 * Deterministic entityRef for budget review items:
 * `budget:<budgetId>`
 */
export function budgetEntityRef(budgetId: string): string {
  return `budget:${budgetId}`;
}

/**
 * Brings a single budget's over-budget review item in step with its current spending:
 * - If spent > effectiveLimit, idempotently raises an open review item with dedupe key `budget:over_budget:<budgetId>:<periodStart>`.
 * - If spent <= effectiveLimit, resolves any open review item for that budget and period with resolution "spent is within limit".
 */
export function syncBudgetReviewItem(
  tx: TxRepos,
  audit: Audit,
  ctx: UseCaseContext,
  budgetId: string,
): void {
  const budget = tx.budgets.findById(ctx.viewer, budgetId as any);
  if (!budget) return;

  const today = ctx.clock.today();
  const calendar = resolveBudgetPayCalendar(ctx, budget);
  const currentPeriod = calendar.periodContaining(today);
  const periodStart = currentPeriod.start.toString();
  const periodEnd = currentPeriod.end.toString();

  const spentNum = tx.budgets.calculateSpent(ctx.viewer, budget, today.toString(), {
    start: periodStart,
    end: periodEnd,
  });
  const spentCents = cents(spentNum);

  // Rollover calculation (if enabled)
  let rolloverCents = 0;
  if (budget.rollover) {
    const prevDay = currentPeriod.start.subtract({ days: 1 });
    const prevPeriodRange = calendar.periodContaining(prevDay);
    const prevSpentNum = tx.budgets.calculateSpent(ctx.viewer, budget, today.toString(), {
      start: prevPeriodRange.start.toString(),
      end: prevPeriodRange.end.toString(),
    });
    rolloverCents = calculateRollover(
      budget.rollover,
      cents(budget.limitCents),
      cents(prevSpentNum),
    );
  }

  const effectiveLimitCents = budget.limitCents + rolloverCents;
  const dedupeKey = budgetOverBudgetDedupeKey(budget.id, periodStart);
  const entityRef = budgetEntityRef(budget.id);

  if (spentCents > effectiveLimitCents) {
    if (budget.personId === null) {
      raiseReviewItem(tx, audit, ctx, {
        kind: OVER_BUDGET_HOUSEHOLD_REVIEW,
        entityRef,
        dedupeKey,
      });
    } else {
      raiseReviewItem(tx, audit, ctx, {
        kind: OVER_BUDGET_PERSONAL_REVIEW,
        entityRef,
        dedupeKey,
        personId: budget.personId,
      });
    }
  } else {
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey,
      resolution: "spent is within limit",
    });
  }
}

/**
 * Evaluates all active budgets across the system (or visible to viewer) and syncs their review items.
 * Uses owner perspective for personal budgets so private personal budgets are evaluated with correct visibility.
 */
export function syncAllBudgetReviewItems(ctx: UseCaseContext): number {
  return write(ctx, (tx, audit) => {
    const listViewer =
      ctx.viewer.kind === "system"
        ? systemViewer("job:budget-evaluation")
        : ctx.viewer;
    const budgets = tx.budgets.listVisible(listViewer);
    for (const budget of budgets) {
      const evalViewer =
        budget.personId !== null
          ? personViewer(budget.personId as Id<"Person">, ctx.clock.now())
          : listViewer;
      const evalCtx = { ...ctx, viewer: evalViewer };
      syncBudgetReviewItem(tx, audit, evalCtx, budget.id);
    }
    return budgets.length;
  });
}
