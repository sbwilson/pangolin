// Over-budget review actions (AD-1, AD-17, AD-22, CAP-4).
import type { Cents, Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import type { BudgetRow, ReviewItemRow } from "../ports/unit-of-work.ts";
import { resolveReviewItem } from "../system/review-items.ts";
import { write } from "../write.ts";
import { OVER_BUDGET_REVIEW_KINDS } from "./budget-review.ts";

export const dismissBudgetReviewItemInput = z
  .object({
    id: idInput,
  })
  .strict();
export type DismissBudgetReviewItemInput = z.input<typeof dismissBudgetReviewItemInput>;

export const adjustBudgetLimitFromReviewInput = z
  .object({
    id: idInput,
    limitCents: z.number().int().positive(),
  })
  .strict();
export type AdjustBudgetLimitFromReviewInput = z.input<typeof adjustBudgetLimitFromReviewInput>;

function openBudgetReviewItem(ctx: UseCaseContext, id: string): ReviewItemRow {
  const item = ctx.uow
    .read((repos) => repos.reviewItems.listOpenFor(ctx.viewer))
    .find((row) => row.id === id);

  if (item === undefined || !OVER_BUDGET_REVIEW_KINDS.includes(item.kind as any)) {
    throw new AppError("NotFound", "Review item not found");
  }
  return item;
}

/**
 * Dismisses an over-budget review item with resolution "acknowledged".
 */
export function dismissBudgetReviewItem(
  ctx: UseCaseContext,
  input: DismissBudgetReviewItemInput,
): void {
  const parsed = parseInput(dismissBudgetReviewItemInput, input);
  write(ctx, (tx, audit) => {
    const item = openBudgetReviewItem(ctx, parsed.id);
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: item.dedupeKey,
      resolution: "acknowledged",
    });
  });
}

/**
 * Adjusts the budget limit from the over-budget review card, updating the budget limit
 * and resolving the review item with resolution "limit adjusted".
 */
export function adjustBudgetLimitFromReview(
  ctx: UseCaseContext,
  input: AdjustBudgetLimitFromReviewInput,
): BudgetRow {
  const parsed = parseInput(adjustBudgetLimitFromReviewInput, input);
  return write(ctx, (tx, audit) => {
    const item = openBudgetReviewItem(ctx, parsed.id);
    const budgetId = item.entityRef.startsWith("budget:")
      ? item.entityRef.slice("budget:".length)
      : item.entityRef;

    const existing = tx.budgets.findById(ctx.viewer, budgetId as Id<"Budget">);
    if (!existing) {
      throw new AppError("NotFound", "Budget not found");
    }

    const updated: BudgetRow = {
      ...existing,
      limitCents: parsed.limitCents,
      updatedAt: formatInstant(ctx.clock.now()),
    };

    tx.budgets.update(updated);
    audit({
      entity: "budget",
      entityId: updated.id,
      ...(updated.personId ? { personId: updated.personId } : {}),
      action: "update",
      before: existing,
      after: updated,
    });

    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: item.dedupeKey,
      resolution: "limit adjusted",
    });

    return updated;
  });
}
