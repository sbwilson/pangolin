import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { AppError, parseInput } from "../errors.ts";
import type {
  GoalAdjustmentRow,
  GoalDrawdownReason,
  GoalDrawdownRow,
  GoalRow,
} from "../ports/unit-of-work.ts";
import { type UseCaseContext, write } from "../write.ts";

export interface GoalProposalSplit {
  readonly goalId: Id<"Goal">;
  readonly goalName: string;
  readonly kind: "flexible" | "protected";
  readonly isEmergencyFund: boolean;
  readonly currentBalanceCents: number;
  readonly proposedAmountCents: number;
}

export interface ProposeDrawdownResult {
  readonly pool: "shared" | string;
  readonly reason: GoalDrawdownReason;
  readonly amountCents: number;
  readonly coveredCents: number;
  readonly remainingCents: number;
  readonly unlockedProtected: boolean;
  readonly warnings: readonly string[];
  readonly proposals: readonly GoalProposalSplit[];
}

export interface PureProposalInput {
  readonly reason: GoalDrawdownReason;
  readonly amountCents: number;
  readonly goals: readonly GoalRow[];
  readonly balances: ReadonlyMap<Id<"Goal">, number>;
}

/**
 * Pure calculation proposing how a drawdown should be split across a pool's goals.
 *
 * Ordering:
 * - large_purchase: Emergency Fund -> Flexible -> Protected
 * - shortfall: Flexible -> Emergency Fund -> Protected
 *
 * Rules:
 * - Emergency fund is capped at its balance, up to needed amount.
 * - Flexible goals split proportionally to positive balance, remainder cents to largest balance goal.
 * - Protected goals unlock only if remaining amount > 0 after prior tiers are exhausted.
 * - If Protected goals are debited, unlockedProtected is true and warnings list affected goals.
 */
export function proposeDrawdownSplit(input: PureProposalInput): {
  readonly coveredCents: number;
  readonly remainingCents: number;
  readonly unlockedProtected: boolean;
  readonly warnings: readonly string[];
  readonly proposals: readonly GoalProposalSplit[];
} {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new AppError("Validation", "Drawdown amount must be a positive integer in cents");
  }

  const efGoals = input.goals.filter((g) => g.isEmergencyFund);
  const flexGoals = input.goals.filter((g) => !g.isEmergencyFund && g.kind === "flexible");
  const protectedGoals = input.goals.filter((g) => !g.isEmergencyFund && g.kind === "protected");

  const proposedByGoal = new Map<Id<"Goal">, number>();
  for (const g of input.goals) {
    proposedByGoal.set(g.id, 0);
  }

  let remaining = input.amountCents;

  const coverEF = () => {
    for (const ef of efGoals) {
      if (remaining <= 0) break;
      const bal = Math.max(0, input.balances.get(ef.id) ?? 0);
      const debit = Math.min(bal, remaining);
      if (debit > 0) {
        proposedByGoal.set(ef.id, (proposedByGoal.get(ef.id) ?? 0) + debit);
        remaining -= debit;
      }
    }
  };

  const coverFlexible = () => {
    if (remaining <= 0) return;
    const eligibleFlex = flexGoals.filter((g) => (input.balances.get(g.id) ?? 0) > 0);
    const totalFlexBal = eligibleFlex.reduce((sum, g) => sum + (input.balances.get(g.id) ?? 0), 0);
    if (totalFlexBal <= 0) return;

    const neededFromFlex = Math.min(totalFlexBal, remaining);
    if (neededFromFlex <= 0) return;

    if (neededFromFlex === totalFlexBal) {
      for (const g of eligibleFlex) {
        const bal = input.balances.get(g.id) ?? 0;
        proposedByGoal.set(g.id, (proposedByGoal.get(g.id) ?? 0) + bal);
      }
      remaining -= neededFromFlex;
    } else {
      // Proportional split: exact integer cents with remainder cents assigned to the largest balance goal
      const withBal = eligibleFlex.map((g) => ({
        goal: g,
        balance: input.balances.get(g.id) ?? 0,
      }));
      // Exact integer floor allocation: Math.floor(neededFromFlex * bal / totalFlexBal)
      const splits = withBal.map(({ goal, balance }) => {
        const exact = Math.floor((neededFromFlex * balance) / totalFlexBal);
        return { goal, balance, amount: exact };
      });
      const assigned = splits.reduce((sum, s) => sum + s.amount, 0);
      let remainder = neededFromFlex - assigned;
      // Remainder cents allocated to largest balance goal (sorted by balance desc, then goal id for stability)
      const order = [...splits].sort(
        (a, b) => b.balance - a.balance || a.goal.id.localeCompare(b.goal.id),
      );
      for (const item of order) {
        if (remainder <= 0) break;
        item.amount += 1;
        remainder--;
      }
      for (const item of splits) {
        proposedByGoal.set(item.goal.id, (proposedByGoal.get(item.goal.id) ?? 0) + item.amount);
      }
      remaining -= neededFromFlex;
    }
  };

  const coverProtected = () => {
    if (remaining <= 0) return;
    for (const pg of protectedGoals) {
      if (remaining <= 0) break;
      const bal = Math.max(0, input.balances.get(pg.id) ?? 0);
      const debit = Math.min(bal, remaining);
      if (debit > 0) {
        proposedByGoal.set(pg.id, (proposedByGoal.get(pg.id) ?? 0) + debit);
        remaining -= debit;
      }
    }
  };

  if (input.reason === "large_purchase") {
    coverEF();
    coverFlexible();
    coverProtected();
  } else {
    // shortfall
    coverFlexible();
    coverEF();
    coverProtected();
  }

  const warnings: string[] = [];
  let unlockedProtected = false;

  for (const pg of protectedGoals) {
    const debited = proposedByGoal.get(pg.id) ?? 0;
    if (debited > 0) {
      unlockedProtected = true;
      warnings.push(`Protected goal "${pg.name}" unlocked to cover ${debited} cents`);
    }
  }

  const coveredCents = input.amountCents - remaining;

  const proposals: GoalProposalSplit[] = input.goals.map((g) => ({
    goalId: g.id,
    goalName: g.name,
    kind: g.kind,
    isEmergencyFund: g.isEmergencyFund,
    currentBalanceCents: input.balances.get(g.id) ?? 0,
    proposedAmountCents: proposedByGoal.get(g.id) ?? 0,
  }));

  return {
    coveredCents,
    remainingCents: remaining,
    unlockedProtected,
    warnings,
    proposals,
  };
}

