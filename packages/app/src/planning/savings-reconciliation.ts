// The savings reconciliation engine (story 7.3): per visible pool it derives a period's new
// savings from the savings-flagged accounts (AD-19), feeds positive amounts into the existing
// `executeSavingsAllocation` (idempotent per pool and period, AD-11), lets deficits pass with
// zero allocations so only the derived buffer shrinks (Option A), and reports the invariant
// `goals + buffer = pool savings`. The buffer is derived on read — never stored.
import type { Id } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { z } from "zod";
import { AppError, parseInput } from "../errors.ts";
import { dayInput } from "../inputs.ts";
import type { ReadRepos } from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";
import type { UseCaseContext } from "../write.ts";
import { calculateGoalBalances, executeSavingsAllocation } from "./goal-allocation.ts";
import { getSavingsPoolBalances, type SavingsPoolBalance } from "./goals.ts";

/** The category name that marks interest income, under an income-kind group (`classify/defaults.ts`). */
export const INTEREST_CATEGORY_NAME = "Interest";

export type SavingsReconciliationStatus = "ok" | "over-committed";

/** One pool's invariant at a balance date: goals plus the derived buffer, or the shortfall. */
export interface SavingsReconciliationReport {
  /** `"shared"` or the pool owner's person id (AD-26). */
  readonly pool: string;
  readonly actualSavingsCents: number;
  readonly goalTotalCents: number;
  readonly bufferCents: number;
  readonly shortfallCents: number;
  readonly status: SavingsReconciliationStatus;
}

/** A pool's report plus what one reconciliation run did about the period's new savings. */
export interface SavingsReconciliationRunReport extends SavingsReconciliationReport {
  readonly newSavingsCents: number;
  readonly allocatedCents: number;
  readonly alreadyAllocated: boolean;
}

export interface PoolNewSavingsInput {
  readonly startTotalCents: number;
  readonly endTotalCents: number;
  readonly interestCents: number;
  /**
   * AD-24 extension point: goal-linked or covered withdrawals in the period (positive cents) —
   * money that left the pool but already shows in goal balances. Adding it back keeps a goal
   * transfer from reading as a phantom deficit. It defaults to 0: the drawdown repos do not
   * exist yet (story 7.5), so nothing fills it here.
   */
  readonly excludedGoalWithdrawalCents?: number;
}

/** The pure derivation: end minus start minus interest, plus any excluded goal withdrawals. */
export function derivePoolNewSavingsCents(input: PoolNewSavingsInput): number {
  return (
    input.endTotalCents -
    input.startTotalCents -
    input.interestCents +
    (input.excludedGoalWithdrawalCents ?? 0)
  );
}

/** The invariant by construction: buffer and shortfall are never both positive, and nothing is stored. */
export function reconcilePool(
  pool: string,
  actualSavingsCents: number,
  goalTotalCents: number,
): SavingsReconciliationReport {
  const bufferCents = Math.max(0, actualSavingsCents - goalTotalCents);
  const shortfallCents = Math.max(0, goalTotalCents - actualSavingsCents);
  return {
    pool,
    actualSavingsCents,
    goalTotalCents,
    bufferCents,
    shortfallCents,
    status: shortfallCents > 0 ? "over-committed" : "ok",
  };
}

export const runSavingsReconciliationInput = z
  .object({
    pool: z.string().min(1).optional(),
    periodStart: dayInput,
    periodEnd: dayInput,
  })
  .refine((v) => v.periodStart < v.periodEnd, {
    message: "periodStart must be before periodEnd",
    path: ["periodStart"],
  });

export type RunSavingsReconciliationInput = z.infer<typeof runSavingsReconciliationInput>;

export const getSavingsReconciliationInput = z.object({ asOf: dayInput.optional() });

export type GetSavingsReconciliationInput = z.infer<typeof getSavingsReconciliationInput>;

function shiftDay(day: string, days: number): string {
  return parseDate(day).add({ days }).toString();
}

/** The pool guard mirrored from `executeSavingsAllocation`: shared is everyone's, a person pool belongs to its owner. */
function targetPersonOf(pool: string, viewer: Viewer): Id<"Person"> | null {
  if (pool === "shared") return null;
  if (viewer.kind === "person" && viewer.personId !== pool) {
    throw new AppError("NotFound", "Pool not found");
  }
  return pool as Id<"Person">;
}

