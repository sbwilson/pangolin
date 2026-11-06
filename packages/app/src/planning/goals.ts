import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { poolOf } from "../accounts/pool.ts";
import { AppError, parseInput } from "../errors.ts";
import type {
  AllocationStageRow,
  GoalKind,
  GoalRow,
  GoalRuleRow,
  PlanningSettingRow,
} from "../ports/unit-of-work.ts";
import { type UseCaseContext, write } from "../write.ts";
import { calculateGoalBalances, resolveActiveStage } from "./goal-allocation.ts";

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
}

export interface GoalsSummaryResult {
  readonly asOf: string;
  readonly goals: readonly GoalView[];
  readonly stages: readonly AllocationStageRow[];
  readonly activeStage: AllocationStageRow | null;
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
 * List goals visible to the viewer (AD-3, AD-22) with current balances.
 * Shared goals (personId = null) + viewer's personal goals only.
 */
export function listGoals(ctx: UseCaseContext): GoalView[] {
  const goals = ctx.uow.read((r) => r.goals.listVisible(ctx.viewer));
  return goals.map((g) => {
    const currentBalance = ctx.uow.read((r) => r.goalAllocations.sumForGoal(ctx.viewer, g.id));
    return {
      ...g,
      pool: g.personId === null ? "shared" : g.personId,
      currentBalance,
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
  const goals = listGoals(ctx);
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
  // Derive balances map from goal views
  const balancesMap = new Map<
    Id<"Goal">,
    { goalId: Id<"Goal">; allocatedCents: number; adjustedCents: number; currentBalance: number }
  >();
  for (const g of goals) {
    balancesMap.set(g.id, {
      goalId: g.id,
      allocatedCents: g.currentBalance,
      adjustedCents: 0,
      currentBalance: g.currentBalance,
    });
  }

  // Shared pool stages for shared activeStage
  const sharedStages = stages.filter((s) => s.personId === null);
  const sharedGoals = goals.filter((g) => g.personId === null);
  const activeStageRes = resolveActiveStage(sharedStages, sharedGoals, balancesMap);
  const activeStage = activeStageRes.activeStage;

  return {
    asOf,
    goals,
    stages,
    activeStage,
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