export const proposeDrawdownInput = z.object({
  pool: z.string().min(1).default("shared"),
  reason: z.enum(["large_purchase", "shortfall"]),
  amountCents: z.number().int().positive(),
});

export type ProposeDrawdownInput = z.infer<typeof proposeDrawdownInput>;

export function proposeDrawdown(
  ctx: UseCaseContext,
  rawInput: ProposeDrawdownInput,
): ProposeDrawdownResult {
  const input = parseInput(proposeDrawdownInput, rawInput);
  const targetPersonId = input.pool === "shared" ? null : input.pool;

  if (
    ctx.viewer.kind === "person" &&
    targetPersonId !== null &&
    targetPersonId !== ctx.viewer.personId
  ) {
    throw new AppError("NotFound", "Pool not found");
  }

  const poolGoals = ctx.uow.read((r) =>
    r.goals.listVisible(ctx.viewer).filter((g) => g.personId === targetPersonId),
  );

  const balances = new Map<Id<"Goal">, number>();
  for (const g of poolGoals) {
    const allocTotal = ctx.uow.read((r) => r.goalAllocations.sumForGoal(ctx.viewer, g.id));
    const adjTotal = ctx.uow.read((r) => r.goalAdjustments.sumActiveForGoal(ctx.viewer, g.id));
    balances.set(g.id, Math.max(0, allocTotal - adjTotal));
  }

  const split = proposeDrawdownSplit({
    reason: input.reason,
    amountCents: input.amountCents,
    goals: poolGoals,
    balances,
  });

  return {
    pool: input.pool,
    reason: input.reason,
    amountCents: input.amountCents,
    ...split,
  };
}

export const executeDrawdownInput = z.object({
  pool: z.string().min(1).default("shared"),
  reason: z.enum(["large_purchase", "shortfall"]),
  label: z.string().min(1),
  amountCents: z.number().int().positive(),
  transactionId: z.string().nullable().optional(),
  adjustments: z
    .array(
      z.object({
        goalId: z.string().min(1),
        amountCents: z.number().int().positive(),
      }),
    )
    .min(1),
});

export type ExecuteDrawdownInput = z.infer<typeof executeDrawdownInput>;

export interface ExecuteDrawdownResult {
  readonly drawdown: GoalDrawdownRow;
  readonly adjustments: readonly GoalAdjustmentRow[];
}