/** The ids of the categories named `Interest` under an income-kind group; none means nothing is excluded. */
function interestCategoryIds(repos: ReadRepos, viewer: Viewer): Id<"Category">[] {
  const incomeGroupIds = new Set(
    repos.categoryGroups
      .list(viewer)
      .filter((group) => group.kind === "income")
      .map((group) => group.id),
  );
  if (incomeGroupIds.size === 0) return [];
  return repos.categories
    .list(viewer)
    .filter(
      (category) =>
        incomeGroupIds.has(category.groupId) && category.name === INTEREST_CATEGORY_NAME,
    )
    .map((category) => category.id);
}

/** What the pool's goals hold: every visible goal of the pool, balances from allocation history minus active adjustments. */
function poolGoalTotalCents(
  repos: ReadRepos,
  viewer: Viewer,
  targetPersonId: Id<"Person"> | null,
): number {
  const goals = repos.goals.listVisible(viewer).filter((goal) => goal.personId === targetPersonId);
  const allocations = [];
  const adjustments = [];
  for (const goal of goals) {
    allocations.push(...repos.goalAllocations.listForGoal(viewer, goal.id));
    adjustments.push(...repos.goalAdjustments.listActiveForGoal(viewer, goal.id));
  }
  let totalCents = 0;
  for (const balance of calculateGoalBalances(allocations, adjustments).values()) {
    totalCents += balance.currentBalance;
  }
  return totalCents;
}

/** True when a `goal_allocation` row of the pool's goals already exists at `periodStart` (AD-11). */
function poolAlreadyAllocated(
  repos: ReadRepos,
  viewer: Viewer,
  targetPersonId: Id<"Person"> | null,
  periodStart: string,
): boolean {
  const goalIds = new Set(
    repos.goals
      .listVisible(viewer)
      .filter((goal) => goal.personId === targetPersonId)
      .map((goal) => goal.id),
  );
  if (goalIds.size === 0) return false;
  return repos.goalAllocations
    .listForPeriod(viewer, periodStart)
    .some((allocation) => goalIds.has(allocation.goalId));
}

/** One pool's account ids at the two boundaries: an account present at only one still weighs (loopback 1). */
function poolAccountIds(
  startPool: SavingsPoolBalance | undefined,
  endPool: SavingsPoolBalance | undefined,
): Id<"Account">[] {
  const ids = new Set<string>();
  for (const account of startPool?.accounts ?? []) ids.add(account.id);
  for (const account of endPool?.accounts ?? []) ids.add(account.id);
  return [...ids] as Id<"Account">[];
}

/**
 * Use case: reconciles one pool (or every visible pool when `pool` is omitted) for the half-open
 * period `[periodStart, periodEnd)`. Boundaries are the inclusive days before each endpoint.
 * Positive new savings are allocated through `executeSavingsAllocation` unless the period is
 * already allocated; deficits and zero months write nothing (Option A). Each pool is reported
 * with the invariant `goals + buffer = pool savings`.
 */
