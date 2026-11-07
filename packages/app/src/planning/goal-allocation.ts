// Domain calculators and use cases for goal allocation (CAP-6, AD-13, AD-22).
import { allocate, type Cents, cents, type Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { AppError, parseInput } from "../errors.ts";
import type {
  AllocationStageRow,
  GoalAllocationRow,
  GoalRow,
  GoalRuleRow,
} from "../ports/unit-of-work.ts";
import { type UseCaseContext, write } from "../write.ts";

export interface GoalBalance {
  readonly goalId: Id<"Goal">;
  readonly allocatedCents: number;
  readonly adjustedCents: number;
  readonly currentBalance: number;
}

export interface RescaledRule {
  readonly goalId: Id<"Goal">;
  readonly originalShareBp: number;
  readonly rescaledShareBp: number;
}

export interface StageAllocationResult {
  readonly allocations: readonly {
    readonly goalId: Id<"Goal">;
    readonly amountCents: number;
  }[];
  readonly remainderSavingsCents: number;
  readonly stageTransitions: readonly {
    readonly fromStageId: Id<"AllocationStage">;
    readonly toStageId: Id<"AllocationStage"> | null;
    readonly exitGoalId: Id<"Goal">;
    readonly reason: "exit-goal-completed";
  }[];
}

export interface SavingsAllocationExecutionResult {
  readonly periodStart: string;
  readonly totalSavingsCents: number;
  readonly totalAllocatedCents: number;
  readonly bufferCents: number;
  readonly allocations: readonly GoalAllocationRow[];
  readonly activeStage: AllocationStageRow | null;
  readonly stageTransitions: readonly {
    readonly fromStageId: Id<"AllocationStage">;
    readonly toStageId: Id<"AllocationStage"> | null;
    readonly exitGoalId: Id<"Goal">;
    readonly reason: "exit-goal-completed";
  }[];
}

/**
 * Calculates current balances for goals in a pool:
 * cumulative goal_allocation rows minus adjustments from confirmed drawdowns.
 */
export function calculateGoalBalances(
  allocations: readonly GoalAllocationRow[],
  adjustments: readonly { readonly goalId: Id<"Goal">; readonly amountCents: number }[] = [],
): Map<Id<"Goal">, GoalBalance> {
  const result = new Map<Id<"Goal">, GoalBalance>();

  for (const alloc of allocations) {
    const existing = result.get(alloc.goalId);
    if (existing) {
      const allocatedCents = existing.allocatedCents + alloc.allocatedCents;
      const currentBalance = allocatedCents - existing.adjustedCents;
      result.set(alloc.goalId, {
        goalId: alloc.goalId,
        allocatedCents,
        adjustedCents: existing.adjustedCents,
        currentBalance,
      });
    } else {
      result.set(alloc.goalId, {
        goalId: alloc.goalId,
        allocatedCents: alloc.allocatedCents,
        adjustedCents: 0,
        currentBalance: alloc.allocatedCents,
      });
    }
  }

  for (const adj of adjustments) {
    const existing = result.get(adj.goalId);
    if (existing) {
      const adjustedCents = existing.adjustedCents + adj.amountCents;
      const currentBalance = existing.allocatedCents - adjustedCents;
      result.set(adj.goalId, {
        goalId: adj.goalId,
        allocatedCents: existing.allocatedCents,
        adjustedCents,
        currentBalance,
      });
    } else {
      result.set(adj.goalId, {
        goalId: adj.goalId,
        allocatedCents: 0,
        adjustedCents: adj.amountCents,
        currentBalance: -adj.amountCents,
      });
    }
  }

  return result;
}

/**
 * Determine active stage for a pool:
 * 1. Stages sorted by sort ASC.
 * 2. If emergency fund balance < (targetCents * fallbackThresholdBp) / 10000, fall back to Stage 1 (lowest sort stage).
 * 3. Otherwise, advance past stages whose exitGoalId is fully funded (currentBalance >= targetCents).
 * 4. Active stage is the first incomplete stage, or the highest sort stage if all complete.
 */
export function resolveActiveStage(
  stages: readonly AllocationStageRow[],
  goals: readonly GoalRow[],
  balances: Map<Id<"Goal">, GoalBalance>,
): { readonly activeStage: AllocationStageRow | null; readonly isFallback: boolean } {
  if (stages.length === 0) {
    return { activeStage: null, isFallback: false };
  }

  const sortedStages = [...stages].sort((a, b) => a.sort - b.sort);
  const emergencyFund = goals.find((g) => g.isEmergencyFund);

  // If emergency fund exists and its current balance < fallback threshold:
  if (emergencyFund) {
    const efBalance = balances.get(emergencyFund.id)?.currentBalance ?? 0;
    const efAllocated = balances.get(emergencyFund.id)?.allocatedCents ?? 0;
    // Stage 1 defines the fallback threshold or default 8000 bp (80%)
    const stage1ThresholdBp = sortedStages[0]?.fallbackThresholdBp ?? 8000;
    const fallbackThresholdCents = Math.floor(
      (emergencyFund.targetCents * stage1ThresholdBp) / 10000,
    );

    // Fallback applies specifically to revert Stage 2+ -> Stage 1 when an emergency fund
    // that had reached target drops below its fallback threshold (e.g. 80%).
    if (efAllocated >= emergencyFund.targetCents && efBalance < fallbackThresholdCents) {
      const stage1 = sortedStages[0] ?? null;
      return { activeStage: stage1, isFallback: true };
    }
  }

  // Iterate through stages:
  // A stage ends when its exit goal is fully funded (currentBalance >= targetCents).
  // An exit goal only completes when currentBalance >= targetCents.
  // However, for an emergency fund exit goal after completion, it remains completed as long as
  // currentBalance >= fallbackThreshold (preventing flip-flops unless it drops below 80%).
  for (const stage of sortedStages) {
    if (!stage.exitGoalId) {
      return { activeStage: stage, isFallback: false };
    }
    const exitGoal = goals.find((g) => g.id === stage.exitGoalId);
    if (!exitGoal) {
      return { activeStage: stage, isFallback: false };
    }
    const currentBalance = balances.get(exitGoal.id)?.currentBalance ?? 0;

    let isCompleted = currentBalance >= exitGoal.targetCents;
    if (exitGoal.isEmergencyFund) {
      const allocatedCents = balances.get(exitGoal.id)?.allocatedCents ?? 0;
      const fallbackThresholdBp = stage.fallbackThresholdBp ?? 8000;
      const fallbackThresholdCents = Math.floor(
        (exitGoal.targetCents * fallbackThresholdBp) / 10000,
      );
      // EF exit condition remains satisfied if historical funding reached target AND
      // current balance is still above or equal to the fallback threshold (>= 80%).
      // If currentBalance < exitGoal.targetCents and allocatedCents was never >= targetCents,
      // it is NOT completed.
      if (allocatedCents >= exitGoal.targetCents && currentBalance >= fallbackThresholdCents) {
        isCompleted = true;
      }
    }

    if (!isCompleted) {
      return { activeStage: stage, isFallback: false };
    }
  }

  return { activeStage: sortedStages[sortedStages.length - 1] ?? null, isFallback: false };
}

/**
 * Rescales goal rules within a stage when some goals have completed (currentBalance >= targetCents).
 * If completedSharePolicy === "rescale", the completed goals' shareBp is proportionally redistributed
 * across the remaining uncompleted goals.
 * If completedSharePolicy === "buffer", completed goals get 0 and remainder is not distributed to other goals.
 */
export function rescaleGoalRules(
  rules: readonly GoalRuleRow[],
  goals: readonly GoalRow[],
  balances: Map<Id<"Goal">, GoalBalance>,
  policy: "rescale" | "buffer",
): RescaledRule[] {
  const goalMap = new Map<Id<"Goal">, GoalRow>(goals.map((g) => [g.id, g]));

  const completedGoalIds = new Set<Id<"Goal">>();
  for (const rule of rules) {
    const goalObj = goalMap.get(rule.goalId);
    if (goalObj) {
      const balance = balances.get(rule.goalId)?.currentBalance ?? 0;
      if (balance >= goalObj.targetCents) {
        completedGoalIds.add(rule.goalId);
      }
    }
  }

  const uncompletedRules = rules.filter((r) => !completedGoalIds.has(r.goalId));

  if (uncompletedRules.length === 0) {
    return rules.map((r) => ({
      goalId: r.goalId,
      originalShareBp: r.shareBp,
      rescaledShareBp: 0,
    }));
  }

  if (completedGoalIds.size === 0 || policy === "buffer") {
    return rules.map((r) => ({
      goalId: r.goalId,
      originalShareBp: r.shareBp,
      rescaledShareBp: completedGoalIds.has(r.goalId) ? 0 : r.shareBp,
    }));
  }

  // Rescale policy: redistribute sum of all rule shares proportionally across uncompleted goals
  const totalOriginalShareBp = rules.reduce((acc, r) => acc + r.shareBp, 0);
  const uncompletedOriginalSum = uncompletedRules.reduce((acc, r) => acc + r.shareBp, 0);

  if (uncompletedOriginalSum === 0) {
    return rules.map((r) => ({
      goalId: r.goalId,
      originalShareBp: r.shareBp,
      rescaledShareBp: 0,
    }));
  }

  // Use integer proportional allocation across uncompleted goals
  // Allocate totalOriginalShareBp using uncompletedRules' shareBp as weights
  const allocatedShares = allocate(
    cents(totalOriginalShareBp),
    uncompletedRules.map((r) => r.shareBp),
  );

  const rescaledMap = new Map<Id<"Goal">, number>();
  for (let i = 0; i < uncompletedRules.length; i++) {
    const rule = uncompletedRules[i];
    if (rule) {
      rescaledMap.set(rule.goalId, allocatedShares[i] ?? 0);
    }
  }

  return rules.map((r) => ({
    goalId: r.goalId,
    originalShareBp: r.shareBp,
    rescaledShareBp: rescaledMap.get(r.goalId) ?? 0,
  }));
}

/**
 * Allocates period positive savings across goals with stage exit cascade:
 * If an exit goal would receive more than it needs to reach targetCents, it takes only what it needs,
 * other goals in that stage receive their proportional allocation, and remaining period savings cascade
 * into the next stage.
 */
export function allocatePeriodSavings(
  savingsCents: number,
  stages: readonly AllocationStageRow[],
  rulesByStage: Map<Id<"AllocationStage">, readonly GoalRuleRow[]>,
  goals: readonly GoalRow[],
  initialBalances: Map<Id<"Goal">, GoalBalance>,
): StageAllocationResult {
  if (savingsCents <= 0) {
    return {
      allocations: [],
      remainderSavingsCents: Math.max(0, savingsCents),
      stageTransitions: [],
    };
  }

  const goalMap = new Map<Id<"Goal">, GoalRow>(goals.map((g) => [g.id, g]));
  const currentBalances = new Map<Id<"Goal">, GoalBalance>();
  for (const [id, bal] of initialBalances.entries()) {
    currentBalances.set(id, { ...bal });
  }

  const sortedStages = [...stages].sort((a, b) => a.sort - b.sort);
  const stageTransitions: {
    readonly fromStageId: Id<"AllocationStage">;
    readonly toStageId: Id<"AllocationStage"> | null;
    readonly exitGoalId: Id<"Goal">;
    readonly reason: "exit-goal-completed";
  }[] = [];

  const cumulativeAllocations = new Map<Id<"Goal">, number>();
  let remainingSavings = savingsCents;

  // Resolve starting active stage
  const activeResolution = resolveActiveStage(sortedStages, goals, currentBalances);
  let activeStage = activeResolution.activeStage;

  while (remainingSavings > 0 && activeStage) {
    const stageRules = rulesByStage.get(activeStage.id) ?? [];
    if (stageRules.length === 0) {
      break;
    }

    const rescaled = rescaleGoalRules(
      stageRules,
      goals,
      currentBalances,
      activeStage.completedSharePolicy,
    );

    // Active uncompleted rules
    const activeRules = rescaled.filter((r) => r.rescaledShareBp > 0);
    if (activeRules.length === 0) {
      break;
    }

    const exitGoalId = activeStage.exitGoalId;
    const exitRule = exitGoalId ? activeRules.find((r) => r.goalId === exitGoalId) : undefined;
    const exitGoal = exitGoalId ? goalMap.get(exitGoalId) : undefined;

    let periodSpendOnStage = remainingSavings;

    if (exitRule && exitGoal) {
      const exitGoalCurrentBal = currentBalances.get(exitGoal.id)?.currentBalance ?? 0;
      const capacity = Math.max(0, exitGoal.targetCents - exitGoalCurrentBal);

      // What exit goal would receive if we allocate remainingSavings:
      // exitRule.rescaledShareBp / 10000 of savings
      // Note: integer division with AD-13 largest remainder method
      // We check if (remainingSavings * exitRule.rescaledShareBp) / 10000 >= capacity
      const estimatedExitAlloc = Math.floor((remainingSavings * exitRule.rescaledShareBp) / 10000);

      if (capacity <= 0) {
        // Exit goal already complete! Transition to next stage
        const currentIndex = sortedStages.findIndex((s) => s.id === activeStage?.id);
        const nextStage = currentIndex >= 0 ? (sortedStages[currentIndex + 1] ?? null) : null;
        stageTransitions.push({
          fromStageId: activeStage.id,
          toStageId: nextStage?.id ?? null,
          exitGoalId: exitGoal.id,
          reason: "exit-goal-completed",
        });
        activeStage = nextStage;
        continue;
      }

      if (estimatedExitAlloc >= capacity) {
        // Calculate exact savings amount that gives exitGoal exactly `capacity`
        // Since exitGoal gets (stageSpend * exitRule.rescaledShareBp / 10000),
        // stageSpend = ceil(capacity * 10000 / exitRule.rescaledShareBp)
        const neededSavings = Math.ceil((capacity * 10000) / exitRule.rescaledShareBp);
        periodSpendOnStage = Math.min(remainingSavings, neededSavings);
      }
    }

    // Allocate periodSpendOnStage according to activeRules weights
    // If the sum of rescaledShareBp < 10000 (e.g. buffer share policy or partial rule sum),
    // only allocate the active rules' share of periodSpendOnStage, leaving remainder for buffer.
    const weights = activeRules.map((r) => r.rescaledShareBp);
    const totalWeights = weights.reduce((acc, w) => acc + w, 0);

    const amountToDistribute = Math.floor((periodSpendOnStage * totalWeights) / 10000);

    if (amountToDistribute <= 0 || totalWeights <= 0) {
      break;
    }

    const allocatedParts = allocate(cents(amountToDistribute), weights);
    let actuallyDistributed = 0;

    for (let i = 0; i < activeRules.length; i++) {
      const rule = activeRules[i];
      const allocatedAmount = allocatedParts[i] ?? (0 as Cents);
      if (rule && allocatedAmount > 0) {
        actuallyDistributed += allocatedAmount;
        const prevAlloc = cumulativeAllocations.get(rule.goalId) ?? 0;
        cumulativeAllocations.set(rule.goalId, prevAlloc + allocatedAmount);

        // Update current balances tracking
        const prevBal = currentBalances.get(rule.goalId) ?? {
          goalId: rule.goalId,
          allocatedCents: 0,
          adjustedCents: 0,
          currentBalance: 0,
        };
        currentBalances.set(rule.goalId, {
          goalId: rule.goalId,
          allocatedCents: prevBal.allocatedCents + allocatedAmount,
          adjustedCents: prevBal.adjustedCents,
          currentBalance: prevBal.currentBalance + allocatedAmount,
        });
      }
    }

    remainingSavings -= actuallyDistributed;

    // Check if exit goal just completed
    if (exitGoal) {
      const updatedBal = currentBalances.get(exitGoal.id)?.currentBalance ?? 0;
      if (updatedBal >= exitGoal.targetCents) {
        const currentIndex = sortedStages.findIndex((s) => s.id === activeStage?.id);
        const nextStage = currentIndex >= 0 ? (sortedStages[currentIndex + 1] ?? null) : null;
        stageTransitions.push({
          fromStageId: activeStage.id,
          toStageId: nextStage?.id ?? null,
          exitGoalId: exitGoal.id,
          reason: "exit-goal-completed",
        });
        activeStage = nextStage;
      }
    } else {
      break;
    }
  }

  const finalAllocations = Array.from(cumulativeAllocations.entries()).map(
    ([goalId, amountCents]) => ({
      goalId,
      amountCents,
    }),
  );

  return {
    allocations: finalAllocations,
    remainderSavingsCents: remainingSavings,
    stageTransitions,
  };
}

export const executeSavingsAllocationInput = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  savingsCents: z.number().int(),
  pool: z.string().nullable().optional(), // null or "shared" for shared pool; personId for personal
});

