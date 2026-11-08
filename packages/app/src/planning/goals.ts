import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { poolOf } from "../accounts/pool.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import type {
  AllocationStageRow,
  GoalKind,
  GoalRow,
  GoalRuleRow,
  PlanningSettingRow,
  TxRepos,
} from "../ports/unit-of-work.ts";
import { type UseCaseContext, write } from "../write.ts";
import { resolveActiveStage } from "./goal-allocation.ts";
import { type GoalProjection, projectGoalCompletion } from "./goal-projection.ts";

export interface SavingsPoolBalance {
  readonly pool: "shared" | string; // "shared" or personId
  readonly totalCents: number;
  readonly accounts: readonly {
    readonly id: string;
    readonly name: string;
    readonly balanceCents: number;
    readonly isPrivate: boolean;
  }[];
}

export interface SavingsPoolBalancesResult {
  readonly asOf: string;
  readonly pools: readonly SavingsPoolBalance[];
}

export interface GoalView extends GoalRow {
  readonly pool: "shared" | string;
  readonly currentBalance: number;
  /** Completion projection from recent allocation cadence; null when nothing to project. */
  readonly projection: GoalProjection | null;
}

export interface GoalsSummaryResult {
  readonly asOf: string;
  readonly goals: readonly GoalView[];
  readonly stages: readonly AllocationStageRow[];
  readonly activeStage: AllocationStageRow | null;
  /** When the active stage's exit goal is projected to arrive; null with no projection. */
  readonly nextStageChangeDate: string | null;
  readonly rules: readonly GoalRuleRow[];
  readonly pools: readonly SavingsPoolBalance[];
  readonly poolBalances: readonly SavingsPoolBalance[];
  readonly settings: readonly PlanningSettingRow[];
}

/**
 * Derives total savings-account balances for the shared pool and each person's pool using balanceAsOf.
 * Privacy scoping (AD-3, AD-22): only accounts visible to viewer are returned!
 * A partner's private accounts are never visible to the other partner.
 */
export function getSavingsPoolBalances(
  ctx: UseCaseContext,
  input: { readonly asOf?: string | undefined } = {},
): SavingsPoolBalancesResult {
  const asOf = input.asOf ?? ctx.clock.today().toString();
  const visibleAccounts = ctx.uow.read((r) => r.accounts.list(ctx.viewer));

  // Only savings-flagged accounts count (AD-19, AD-26)
  const savingsAccounts = visibleAccounts.filter(
    (a) => a.isSavings && (a.closedOn === null || a.closedOn >= asOf),
  );

  const poolsMap = new Map<
    string,
    {
      pool: string;
      totalCents: number;
      accounts: { id: string; name: string; balanceCents: number; isPrivate: boolean }[];
    }
  >();

  for (const account of savingsAccounts) {
    const owners = ctx.uow.read((r) => r.accounts.owners(account.id));
    const pool = poolOf(owners);

    // If viewer is a person, never include a partner's personal pool (even if the account is not private)
    if (ctx.viewer.kind === "person" && pool !== "shared" && pool !== ctx.viewer.personId) {
      continue;
    }

    const balanceCents = ctx.uow.read(
      (r) => r.balanceSnapshots.balanceAsOf(ctx.viewer, account.id, asOf) ?? 0,
    );

    let poolEntry = poolsMap.get(pool);
    if (!poolEntry) {
      poolEntry = {
        pool,
        totalCents: 0,
        accounts: [],
      };
      poolsMap.set(pool, poolEntry);
    }

    poolEntry.totalCents += balanceCents;
    poolEntry.accounts.push({
      id: account.id,
      name: account.name,
      balanceCents,
      isPrivate: account.isPrivate,
    });
  }

  // Ensure shared pool is present if viewer is a person
  if (!poolsMap.has("shared")) {
    poolsMap.set("shared", {
      pool: "shared",
      totalCents: 0,
      accounts: [],
    });
  }

  // If viewer is a person, ensure their own pool is present
  if (ctx.viewer.kind === "person" && !poolsMap.has(ctx.viewer.personId)) {
    poolsMap.set(ctx.viewer.personId, {
      pool: ctx.viewer.personId,
      totalCents: 0,
      accounts: [],
    });
  }

  const pools = Array.from(poolsMap.values()).map((p) => ({
    pool: p.pool,
    totalCents: p.totalCents,
    accounts: p.accounts,
  }));

  return { asOf, pools };
}

