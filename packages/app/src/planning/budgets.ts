// Budget use cases (AD-1, AD-10, AD-13, AD-14, AD-22, CAP-4).
import {
  type BudgetStatus,
  calculateBudgetMath,
  calculateLimitSuggestion,
  calculateRollover,
} from "@pangolin/domain";
import type { Cents, Id } from "@pangolin/shared";
import { cents } from "@pangolin/shared";
import type { Cadence, PayCalendar, PayPeriod } from "@pangolin/shared/period";
import { createCalendarPayCalendar } from "@pangolin/shared/period";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { BudgetRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { resolvePayCalendar } from "./pay-calendar.ts";

export interface BudgetSummary {
  readonly budget: BudgetRow;
  readonly period: PayPeriod;
  readonly spentCents: Cents;
  readonly remainingCents: Cents;
  readonly paceCents: Cents; // Expected spent by elapsed time (linear)
  readonly projectedCents: Cents; // Spent + daily_rate * remaining_days
  readonly rolloverCents: Cents; // Carried over from prior period (if enabled)
  readonly effectiveLimitCents: Cents; // limit + rollover
  readonly status: BudgetStatus;
}

export const createBudgetInput = z
  .object({
    personId: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    categoryGroupId: z.string().nullable().optional(),
    cadence: z.enum(["fortnight", "month"]),
    limitCents: z.number().int().positive(),
    rollover: z.boolean().default(false),
  })
  .strict()
  .refine(
    (data) =>
      (data.categoryId != null && data.categoryGroupId == null) ||
      (data.categoryId == null && data.categoryGroupId != null),
    {
      message: "Budget must target either categoryId or categoryGroupId, but not both",
      path: ["categoryId"],
    },
  );
export type CreateBudgetInput = z.input<typeof createBudgetInput>;

export const updateBudgetInput = z
  .object({
    id: z.string().min(1),
    categoryId: z.string().nullable().optional(),
    categoryGroupId: z.string().nullable().optional(),
    cadence: z.enum(["fortnight", "month"]).optional(),
    limitCents: z.number().int().positive().optional(),
    rollover: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.categoryId !== undefined || data.categoryGroupId !== undefined) {
        return (
          (data.categoryId != null && data.categoryGroupId == null) ||
          (data.categoryId == null && data.categoryGroupId != null)
        );
      }
      return true;
    },
    {
      message: "Budget must target either categoryId or categoryGroupId, but not both",
      path: ["categoryId"],
    },
  );
export type UpdateBudgetInput = z.input<typeof updateBudgetInput>;

export const getBudgetInput = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type GetBudgetInput = z.input<typeof getBudgetInput>;

export const deleteBudgetInput = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type DeleteBudgetInput = z.input<typeof deleteBudgetInput>;

export const getSuggestedLimitInput = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type GetSuggestedLimitInput = z.input<typeof getSuggestedLimitInput>;

export const getBudgetSummaryInput = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type GetBudgetSummaryInput = z.input<typeof getBudgetSummaryInput>;

/**
 * Resolves the appropriate PayCalendar for a budget.
 * - Personal budgets resolve from the person's pay anchor.
 * - Shared budgets resolve from the household's anchor setting
 *   (or fallback to default calendar).
 */
export function resolveBudgetPayCalendar(ctx: UseCaseContext, budget: BudgetRow): PayCalendar {
  const today = ctx.clock.today();

  if (budget.personId !== null) {
    // Personal budget
    const anchor = ctx.uow.read((repos) =>
      repos.payAnchors.findByPersonId(ctx.viewer, budget.personId as Id<"Person">),
    );
    if (anchor) {
      return resolvePayCalendar(ctx, anchor);
    }
  } else {
    // Shared budget: check householdSettings.householdPayAnchorPersonId
    const settings = ctx.uow.read((repos) => repos.householdSettings.get());
    if (settings.householdPayAnchorPersonId) {
      const anchor = ctx.uow.read((repos) =>
        repos.payAnchors.findByPersonId(
          ctx.viewer,
          settings.householdPayAnchorPersonId as Id<"Person">,
        ),
      );
      if (anchor) {
        return resolvePayCalendar(ctx, anchor);
      }
    }
    // Fallback: check any pay anchor visible whose cadence matches budget.cadence
    const targetCadence = budget.cadence === "fortnight" ? "fortnightly" : "monthly";
    const anchors = ctx.uow.read((repos) => repos.payAnchors.listVisible(ctx.viewer));
    const matchingAnchor = anchors.find((a) => a.cadence === targetCadence);
    if (matchingAnchor) {
      return resolvePayCalendar(ctx, matchingAnchor);
    }
  }

  // Default fallback calendar rule matching budget's cadence
  const cadence: Cadence =
    budget.cadence === "fortnight"
      ? { kind: "fortnightly", anchor: today }
      : { kind: "monthly", day: 1 };
  return createCalendarPayCalendar("default", cadence, today);
}