export type ExecuteSavingsAllocationInput = z.infer<typeof executeSavingsAllocationInput>;

/**
 * Use case: executes savings allocation for a pool at period close.
 * Calculates active stage, cascades exit goals, rescales on completion, inserts goal_allocation rows,
 * and writes audit logs for allocations and stage transitions (action: "stage-change").
 */
export function executeSavingsAllocation(
  ctx: UseCaseContext,
  rawInput: ExecuteSavingsAllocationInput,
): SavingsAllocationExecutionResult {
  const input = parseInput(executeSavingsAllocationInput, rawInput);
  const pool = input.pool ?? (ctx.viewer.kind === "person" ? null : null);
  const targetPersonId = pool === "shared" || pool === null ? null : (pool as Id<"Person">);

  if (
    targetPersonId !== null &&
    ctx.viewer.kind === "person" &&
    ctx.viewer.personId !== targetPersonId
  ) {
    throw new AppError("NotFound", "Pool not found");
  }

  if (input.savingsCents <= 0) {
    return {
      periodStart: input.periodStart,
      totalSavingsCents: input.savingsCents,
      totalAllocatedCents: 0,
      bufferCents: input.savingsCents,
      allocations: [],
      activeStage: null,
      stageTransitions: [],
    };
  }

  return write(ctx, (tx, audit) => {
    // 1. Fetch pool goals
    const allGoals = tx.goals.listVisible(ctx.viewer);
    const poolGoals = allGoals.filter((g) => g.personId === targetPersonId);

    // 2. Fetch pool stages
    const allStages = tx.stages.listVisible(ctx.viewer);
    const poolStages = allStages.filter((s) => s.personId === targetPersonId);

    // 3. Fetch rules by stage (only standard rules apply to goal allocations)
    const rulesByStage = new Map<Id<"AllocationStage">, GoalRuleRow[]>();
    for (const stage of poolStages) {
      const stageRules = tx.goalRules
        .listForStage(ctx.viewer, stage.id)
        .filter((r) => r.source === "rule");
      rulesByStage.set(stage.id, stageRules);
    }

    // 4. Compute current balances from historical allocations and adjustments
    const historicalAllocations: GoalAllocationRow[] = [];
    const historicalAdjustments: { readonly goalId: Id<"Goal">; readonly amountCents: number }[] = [];
    for (const goal of poolGoals) {
      const allocs = tx.goalAllocations.listForGoal(ctx.viewer, goal.id);
      historicalAllocations.push(...allocs);
      const adjs = tx.goalAdjustments.listActiveForGoal(ctx.viewer, goal.id);
      historicalAdjustments.push(...adjs);
    }

    const initialBalances = calculateGoalBalances(historicalAllocations, historicalAdjustments);

    // 5. Run allocation engine
    const allocationResult = allocatePeriodSavings(
      input.savingsCents,
      poolStages,
      rulesByStage,
      poolGoals,
      initialBalances,
    );

    // 6. Insert goal_allocation rows
    const now = formatInstant(ctx.clock.now());
    const insertedAllocations: GoalAllocationRow[] = [];

    for (const alloc of allocationResult.allocations) {
      if (alloc.amountCents > 0) {
        const row: GoalAllocationRow = {
          id: ctx.newId<"GoalAllocation">(),
          goalId: alloc.goalId,
          periodStart: input.periodStart,
          allocatedCents: alloc.amountCents,
          createdAt: now,
        };
        tx.goalAllocations.insert(row);
        insertedAllocations.push(row);

        audit({
          entity: "goal_allocation",
          entityId: row.id,
          ...(targetPersonId ? { personId: targetPersonId } : {}),
          action: "create",
          before: null,
          after: row,
        });
      }
    }

    // 7. Audit stage transitions
    for (const transition of allocationResult.stageTransitions) {
      audit({
        entity: "allocation_stage",
        entityId: transition.fromStageId,
        ...(targetPersonId ? { personId: targetPersonId } : {}),
        action: "stage-change",
        before: { activeStageId: transition.fromStageId },
        after: {
          activeStageId: transition.toStageId,
          exitGoalId: transition.exitGoalId,
          reason: transition.reason,
        },
      });
    }

    const totalAllocatedCents = insertedAllocations.reduce((sum, a) => sum + a.allocatedCents, 0);
    const bufferCents = input.savingsCents - totalAllocatedCents;

    // Active stage after allocation
    const finalBalances = calculateGoalBalances(
      [...historicalAllocations, ...insertedAllocations],
      historicalAdjustments,
    );
    const finalActiveStageRes = resolveActiveStage(poolStages, poolGoals, finalBalances);

    return {
      periodStart: input.periodStart,
      totalSavingsCents: input.savingsCents,
      totalAllocatedCents,
      bufferCents,
      allocations: insertedAllocations,
      activeStage: finalActiveStageRes.activeStage,
      stageTransitions: allocationResult.stageTransitions,
    };
  });
}