/**
 * List goals visible to the viewer (AD-3, AD-22) with current balances and a
 * completion projection from the goal's own allocation history.
 */
export function listGoals(
  ctx: UseCaseContext,
  input: { readonly asOf?: string | undefined } = {},
): GoalView[] {
  const asOf = input.asOf ?? ctx.clock.today().toString();
  const goals = ctx.uow.read((r) => r.goals.listVisible(ctx.viewer));
  return goals.map((g) => {
    const allocatedCents = ctx.uow.read((r) => r.goalAllocations.sumForGoal(ctx.viewer, g.id));
    const adjustedCents = ctx.uow.read((r) => r.goalAdjustments.sumActiveForGoal(ctx.viewer, g.id));
    const currentBalance = allocatedCents - adjustedCents;
    const rows = ctx.uow.read((r) => r.goalAllocations.listForGoal(ctx.viewer, g.id));
    return {
      ...g,
      pool: g.personId === null ? "shared" : g.personId,
      currentBalance,
      projection: projectGoalCompletion(
        rows.map((a) => ({ periodStart: a.periodStart, amountCents: a.allocatedCents })),
        g.targetCents - currentBalance,
        asOf,
      ),
    };
  });
}

/**
 * List stages visible to the viewer.
 */
export function listStages(ctx: UseCaseContext): AllocationStageRow[] {
  return ctx.uow.read((r) => r.stages.listVisible(ctx.viewer));
}

/**
 * Get goals summary workspace data:
 * visible goals, stages, rules, real active stage, and pool balances.
 */
export function getGoalsSummary(
  ctx: UseCaseContext,
  input: { readonly asOf?: string | undefined } = {},
): GoalsSummaryResult {
  const asOf = input.asOf ?? ctx.clock.today().toString();
  const goals = listGoals(ctx, { asOf });
  const stages = listStages(ctx);
  const rules = ctx.uow.read((r) => r.goalRules.listVisible(ctx.viewer));
  const poolBalancesResult = getSavingsPoolBalances(ctx, { asOf });

  // Settings
  const settings: PlanningSettingRow[] = [];
  const sharedSetting = ctx.uow.read((r) => r.planningSettings.get(ctx.viewer, null));
  if (sharedSetting) settings.push(sharedSetting);
  const viewer = ctx.viewer;
  if (viewer.kind === "person") {
    const personalSetting = ctx.uow.read((r) => r.planningSettings.get(viewer, viewer.personId));
    if (personalSetting) settings.push(personalSetting);
  }

  // Active stage for shared pool (or viewer's personal pool if querying personal)
  // Derive balances map from goal views: preserve real allocatedCents and adjustedCents
  const balancesMap = new Map<
    Id<"Goal">,
    { goalId: Id<"Goal">; allocatedCents: number; adjustedCents: number; currentBalance: number }
  >();
  for (const g of goals) {
    const allocatedCents = ctx.uow.read((r) => r.goalAllocations.sumForGoal(ctx.viewer, g.id));
    const adjustedCents = ctx.uow.read((r) => r.goalAdjustments.sumActiveForGoal(ctx.viewer, g.id));
    balancesMap.set(g.id, {
      goalId: g.id,
      allocatedCents,
      adjustedCents,
      currentBalance: g.currentBalance,
    });
  }

  // Shared pool stages for shared activeStage
  const sharedStages = stages.filter((s) => s.personId === null);
  const sharedGoals = goals.filter((g) => g.personId === null);
  const activeStageRes = resolveActiveStage(sharedStages, sharedGoals, balancesMap);
  const activeStage = activeStageRes.activeStage;

  // The active stage's exit goal, if projected, is when the ladder changes next.
  const exitProjection = activeStage?.exitGoalId
    ? (goals.find((g) => g.id === activeStage.exitGoalId)?.projection ?? null)
    : null;

  return {
    asOf,
    goals,
    stages,
    activeStage,
    nextStageChangeDate: exitProjection?.projectedCompletion ?? null,
    rules,
    pools: poolBalancesResult.pools,
    poolBalances: poolBalancesResult.pools,
    settings,
  };
}