/**
 * Creates a new budget.
 */
export function createBudget(ctx: UseCaseContext, input: CreateBudgetInput): BudgetRow {
  const parsed = parseInput(createBudgetInput, input);
  const targetPersonId =
    parsed.personId !== undefined
      ? parsed.personId
      : ctx.viewer.kind === "person"
        ? null // Default to shared if not specified, or person can specify personId
        : null;

  if (
    targetPersonId !== null &&
    ctx.viewer.kind === "person" &&
    ctx.viewer.personId !== targetPersonId
  ) {
    throw new AppError("NotFound", "Budget not found");
  }

  return write(ctx, (tx, audit) => {
    // Verify target exists
    if (parsed.categoryId) {
      const cat = tx.categories.find(ctx.viewer, parsed.categoryId as Id<"Category">);
      if (!cat) throw new AppError("NotFound", "Category not found");
    }
    if (parsed.categoryGroupId) {
      const grp = tx.categoryGroups.find(ctx.viewer, parsed.categoryGroupId as Id<"CategoryGroup">);
      if (!grp) throw new AppError("NotFound", "Category group not found");
    }

    const id = ctx.newId<"Budget">();
    const now = formatInstant(ctx.clock.now());

    const created: BudgetRow = {
      id,
      personId: (targetPersonId as Id<"Person">) ?? null,
      categoryId: (parsed.categoryId as Id<"Category">) ?? null,
      categoryGroupId: (parsed.categoryGroupId as Id<"CategoryGroup">) ?? null,
      cadence: parsed.cadence,
      limitCents: parsed.limitCents,
      rollover: parsed.rollover,
      createdAt: now,
      updatedAt: now,
    };

    tx.budgets.insert(created);
    audit({
      entity: "budget",
      entityId: created.id,
      personId: created.personId,
      action: "create",
      before: null,
      after: created,
    });
    return created;
  });
}

/**
 * Updates an existing budget.
 */
export function updateBudget(ctx: UseCaseContext, input: UpdateBudgetInput): BudgetRow {
  const parsed = parseInput(updateBudgetInput, input);
  const id = parsed.id as Id<"Budget">;

  return write(ctx, (tx, audit) => {
    const existing = tx.budgets.findById(ctx.viewer, id);
    if (!existing) {
      throw new AppError("NotFound", "Budget not found");
    }

    const nextCategoryId =
      parsed.categoryId !== undefined
        ? (parsed.categoryId as Id<"Category"> | null)
        : existing.categoryId;
    const nextCategoryGroupId =
      parsed.categoryGroupId !== undefined
        ? (parsed.categoryGroupId as Id<"CategoryGroup"> | null)
        : existing.categoryGroupId;

    if (
      (nextCategoryId != null && nextCategoryGroupId != null) ||
      (nextCategoryId == null && nextCategoryGroupId == null)
    ) {
      throw new AppError(
        "Validation",
        "Budget must target either categoryId or categoryGroupId, but not both",
      );
    }

    if (nextCategoryId && nextCategoryId !== existing.categoryId) {
      const cat = tx.categories.find(ctx.viewer, nextCategoryId);
      if (!cat) throw new AppError("NotFound", "Category not found");
    }
    if (nextCategoryGroupId && nextCategoryGroupId !== existing.categoryGroupId) {
      const grp = tx.categoryGroups.find(ctx.viewer, nextCategoryGroupId);
      if (!grp) throw new AppError("NotFound", "Category group not found");
    }

    const updated: BudgetRow = {
      id: existing.id,
      personId: existing.personId,
      categoryId: nextCategoryId,
      categoryGroupId: nextCategoryGroupId,
      cadence: parsed.cadence ?? existing.cadence,
      limitCents: parsed.limitCents ?? existing.limitCents,
      rollover: parsed.rollover ?? existing.rollover,
      createdAt: existing.createdAt,
      updatedAt: formatInstant(ctx.clock.now()),
    };

    tx.budgets.update(updated);
    audit({
      entity: "budget",
      entityId: updated.id,
      personId: updated.personId,
      action: "update",
      before: existing,
      after: updated,
    });
    return updated;
  });
}

/**
 * Deletes a budget.
 */
export function deleteBudget(ctx: UseCaseContext, input: DeleteBudgetInput): boolean {
  const parsed = parseInput(deleteBudgetInput, input);
  const id = parsed.id as Id<"Budget">;

  return write(ctx, (tx, audit) => {
    const existing = tx.budgets.findById(ctx.viewer, id);
    if (!existing) {
      throw new AppError("NotFound", "Budget not found");
    }

    tx.budgets.delete(id);
    audit({
      entity: "budget",
      entityId: existing.id,
      personId: existing.personId,
      action: "delete",
      before: existing,
      after: null,
    });
    return true;
  });
}

/**
 * Gets a budget by ID for the current viewer.
 */