export function executeDrawdown(
  ctx: UseCaseContext,
  rawInput: ExecuteDrawdownInput,
): ExecuteDrawdownResult {
  const input = parseInput(executeDrawdownInput, rawInput);
  const targetPersonId = input.pool === "shared" ? null : (input.pool as Id<"Person">);

  if (
    ctx.viewer.kind === "person" &&
    targetPersonId !== null &&
    targetPersonId !== ctx.viewer.personId
  ) {
    throw new AppError("NotFound", "Pool not found");
  }

  const creatorId =
    ctx.viewer.kind === "person"
      ? (ctx.viewer.personId as Id<"Person">)
      : (targetPersonId ?? ctx.uow.read((r) => r.person.listActive()[0]?.id));

  if (!creatorId) {
    throw new AppError("Validation", "No active person found to attribute drawdown");
  }

  return write(ctx, (tx, audit) => {
    // Verify goals belong to the pool and check balances
    const allVisible = tx.goals.listVisible(ctx.viewer);
    const poolGoalsMap = new Map<string, GoalRow>();
    for (const g of allVisible) {
      if (g.personId === targetPersonId) {
        poolGoalsMap.set(g.id, g);
      }
    }

    let totalAdjustmentCents = 0;
    for (const adj of input.adjustments) {
      const g = poolGoalsMap.get(adj.goalId);
      if (!g) {
        throw new AppError(
          "Validation",
          `Goal ${adj.goalId} does not belong to pool ${input.pool}`,
        );
      }
      const allocTotal = tx.goalAllocations.sumForGoal(ctx.viewer, g.id);
      const adjTotal = tx.goalAdjustments.sumActiveForGoal(ctx.viewer, g.id);
      const currentBalance = allocTotal - adjTotal;
      if (adj.amountCents > currentBalance) {
        throw new AppError(
          "Validation",
          `Adjustment of ${adj.amountCents} exceeds available balance ${currentBalance} for goal "${g.name}"`,
        );
      }
      totalAdjustmentCents += adj.amountCents;
    }

    if (totalAdjustmentCents > input.amountCents) {
      throw new AppError(
        "Validation",
        `Total adjustments (${totalAdjustmentCents}) exceed drawdown amount (${input.amountCents})`,
      );
    }

    const now = formatInstant(ctx.clock.now());
    const drawdownId = ctx.newId<"GoalDrawdown">();

    const drawdownRow: GoalDrawdownRow = {
      id: drawdownId,
      personId: targetPersonId,
      reason: input.reason,
      label: input.label,
      amountCents: input.amountCents,
      transactionId: (input.transactionId as Id<"Transaction"> | null) ?? null,
      createdBy: creatorId,
      createdAt: now,
      undoneAt: null,
    };

    tx.goalDrawdowns.insert(drawdownRow);

    const adjustmentRows: GoalAdjustmentRow[] = input.adjustments.map((adj) => ({
      id: ctx.newId<"GoalAdjustment">(),
      drawdownId,
      goalId: adj.goalId as Id<"Goal">,
      amountCents: adj.amountCents,
    }));

    tx.goalAdjustments.insertMany(adjustmentRows);

    audit({
      entity: "goal_drawdown",
      entityId: drawdownId,
      ...(targetPersonId ? { personId: targetPersonId } : {}),
      action: "drawdown",
      before: null,
      after: {
        drawdown: drawdownRow,
        adjustments: adjustmentRows,
      },
    });

    return {
      drawdown: drawdownRow,
      adjustments: adjustmentRows,
    };
  });
}

export const undoDrawdownInput = z.object({
  drawdownId: z.string().min(1),
});

export type UndoDrawdownInput = z.infer<typeof undoDrawdownInput>;

export function undoDrawdown(
  ctx: UseCaseContext,
  rawInput: UndoDrawdownInput,
): { readonly drawdown: GoalDrawdownRow } {
  const input = parseInput(undoDrawdownInput, rawInput);
  const drawdownId = input.drawdownId as Id<"GoalDrawdown">;

  return write(ctx, (tx, audit) => {
    const existing = tx.goalDrawdowns.findById(ctx.viewer, drawdownId);
    if (!existing) {
      throw new AppError("NotFound", "Drawdown not found");
    }

    if (existing.undoneAt !== null) {
      throw new AppError("Validation", "Drawdown already undone");
    }

    const now = formatInstant(ctx.clock.now());
    const updated = tx.goalDrawdowns.markUndone(drawdownId, now);
    if (!updated) {
      throw new AppError("Validation", "Failed to undo drawdown");
    }

    const updatedRow: GoalDrawdownRow = {
      ...existing,
      undoneAt: now,
    };

    audit({
      entity: "goal_drawdown",
      entityId: drawdownId,
      ...(existing.personId ? { personId: existing.personId } : {}),
      action: "drawdown-undo",
      before: existing,
      after: updatedRow,
    });

    return { drawdown: updatedRow };
  });
}

export const listDrawdownsInput = z.object({
  pool: z.string().min(1).default("shared"),
});

export type ListDrawdownsInput = z.infer<typeof listDrawdownsInput>;

export interface DrawdownView extends GoalDrawdownRow {
  readonly adjustments: readonly GoalAdjustmentRow[];
}

export function listDrawdowns(
  ctx: UseCaseContext,
  rawInput: ListDrawdownsInput,
): readonly DrawdownView[] {
  const input = parseInput(listDrawdownsInput, rawInput);
  const targetPersonId = input.pool === "shared" ? null : input.pool;

  if (
    ctx.viewer.kind === "person" &&
    targetPersonId !== null &&
    targetPersonId !== ctx.viewer.personId
  ) {
    throw new AppError("NotFound", "Pool not found");
  }

  const drawdowns = ctx.uow.read((r) => r.goalDrawdowns.listForPool(ctx.viewer, input.pool));
  return drawdowns.map((d) => {
    const adjustments = ctx.uow.read((r) => r.goalAdjustments.listForDrawdown(ctx.viewer, d.id));
    return {
      ...d,
      adjustments,
    };
  });
}
