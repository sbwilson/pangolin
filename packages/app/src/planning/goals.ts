import { poolOf } from "../accounts/pool.ts";
import type {
  AllocationStageRow,
  GoalRow,
  GoalRuleRow,
  PlanningSettingRow,
} from "../ports/unit-of-work.ts";
import type { UseCaseContext } from "../write.ts";

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
  input: { readonly asOf?: string } = {},
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
 * List goals visible to the viewer (AD-3, AD-22).
 * Shared goals (personId = null) + viewer's personal goals only.
 */
export function listGoals(ctx: UseCaseContext): GoalView[] {
  const goals = ctx.uow.read((r) => r.goals.listVisible(ctx.viewer));
  return goals.map((g) => ({
    ...g,
    pool: g.personId === null ? "shared" : g.personId,
  }));
}

/**
 * List stages visible to the viewer.
 */
export function listStages(ctx: UseCaseContext): AllocationStageRow[] {
  return ctx.uow.read((r) => r.stages.listVisible(ctx.viewer));
}

/**
 * Get goals summary workspace data:
 * visible goals, stages, rules, active stage, and pool balances.
 */
export function getGoalsSummary(
  ctx: UseCaseContext,
  input: { readonly asOf?: string } = {},
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
  if (ctx.viewer.kind === "person") {
    const personalSetting = ctx.uow.read((r) =>
      r.planningSettings.get(ctx.viewer, ctx.viewer.personId),
    );
    if (personalSetting) settings.push(personalSetting);
  }

  // Active stage for shared pool (default stage 1 or lowest sort)
  // Story 7.1 tracer bullet: active stage is the first incomplete stage (or lowest sort stage)
  const activeStage = stages.length > 0 ? stages[0] : null;

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