export function getBudget(ctx: UseCaseContext, input: GetBudgetInput): BudgetRow {
  const parsed = parseInput(getBudgetInput, input);
  const budget = ctx.uow.read((repos) =>
    repos.budgets.findById(ctx.viewer, parsed.id as Id<"Budget">),
  );
  if (!budget) {
    throw new AppError("NotFound", "Budget not found");
  }
  return budget;
}

/**
 * Lists all budgets visible to the current viewer.
 */
export function listBudgets(
  ctx: UseCaseContext,
  _input: Record<string, never> = {},
): readonly BudgetRow[] {
  return ctx.uow.read((repos) => repos.budgets.listVisible(ctx.viewer));
}

/**
 * Gets a budget's summary for the current period, including:
 * spent, remaining, pace, projected, rollover, and status.
 */
export function getBudgetSummary(ctx: UseCaseContext, input: GetBudgetSummaryInput): BudgetSummary {
  const parsed = parseInput(getBudgetSummaryInput, input);
  const budget = ctx.uow.read((repos) =>
    repos.budgets.findById(ctx.viewer, parsed.id as Id<"Budget">),
  );
  if (!budget) {
    throw new AppError("NotFound", "Budget not found");
  }

  const today = ctx.clock.today();
  const calendar = resolveBudgetPayCalendar(ctx, budget);
  const currentPeriod = calendar.periodContaining(today);

  // Spent in current period
  const todayStr = today.toString();
  const spentNum = ctx.uow.read((repos) =>
    repos.budgets.calculateSpent(ctx.viewer, budget, todayStr, {
      start: currentPeriod.start.toString(),
      end: currentPeriod.end.toString(),
    }),
  );
  const spentCents = cents(spentNum);

  // Rollover calculation (if enabled)
  let rolloverCents = 0 as Cents;
  if (budget.rollover) {
    const prevDay = currentPeriod.start.subtract({ days: 1 });
    const prevPeriodRange = calendar.periodContaining(prevDay);
    const prevSpentNum = ctx.uow.read((repos) =>
      repos.budgets.calculateSpent(ctx.viewer, budget, todayStr, {
        start: prevPeriodRange.start.toString(),
        end: prevPeriodRange.end.toString(),
      }),
    );
    rolloverCents = calculateRollover(true, cents(budget.limitCents), cents(prevSpentNum));
  }

  const math = calculateBudgetMath({
    period: currentPeriod,
    today,
    limitCents: cents(budget.limitCents),
    spentCents,
    rolloverCents,
  });

  return {
    budget,
    period: currentPeriod,
    spentCents,
    remainingCents: math.remainingCents,
    paceCents: math.paceCents,
    projectedCents: math.projectedCents,
    rolloverCents,
    effectiveLimitCents: math.effectiveLimitCents,
    status: math.status,
  };
}

/**
 * Gets the suggested limit for a budget based on the mean of the last 6 closed periods.
 * If fewer than 6 closed periods exist or no history exists, returns null.
 */
export function getSuggestedLimit(
  ctx: UseCaseContext,
  input: GetSuggestedLimitInput,
): Cents | null {
  const parsed = parseInput(getSuggestedLimitInput, input);
  const budget = ctx.uow.read((repos) =>
    repos.budgets.findById(ctx.viewer, parsed.id as Id<"Budget">),
  );
  if (!budget) {
    throw new AppError("NotFound", "Budget not found");
  }

  const today = ctx.clock.today();
  const calendar = resolveBudgetPayCalendar(ctx, budget);
  const currentPeriod = calendar.periodContaining(today);

  // Find the last 6 closed periods (immediately preceding the current period)
  const closedPeriods: { readonly start: string; readonly end: string }[] = [];
  let curStart = currentPeriod.start;
  for (let i = 0; i < 6; i++) {
    // A point immediately before curStart belongs to the previous period
    const dayBefore = curStart.subtract({ days: 1 });
    const prev = calendar.periodContaining(dayBefore);
    closedPeriods.unshift({
      start: prev.start.toString(),
      end: prev.end.toString(),
    });
    curStart = prev.start;
  }

  const todayStr = today.toString();

  // If there are no recorded transactions across the ledger in or prior to the 6th period,
  // history does not span 6 closed periods.
  const oldestPeriodEnd = closedPeriods[0]?.end;
  if (!oldestPeriodEnd) {
    return null;
  }
  const hasHistory = ctx.uow.read((repos) => {
    const txns = repos.transactions.listPage(
      ctx.viewer,
      todayStr,
      { to: oldestPeriodEnd },
      { offset: 0 },
      1,
    );
    return txns.length > 0;
  });

  if (!hasHistory) {
    return null;
  }

  const historicalSpents = ctx.uow.read((repos) =>
    repos.budgets.calculateHistoricalSpent(ctx.viewer, budget, todayStr, closedPeriods),
  );

  // If any period could not be resolved or fewer than 6 returned:
  if (historicalSpents.length < 6) {
    return null;
  }

  return calculateLimitSuggestion(historicalSpents.map((p) => cents(p.spentCents)));
}