export function runSavingsReconciliation(
  ctx: UseCaseContext,
  rawInput: RunSavingsReconciliationInput,
): SavingsReconciliationRunReport[] {
  const input = parseInput(runSavingsReconciliationInput, rawInput);
  const startBoundary = shiftDay(input.periodStart, -1);
  const endBoundary = shiftDay(input.periodEnd, -1);

  // Snapshot at BOTH boundaries (each use case opens its own short read; nothing nests).
  const startPools = getSavingsPoolBalances(ctx, { asOf: startBoundary }).pools;
  const endPools = getSavingsPoolBalances(ctx, { asOf: endBoundary }).pools;

  // The pool keys to process: the requested one, or the union over the two boundaries (end first).
  const requested = input.pool !== undefined ? [input.pool] : undefined;
  const poolKeys = requested ?? [...new Set([...endPools, ...startPools].map((p) => p.pool))];

  interface PoolDerivation {
    pool: string;
    targetPersonId: Id<"Person"> | null;
    startTotalCents: number;
    endTotalCents: number;
    accountIds: Id<"Account">[];
    newSavingsCents: number;
  }
  const derived: PoolDerivation[] = poolKeys.map((poolKey) => {
    if (requested !== undefined) targetPersonOf(poolKey, ctx.viewer);
    const startPool = startPools.find((p) => p.pool === poolKey);
    const endPool = endPools.find((p) => p.pool === poolKey);
    return {
      pool: poolKey,
      targetPersonId: poolKey === "shared" ? null : (poolKey as Id<"Person">),
      startTotalCents: startPool?.totalCents ?? 0,
      endTotalCents: endPool?.totalCents ?? 0,
      accountIds: poolAccountIds(startPool, endPool),
      newSavingsCents: 0,
    };
  });

  const interestRange = { from: input.periodStart, to: endBoundary };
  const interestCentsByPool = ctx.uow.read((repos) => {
    const interestIds = interestCategoryIds(repos, ctx.viewer);
    const totals = new Map<string, number>();
    if (interestIds.length === 0) return totals;
    for (const pool of derived) {
      if (pool.accountIds.length === 0) continue;
      totals.set(
        pool.pool,
        repos.transactions.sumSplitCents(ctx.viewer, pool.accountIds, interestIds, interestRange),
      );
    }
    return totals;
  });

  const alreadyAllocatedByPool = ctx.uow.read((repos) => {
    const flags = new Map<string, boolean>();
    for (const pool of derived) {
      flags.set(
        pool.pool,
        poolAlreadyAllocated(repos, ctx.viewer, pool.targetPersonId, input.periodStart),
      );
    }
    return flags;
  });

  const excludedWithdrawalCentsByPool = ctx.uow.read((repos) => {
    const totals = new Map<string, number>();
    for (const pool of derived) {
      const activeDrawdowns = repos.goalDrawdowns.listActiveForPool(ctx.viewer, pool.pool);
      // Covered withdrawals: active drawdowns with transactionId != null created within [periodStart, periodEnd)
      const sumCovered = activeDrawdowns
        .filter((d) => {
          if (d.transactionId === null) return false;
          const createdDay = d.createdAt.slice(0, 10);
          return createdDay >= input.periodStart && createdDay < input.periodEnd;
        })
        .reduce((sum, d) => sum + d.amountCents, 0);
      totals.set(pool.pool, sumCovered);
    }
    return totals;
  });

  // Positive, not-yet-allocated months allocate — each run opens its own write transaction.
  const allocatedCentsByPool = new Map<string, number>();
  for (const pool of derived) {
    const newSavingsCents = derivePoolNewSavingsCents({
      startTotalCents: pool.startTotalCents,
      endTotalCents: pool.endTotalCents,
      interestCents: interestCentsByPool.get(pool.pool) ?? 0,
      excludedGoalWithdrawalCents: excludedWithdrawalCentsByPool.get(pool.pool) ?? 0,
    });
    const already = alreadyAllocatedByPool.get(pool.pool) ?? false;
    let allocatedCents = 0;
    if (newSavingsCents > 0 && !already) {
      const execution = executeSavingsAllocation(ctx, {
        periodStart: input.periodStart,
        savingsCents: newSavingsCents,
        pool: pool.pool,
      });
      allocatedCents = execution.totalAllocatedCents;
    }
    allocatedCentsByPool.set(pool.pool, allocatedCents);
    pool.newSavingsCents = newSavingsCents;
  }

  // Goal totals are read after the allocations so the invariant sees this run's work.
  return ctx.uow.read((repos) =>
    derived.map((pool) => ({
      ...reconcilePool(
        pool.pool,
        pool.endTotalCents,
        poolGoalTotalCents(repos, ctx.viewer, pool.targetPersonId),
      ),
      newSavingsCents: pool.newSavingsCents,
      allocatedCents: allocatedCentsByPool.get(pool.pool) ?? 0,
      alreadyAllocated: alreadyAllocatedByPool.get(pool.pool) ?? false,
    })),
  );
}

/**
 * Use case: the read-only per-pool report at `asOf` (today by default) — the invariant
 * `goals + buffer = pool savings` for the shared pool and the viewer's own personal pool
 * (AD-3, AD-22). Nothing is written.
 */
export function getSavingsReconciliation(
  ctx: UseCaseContext,
  rawInput: GetSavingsReconciliationInput = {},
): SavingsReconciliationReport[] {
  const input = parseInput(getSavingsReconciliationInput, rawInput);
  const asOf = input.asOf ?? ctx.clock.today().toString();
  const pools = getSavingsPoolBalances(ctx, { asOf }).pools;
  return pools.map((pool) => {
    const targetPersonId = pool.pool === "shared" ? null : (pool.pool as Id<"Person">);
    const goalTotalCents = ctx.uow.read((repos) =>
      poolGoalTotalCents(repos, ctx.viewer, targetPersonId),
    );
    return reconcilePool(pool.pool, pool.totalCents, goalTotalCents);
  });
}