export const createGoalInput = z.object({
  name: z.string().min(1),
  targetCents: z.number().int().positive(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  priority: z.number().int().optional(),
  kind: z.enum(["flexible", "protected"]).optional(),
  isEmergencyFund: z.boolean().optional(),
  pool: z.string().nullable().optional(), // "shared" / null or personId
});

export type CreateGoalInput = z.infer<typeof createGoalInput>;

/**
 * Creates a savings goal in a pool.
 * Enforces: at most one emergency fund per pool!
 */
export function createGoal(ctx: UseCaseContext, rawInput: CreateGoalInput): GoalRow {
  const input = parseInput(createGoalInput, rawInput);
  const pool = input.pool ?? (ctx.viewer.kind === "person" ? null : null);
  const targetPersonId = pool === "shared" || pool === null ? null : (pool as Id<"Person">);

  if (
    targetPersonId !== null &&
    ctx.viewer.kind === "person" &&
    ctx.viewer.personId !== targetPersonId
  ) {
    throw new AppError("NotFound", "Pool not found");
  }

  return write(ctx, (tx, audit) => {
    // Invariant check: Pool already has an emergency fund
    if (input.isEmergencyFund) {
      const existingGoals = tx.goals.listVisible(ctx.viewer);
      const existingEf = existingGoals.find(
        (g) => g.personId === targetPersonId && g.isEmergencyFund,
      );
      if (existingEf) {
        throw new AppError("Conflict", "Pool already has an emergency fund");
      }
    }

    const now = formatInstant(ctx.clock.now());
    const row: GoalRow = {
      id: ctx.newId<"Goal">(),
      personId: targetPersonId,
      name: input.name,
      targetCents: input.targetCents,
      targetDate: input.targetDate ?? null,
      priority: input.priority ?? 0,
      kind: (input.kind as GoalKind) ?? "flexible",
      isEmergencyFund: input.isEmergencyFund ?? false,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    tx.goals.insert(row);
    audit({
      entity: "goal",
      entityId: row.id,
      ...(targetPersonId ? { personId: targetPersonId } : {}),
      action: "create",
      before: null,
      after: row,
    });

    return row;
  });
}

export const updateGoalInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  targetCents: z.number().int().positive().optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  priority: z.number().int().optional(),
  kind: z.enum(["flexible", "protected"]).optional(),
  isEmergencyFund: z.boolean().optional(),
  completedAt: z.string().nullable().optional(),
});

export type UpdateGoalInput = z.infer<typeof updateGoalInput>;

/**
 * Updates a savings goal in a pool.
 * Enforces: at most one emergency fund per pool!
 */
export function updateGoal(ctx: UseCaseContext, rawInput: UpdateGoalInput): GoalRow {
  const input = parseInput(updateGoalInput, rawInput);
  const goalId = input.id as Id<"Goal">;

  return write(ctx, (tx, audit) => {
    const existing = tx.goals.findById(ctx.viewer, goalId);
    if (!existing) {
      throw new AppError("NotFound", `Goal ${input.id} not found`);
    }

    // Invariant check: Pool already has an emergency fund (other than this goal)
    if (input.isEmergencyFund && !existing.isEmergencyFund) {
      const existingGoals = tx.goals.listVisible(ctx.viewer);
      const existingEf = existingGoals.find(
        (g) => g.personId === existing.personId && g.isEmergencyFund && g.id !== existing.id,
      );
      if (existingEf) {
        throw new AppError("Conflict", "Pool already has an emergency fund");
      }
    }

    const now = formatInstant(ctx.clock.now());
    const updated: GoalRow = {
      ...existing,
      name: input.name ?? existing.name,
      targetCents: input.targetCents ?? existing.targetCents,
      targetDate: input.targetDate !== undefined ? input.targetDate : existing.targetDate,
      priority: input.priority ?? existing.priority,
      kind: input.kind ? (input.kind as GoalKind) : existing.kind,
      isEmergencyFund:
        input.isEmergencyFund !== undefined ? input.isEmergencyFund : existing.isEmergencyFund,
      completedAt: input.completedAt !== undefined ? input.completedAt : existing.completedAt,
      updatedAt: now,
    };

    tx.goals.update(updated);
    audit({
      entity: "goal",
      entityId: updated.id,
      ...(existing.personId ? { personId: existing.personId } : {}),
      action: "update",
      before: existing,
      after: updated,
    });

    return updated;
  });
}

export const deleteGoalInput = z.object({
  id: idInput,
});

export type DeleteGoalInput = z.infer<typeof deleteGoalInput>;

/**
 * Deletes a savings goal.
 * Blocked while any stage still ends with the goal (the ladder would dangle), and
 * once the goal has savings history (those allocation rows are the engine's record).
 */
export function deleteGoal(ctx: UseCaseContext, rawInput: DeleteGoalInput): void {
  const input = parseInput(deleteGoalInput, rawInput);
  const goalId = input.id as Id<"Goal">;

  write(ctx, (tx, audit) => {
    const existing = tx.goals.findById(ctx.viewer, goalId);
    if (!existing) {
      throw new AppError("NotFound", `Goal ${input.id} not found`);
    }

    const referencing = tx.stages.listVisible(ctx.viewer).find((s) => s.exitGoalId === goalId);
    if (referencing) {
      throw new AppError("Conflict", `Stage "${referencing.name}" still ends with this goal`);
    }

    if (tx.goalAllocations.listForGoal(ctx.viewer, goalId).length > 0) {
      throw new AppError("Conflict", "Goal already has savings history");
    }

    // Rules referencing the goal go with it; stage rows themselves are untouched.
    tx.goalRules.deleteForGoal(goalId);
    tx.goals.delete(goalId);
    audit({
      entity: "goal",
      entityId: goalId,
      ...(existing.personId ? { personId: existing.personId } : {}),
      action: "delete",
      before: existing,
      after: null,
    });
  });
}

export const createStageInput = z.object({
  name: z.string().min(1),
  pool: z.string().nullable().optional(), // "shared" / null or personId
  sort: z.number().int().optional(),
  exitGoalId: idInput.nullable().optional(),
  fallbackThresholdBp: z.number().int().min(0).max(10000).optional(),
  completedSharePolicy: z.enum(["rescale", "buffer"]).optional(),
});

export type CreateStageInput = z.infer<typeof createStageInput>;

function poolPersonId(ctx: UseCaseContext, pool: string | null | undefined): Id<"Person"> | null {
  if (pool === undefined || pool === null || pool === "shared") return null;
  const personId = pool as Id<"Person">;
  if (ctx.viewer.kind === "person" && ctx.viewer.personId !== personId) {
    throw new AppError("NotFound", "Pool not found");
  }
  return personId;
}

/** An exit goal must exist (to the viewer) and live in the same pool as its stage. */
function assertExitGoal(
  tx: TxRepos,
  ctx: UseCaseContext,
  exitGoalId: Id<"Goal">,
  personId: Id<"Person"> | null,
): void {
  const goal = tx.goals.findById(ctx.viewer, exitGoalId);
  if (!goal) {
    throw new AppError("NotFound", `Goal ${exitGoalId} not found`);
  }
  // `findById` hides another pool's goal, so this only fires for a system viewer.
  if (goal.personId !== personId) {
    throw new AppError("Conflict", `Goal "${goal.name}" belongs to another pool`);
  }
}

/**
 * Creates an allocation stage in a pool. Sort defaults past the pool's current ladder,
 * so a new stage joins at the end.
 */
export function createStage(ctx: UseCaseContext, rawInput: CreateStageInput): AllocationStageRow {
  const input = parseInput(createStageInput, rawInput);
  const targetPersonId = poolPersonId(ctx, input.pool);

  return write(ctx, (tx, audit) => {
    if (input.exitGoalId !== undefined && input.exitGoalId !== null) {
      assertExitGoal(tx, ctx, input.exitGoalId as Id<"Goal">, targetPersonId);
    }

    const siblings = tx.stages.listVisible(ctx.viewer).filter((s) => s.personId === targetPersonId);
    const sort = input.sort ?? siblings.reduce((max, s) => Math.max(max, s.sort), -1) + 1;

    const now = formatInstant(ctx.clock.now());
    const row: AllocationStageRow = {
      id: ctx.newId<"AllocationStage">(),
      personId: targetPersonId,
      name: input.name,
      sort,
      exitGoalId: input.exitGoalId !== undefined ? (input.exitGoalId as Id<"Goal"> | null) : null,
      fallbackThresholdBp: input.fallbackThresholdBp ?? 8000,
      completedSharePolicy: input.completedSharePolicy ?? "rescale",
      createdAt: now,
      updatedAt: now,
    };

    tx.stages.insert(row);
    audit({
      entity: "allocation_stage",
      entityId: row.id,
      ...(targetPersonId ? { personId: targetPersonId } : {}),
      action: "stage-change",
      before: null,
      after: row,
    });

    return row;
  });
}

export const updateStageInput = z.object({
  id: idInput,
  name: z.string().min(1).optional(),
  sort: z.number().int().optional(),
  exitGoalId: idInput.nullable().optional(),
  fallbackThresholdBp: z.number().int().min(0).max(10000).optional(),
  completedSharePolicy: z.enum(["rescale", "buffer"]).optional(),
});

export type UpdateStageInput = z.infer<typeof updateStageInput>;

/** Updates an allocation stage. */
export function updateStage(ctx: UseCaseContext, rawInput: UpdateStageInput): AllocationStageRow {
  const input = parseInput(updateStageInput, rawInput);
  const stageId = input.id as Id<"AllocationStage">;

  return write(ctx, (tx, audit) => {
    const existing = tx.stages.findById(ctx.viewer, stageId);
    if (!existing) {
      throw new AppError("NotFound", `Stage ${input.id} not found`);
    }

    if (input.exitGoalId !== undefined && input.exitGoalId !== null) {
      assertExitGoal(tx, ctx, input.exitGoalId as Id<"Goal">, existing.personId);
    }

    const now = formatInstant(ctx.clock.now());
    const updated: AllocationStageRow = {
      ...existing,
      name: input.name ?? existing.name,
      sort: input.sort ?? existing.sort,
      exitGoalId:
        input.exitGoalId !== undefined
          ? (input.exitGoalId as Id<"Goal"> | null)
          : existing.exitGoalId,
      fallbackThresholdBp: input.fallbackThresholdBp ?? existing.fallbackThresholdBp,
      completedSharePolicy: input.completedSharePolicy ?? existing.completedSharePolicy,
      updatedAt: now,
    };

    tx.stages.update(updated);
    audit({
      entity: "allocation_stage",
      entityId: updated.id,
      ...(existing.personId ? { personId: existing.personId } : {}),
      action: "stage-change",
      before: existing,
      after: updated,
    });

    return updated;
  });
}

export const deleteStageInput = z.object({
  id: idInput,
});

export type DeleteStageInput = z.infer<typeof deleteStageInput>;

/**
 * Deletes an allocation stage together with its rules.
 * `goal_allocation` history is untouched — the record of what was saved stays.
 */
export function deleteStage(ctx: UseCaseContext, rawInput: DeleteStageInput): void {
  const input = parseInput(deleteStageInput, rawInput);
  const stageId = input.id as Id<"AllocationStage">;

  write(ctx, (tx, audit) => {
    const existing = tx.stages.findById(ctx.viewer, stageId);
    if (!existing) {
      throw new AppError("NotFound", `Stage ${input.id} not found`);
    }

    tx.goalRules.deleteForStage(stageId);
    tx.stages.delete(stageId);
    audit({
      entity: "allocation_stage",
      entityId: stageId,
      ...(existing.personId ? { personId: existing.personId } : {}),
      action: "stage-change",
      before: existing,
      after: null,
    });
  });
}

export const setStageRulesInput = z.object({
  stageId: idInput,
  rules: z.array(
    z.object({
      goalId: idInput,
      shareBp: z.number().int().min(0).max(10000),
    }),
  ),
});

export type SetStageRulesInput = z.infer<typeof setStageRulesInput>;

/**
 * Replaces a stage's per-goal share rules wholesale (`effectiveFrom` = today).
 * `shortfall_override` rows stay untouched — story 7.6 owns those. The buffer is
 * the remainder to 10000 bp and never a rule row, so shares may sum below it.
 */
export function setStageRules(ctx: UseCaseContext, rawInput: SetStageRulesInput): GoalRuleRow[] {
  const input = parseInput(setStageRulesInput, rawInput);
  const stageId = input.stageId as Id<"AllocationStage">;

  return write(ctx, (tx, audit) => {
    const stage = tx.stages.findById(ctx.viewer, stageId);
    if (!stage) {
      throw new AppError("NotFound", `Stage ${input.stageId} not found`);
    }

    const totalShareBp = input.rules.reduce((sum, r) => sum + r.shareBp, 0);
    if (totalShareBp > 10000) {
      throw new AppError(
        "Validation",
        `Shares sum to ${totalShareBp / 100}%; a stage's shares must total at most 100%`,
      );
    }
    if (new Set(input.rules.map((r) => r.goalId)).size !== input.rules.length) {
      throw new AppError("Validation", "A goal can appear only once per stage");
    }

    const now = formatInstant(ctx.clock.now());
    const today = ctx.clock.today().toString();
    const goalById = new Map(tx.goals.listVisible(ctx.viewer).map((g) => [g.id as string, g]));

    const rows: GoalRuleRow[] = [];
    for (const rule of input.rules) {
      const goal = goalById.get(rule.goalId);
      if (!goal) {
        throw new AppError("NotFound", `Goal ${rule.goalId} not found`);
      }
      if (goal.personId !== stage.personId) {
        throw new AppError("Conflict", `Goal "${goal.name}" belongs to another pool`);
      }
      rows.push({
        id: ctx.newId<"GoalRule">(),
        goalId: goal.id,
        stageId: stage.id,
        shareBp: rule.shareBp,
        effectiveFrom: today,
        effectiveUntil: null,
        source: "rule",
        createdAt: now,
        updatedAt: now,
      });
    }

    const before = tx.goalRules.listForStage(ctx.viewer, stage.id);
    for (const existing of before) {
      if (existing.source === "rule") {
        tx.goalRules.delete(existing.id);
      }
    }
    for (const row of rows) {
      tx.goalRules.insert(row);
    }

    audit({
      entity: "allocation_stage",
      entityId: stage.id,
      ...(stage.personId ? { personId: stage.personId } : {}),
      action: "stage-change",
      before: { rules: before.filter((r) => r.source === "rule") },
      after: { rules: rows },
    });

    return rows;
  });
}

export const applyBufferDivertInput = z.object({
  pool: z.string().nullable().optional(), // "shared" / null or personId
  stageId: idInput.optional(),
  goalId: idInput.optional(),
  shareBp: z.number().int().min(0).max(10000).optional(),
  shortfallCents: z.number().int().min(0).optional(),
  effectiveUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export type ApplyBufferDivertInput = z.infer<typeof applyBufferDivertInput>;

export interface BufferDivertResult {
  readonly rule: GoalRuleRow;
  readonly activeStageId: Id<"AllocationStage">;
  readonly shareBp: number;
  readonly effectiveUntil: string | null;
}

/**
 * Creates or updates a time-boxed buffer divert override (`source: "shortfall_override"`)
 * for the active stage of the pool.
 */
export function applyBufferDivert(
  ctx: UseCaseContext,
  rawInput: ApplyBufferDivertInput = {},
): BufferDivertResult {
  const input = parseInput(applyBufferDivertInput, rawInput);
  const pool = input.pool ?? "shared";
  const targetPersonId = pool === "shared" || pool === null ? null : (pool as Id<"Person">);

  if (
    targetPersonId !== null &&
    ctx.viewer.kind === "person" &&
    ctx.viewer.personId !== targetPersonId
  ) {
    throw new AppError("NotFound", "Pool not found");
  }

  return write(ctx, (tx, audit) => {
    const stages = tx.stages.listVisible(ctx.viewer).filter((s) => s.personId === targetPersonId);
    if (stages.length === 0) {
      throw new AppError("NotFound", "No allocation stages found for pool");
    }

    let targetStage: AllocationStageRow | null = null;
    if (input.stageId) {
      const found = stages.find((s) => s.id === input.stageId);
      if (!found) {
        throw new AppError("NotFound", `Stage ${input.stageId} not found in pool`);
      }
      targetStage = found;
    } else {
      const goals = tx.goals.listVisible(ctx.viewer).filter((g) => g.personId === targetPersonId);
      const balances = new Map<
        Id<"Goal">,
        { goalId: Id<"Goal">; allocatedCents: number; adjustedCents: number; currentBalance: number }
      >();
      for (const g of goals) {
        const allocs = tx.goalAllocations.listForGoal(ctx.viewer, g.id);
        const adjs = tx.goalAdjustments.listActiveForGoal(ctx.viewer, g.id);
        const allocatedCents = allocs.reduce((sum, a) => sum + a.allocatedCents, 0);
        const adjustedCents = adjs.reduce((sum, a) => sum + a.amountCents, 0);
        balances.set(g.id, {
          goalId: g.id,
          allocatedCents,
          adjustedCents,
          currentBalance: allocatedCents + adjustedCents,
        });
      }
      const activeRes = resolveActiveStage(stages, goals, balances);
      targetStage = activeRes.activeStage ?? stages.sort((a, b) => a.sort - b.sort)[0] ?? null;
    }

    if (!targetStage) {
      throw new AppError("NotFound", "No active stage resolved for pool");
    }

    // A goal must be referenced by goal_rule (or pick the first goal in stage / emergency fund)
    const existingRules = tx.goalRules.listForStage(ctx.viewer, targetStage.id);
    const existingGoal =
      (input.goalId as Id<"Goal"> | undefined) ??
      existingRules.find((r) => r.source === "rule")?.goalId ??
      tx.goals.listVisible(ctx.viewer).find((g) => g.personId === targetPersonId)?.id;

    if (!existingGoal) {
      throw new AppError("NotFound", "No goals found in stage to attach buffer divert rule");
    }

    const now = formatInstant(ctx.clock.now());
    const today = ctx.clock.today();
    const existingOverride = existingRules.find((r) => r.source === "shortfall_override");

    const shareBp = input.shareBp ?? 0;

    // Project horizon based on shortfall amount and buffer rate (default $50/fortnight = 5000 cents/14 days)
    let effectiveUntil = input.effectiveUntil ?? null;
    if (!effectiveUntil && input.shortfallCents && input.shortfallCents > 0) {
      const fortnightlyBufferCents = 50_00; // $50/fortnight standard shortfall divert rate
      const fortnightsNeeded = Math.max(1, Math.ceil(input.shortfallCents / fortnightlyBufferCents));
      const daysNeeded = fortnightsNeeded * 14;
      effectiveUntil = today.add({ days: daysNeeded }).toString();
    }

    let resultRule: GoalRuleRow;

    if (existingOverride) {
      resultRule = {
        ...existingOverride,
        goalId: existingGoal,
        shareBp,
        effectiveUntil,
        updatedAt: now,
      };
      tx.goalRules.update(resultRule);
    } else {
      resultRule = {
        id: ctx.newId<"GoalRule">(),
        goalId: existingGoal,
        stageId: targetStage.id,
        shareBp,
        effectiveFrom: today.toString(),
        effectiveUntil,
        source: "shortfall_override",
        createdAt: now,
        updatedAt: now,
      };
      tx.goalRules.insert(resultRule);
    }

    audit({
      entity: "allocation_stage",
      entityId: targetStage.id,
      ...(targetStage.personId ? { personId: targetStage.personId } : {}),
      action: "stage-change",
      before: existingOverride ? { override: existingOverride } : null,
      after: { override: resultRule },
    });

    return {
      rule: resultRule,
      activeStageId: targetStage.id,
      shareBp: resultRule.shareBp,
      effectiveUntil: resultRule.effectiveUntil,
    };
  });
}

export const clearBufferDivertInput = z.object({
  pool: z.string().nullable().optional(),
  stageId: idInput.optional(),
});

export type ClearBufferDivertInput = z.infer<typeof clearBufferDivertInput>;

/**
 * Clears any active `shortfall_override` rule for the pool's active stage.
 */
export function clearBufferDivert(
  ctx: UseCaseContext,
  rawInput: ClearBufferDivertInput = {},
): { readonly cleared: boolean } {
  const input = parseInput(clearBufferDivertInput, rawInput);
  const pool = input.pool ?? "shared";
  const targetPersonId = pool === "shared" || pool === null ? null : (pool as Id<"Person">);

  if (
    targetPersonId !== null &&
    ctx.viewer.kind === "person" &&
    ctx.viewer.personId !== targetPersonId
  ) {
    throw new AppError("NotFound", "Pool not found");
  }

  return write(ctx, (tx, audit) => {
    const stages = tx.stages.listVisible(ctx.viewer).filter((s) => s.personId === targetPersonId);
    let stageIds: Id<"AllocationStage">[] = [];
    if (input.stageId) {
      stageIds = [input.stageId as Id<"AllocationStage">];
    } else {
      stageIds = stages.map((s) => s.id);
    }

    let cleared = false;
    for (const sId of stageIds) {
      const stageRules = tx.goalRules.listForStage(ctx.viewer, sId);
      const overrides = stageRules.filter((r) => r.source === "shortfall_override");
      for (const override of overrides) {
        tx.goalRules.delete(override.id);
        cleared = true;
        audit({
          entity: "allocation_stage",
          entityId: sId,
          ...(targetPersonId ? { personId: targetPersonId } : {}),
          action: "stage-change",
          before: { override },
          after: null,
        });
      }
    }

    return { cleared };
  });
}
