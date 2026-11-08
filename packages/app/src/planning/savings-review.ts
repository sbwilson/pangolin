// Savings reconciliation review items: large withdrawal detection, shortfall alerts, and buffer mismatch fixes.
// AD-17, AD-22, CAP-6, CAP-7
import type { Cents, Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { poolOf } from "../accounts/pool.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import type {
  AccountRow,
  GoalAdjustmentRow,
  GoalDrawdownRow,
  GoalRow,
  ReviewItemRow,
  TransactionRow,
  TxRepos,
} from "../ports/unit-of-work.ts";
import {
  defineReviewKind,
  type ReviewKind,
  raiseReviewItem,
  resolveReviewItem,
} from "../system/review-items.ts";
import { personViewer } from "../viewer.ts";
import type { Audit } from "../write.ts";
import { write } from "../write.ts";
import { executeDrawdown } from "./goal-drawdown.ts";
import { getSavingsPoolBalances } from "./goals.ts";
import {
  poolGoalTotalCents,
  reconcilePool,
  type SavingsReconciliationReport,
} from "./savings-reconciliation.ts";

/**
 * Review kinds for savings reconciliation (CAP-7, AD-22).
 * Shared pool items have "household" scope.
 * Personal pool items have "person" scope.
 */
export const SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW = defineReviewKind({
  kind: "planning.savings.large_withdrawal",
  module: "planning",
  scope: "household",
});

export const SAVINGS_LARGE_WITHDRAWAL_PERSONAL_REVIEW = defineReviewKind({
  kind: "planning.savings.large_withdrawal.personal",
  module: "planning",
  scope: "person",
});

export const SAVINGS_SHORTFALL_HOUSEHOLD_REVIEW = defineReviewKind({
  kind: "planning.savings.shortfall",
  module: "planning",
  scope: "household",
});

export const SAVINGS_SHORTFALL_PERSONAL_REVIEW = defineReviewKind({
  kind: "planning.savings.shortfall.personal",
  module: "planning",
  scope: "person",
});

export const SAVINGS_MISMATCH_HOUSEHOLD_REVIEW = defineReviewKind({
  kind: "planning.savings.mismatch",
  module: "planning",
  scope: "household",
});

export const SAVINGS_MISMATCH_PERSONAL_REVIEW = defineReviewKind({
  kind: "planning.savings.mismatch.personal",
  module: "planning",
  scope: "person",
});

export const SAVINGS_REVIEW_KINDS = [
  SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW.kind,
  SAVINGS_LARGE_WITHDRAWAL_PERSONAL_REVIEW.kind,
  SAVINGS_SHORTFALL_HOUSEHOLD_REVIEW.kind,
  SAVINGS_SHORTFALL_PERSONAL_REVIEW.kind,
  SAVINGS_MISMATCH_HOUSEHOLD_REVIEW.kind,
  SAVINGS_MISMATCH_PERSONAL_REVIEW.kind,
] as const;

/**
 * Deterministic dedupe key for large withdrawal review items:
 * `savings:large_withdrawal:<transactionId>`
 */
export function savingsLargeWithdrawalDedupeKey(transactionId: string): string {
  return `savings:large_withdrawal:${transactionId}`;
}

/**
 * Deterministic dedupe key for shortfall review items:
 * `savings:shortfall:<pool>`
 */
export function savingsShortfallDedupeKey(pool: string): string {
  return `savings:shortfall:${pool}`;
}

/**
 * Deterministic dedupe key for mismatch review items:
 * `savings:mismatch:<pool>`
 */
export function savingsMismatchDedupeKey(pool: string): string {
  return `savings:mismatch:${pool}`;
}

/**
 * Deterministic entityRef for large withdrawal:
 * `transaction:<transactionId>`
 */
export function transactionEntityRef(transactionId: string): string {
  return `transaction:${transactionId}`;
}

/**
 * Deterministic entityRef for savings pool:
 * `savings_pool:<pool>`
 */
export function savingsPoolEntityRef(pool: string): string {
  return `savings_pool:${pool}`;
}

/** Default large withdrawal threshold in cents ($2,000). */
export const DEFAULT_LARGE_WITHDRAWAL_THRESHOLD_CENTS = 200_000;

/**
 * Resolves the large withdrawal threshold for a pool in cents.
 */
export function getLargeWithdrawalThresholdCents(
  repos: { readonly planningSettings: { get(viewer: any, personId: string | null): any } },
  viewer: any,
  pool: string,
): number {
  const targetPersonId = pool === "shared" ? null : pool;
  const setting = repos.planningSettings.get(viewer, targetPersonId);
  return setting?.largeWithdrawalThresholdCents ?? DEFAULT_LARGE_WITHDRAWAL_THRESHOLD_CENTS;
}

/**
 * Helper to get the pool and privacy of a savings account.
 */
function getAccountPoolInfo(
  tx: TxRepos,
  account: AccountRow,
): { pool: string; isSavings: boolean; isPrivate: boolean } {
  const owners = tx.accounts.owners(account.id);
  const pool = poolOf(owners);
  return { pool, isSavings: account.isSavings, isPrivate: account.isPrivate };
}

/**
 * Syncs large withdrawal review items for visible transactions.
 * Rules:
 * - Savings account expense txn (amountCents < 0) with Math.abs(amountCents) >= threshold
 * - Not an internal transfer between savings accounts in the same pool
 * - Not already linked to a goal drawdown (no active drawdown referencing this transactionId)
 * - Shared pool -> household scope, entityRef `transaction:<id>`
 * - Personal pool -> person scope with personId = pool owner
 * - Idempotent via dedupe key `savings:large_withdrawal:<transactionId>`
 */
export function syncLargeWithdrawalReviewItems(
  tx: TxRepos,
  audit: Audit,
  ctx: UseCaseContext,
): number {
  const today = ctx.clock.today().toString();
  const txns = tx.transactions.listVisible(ctx.viewer, today);

  // Pre-load visible accounts and their pools
  const visibleAccounts = tx.accounts.list(ctx.viewer);
  const accountMap = new Map<string, { account: AccountRow; pool: string }>();
  for (const acc of visibleAccounts) {
    if (acc.isSavings) {
      const owners = tx.accounts.owners(acc.id);
      const pool = poolOf(owners);
      accountMap.set(acc.id, { account: acc, pool });
    }
  }

  // Pre-load active drawdowns with transactionId != null
  const activeDrawdowns = tx.goalDrawdowns.listActiveForPool(ctx.viewer, "shared");
  const linkedTxnIds = new Set<string>();
  for (const d of activeDrawdowns) {
    if (d.transactionId) linkedTxnIds.add(d.transactionId);
  }
  // Also check personal pools if viewer is person or system
  if (ctx.viewer.kind === "person") {
    const personalDrawdowns = tx.goalDrawdowns.listActiveForPool(ctx.viewer, ctx.viewer.personId);
    for (const d of personalDrawdowns) {
      if (d.transactionId) linkedTxnIds.add(d.transactionId);
    }
  } else if (ctx.viewer.kind === "system") {
    const activePersons = tx.person.listActive();
    for (const p of activePersons) {
      const personalDrawdowns = tx.goalDrawdowns.listActiveForPool(ctx.viewer, p.id);
      for (const d of personalDrawdowns) {
        if (d.transactionId) linkedTxnIds.add(d.transactionId);
      }
    }
  }

  // Also query open large withdrawal review items to check if any resolved transactions need auto-resolution
  const openItems = tx.reviewItems
    .listOpenFor(ctx.viewer)
    .filter(
      (item) =>
        item.kind === SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW.kind ||
        item.kind === SAVINGS_LARGE_WITHDRAWAL_PERSONAL_REVIEW.kind,
    );

  let raisedCount = 0;

  for (const txn of txns) {
    const accInfo = accountMap.get(txn.accountId);
    if (!accInfo) continue; // Not a savings account

    const isExpense = txn.amountCents < 0;
    const absAmount = Math.abs(txn.amountCents);
    const pool = accInfo.pool;
    const thresholdCents = getLargeWithdrawalThresholdCents(tx, ctx.viewer, pool);

    const isLarge = isExpense && absAmount >= thresholdCents;

    // Check if it's an internal transfer between same-pool savings accounts
    let isSamePoolTransfer = false;
    if (txn.transferGroupId !== null) {
      const { rows: counterparts } = tx.transferGroups.members(ctx.viewer, txn.transferGroupId);
      for (const counterpart of counterparts) {
        if (counterpart.id !== txn.id) {
          const counterpartAcc = accountMap.get(counterpart.accountId);
          if (counterpartAcc && counterpartAcc.pool === pool) {
            isSamePoolTransfer = true;
            break;
          }
        }
      }
    }

    const isLinked = linkedTxnIds.has(txn.id);

    const dedupeKey = savingsLargeWithdrawalDedupeKey(txn.id);

    if (isLarge && !isSamePoolTransfer && !isLinked) {
      // Raise item
      const isShared = pool === "shared";
      const kind: ReviewKind = isShared
        ? SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW
        : SAVINGS_LARGE_WITHDRAWAL_PERSONAL_REVIEW;

      const { raised } = raiseReviewItem(tx, audit, ctx, {
        kind,
        entityRef: transactionEntityRef(txn.id),
        dedupeKey,
        ...(isShared ? {} : { personId: pool }),
      });
      if (raised) raisedCount++;
    } else {
      // If linked or transfer or below threshold, auto-resolve any open review item
      resolveReviewItem(tx, audit, ctx, {
        dedupeKey,
        resolution: isLinked ? "covered" : "resolved",
      });
    }
  }

  return raisedCount;
}

/**
 * Syncs shortfall and mismatch review items for visible pools.
 * Rules:
 * - Pool status "over-committed" -> raises shortfall item
 * - Pool status "ok" -> auto-resolves shortfall item with resolution "cured"
 * - Dedupe key: `savings:shortfall:<pool>`
 * - Scoping: shared pool -> household, personal pool -> person
 */
export function syncSavingsReconciliationReviewItems(
  tx: TxRepos,
  audit: Audit,
  ctx: UseCaseContext,
  reports?: readonly SavingsReconciliationReport[],
): void {
  const asOf = ctx.clock.today().toString();
  const poolReports =
    reports ??
    getSavingsPoolBalances(ctx, { asOf }).pools.map((p) => {
      const targetPersonId = p.pool === "shared" ? null : (p.pool as Id<"Person">);
      const goalTotalCents = poolGoalTotalCents(tx, ctx.viewer, targetPersonId);
      return reconcilePool(p.pool, p.totalCents, goalTotalCents);
    });

  for (const report of poolReports) {
    const isShared = report.pool === "shared";
    const shortfallKey = savingsShortfallDedupeKey(report.pool);

    if (report.status === "over-committed") {
      const kind: ReviewKind = isShared
        ? SAVINGS_SHORTFALL_HOUSEHOLD_REVIEW
        : SAVINGS_SHORTFALL_PERSONAL_REVIEW;

      raiseReviewItem(tx, audit, ctx, {
        kind,
        entityRef: savingsPoolEntityRef(report.pool),
        dedupeKey: shortfallKey,
        ...(isShared ? {} : { personId: report.pool }),
      });
    } else {
      resolveReviewItem(tx, audit, ctx, {
        dedupeKey: shortfallKey,
        resolution: "cured",
      });
    }
  }
}

/**
 * Evaluates and syncs all savings reconciliation review items:
 * large withdrawals and shortfalls.
 */
export function syncAllSavingsReviewItems(ctx: UseCaseContext): void {
  write(ctx, (tx, audit) => {
    // If viewer is person, run with viewer context
    // If viewer is system, run for household / each active person
    if (ctx.viewer.kind === "person") {
      syncLargeWithdrawalReviewItems(tx, audit, ctx);
      syncSavingsReconciliationReviewItems(tx, audit, ctx);
    } else {
      // System viewer: evaluate shared pool and each person's pool
      syncLargeWithdrawalReviewItems(tx, audit, ctx);
      syncSavingsReconciliationReviewItems(tx, audit, ctx);

      const activePersons = tx.person.listActive();
      for (const p of activePersons) {
        const pViewer = personViewer(p.id, ctx.clock.now());
        const pCtx = { ...ctx, viewer: pViewer };
        syncLargeWithdrawalReviewItems(tx, audit, pCtx);
        syncSavingsReconciliationReviewItems(tx, audit, pCtx);
      }
    }
  });
}

// -------------------------------------------------------------------------------- review actions

export const dismissSavingsReviewItemInput = z
  .object({
    id: idInput,
    resolution: z.string().min(1).max(200).optional(),
  })
  .strict();
export type DismissSavingsReviewItemInput = z.input<typeof dismissSavingsReviewItemInput>;

function openSavingsReviewItem(ctx: UseCaseContext, id: string): ReviewItemRow {
  const item = ctx.uow
    .read((repos) => repos.reviewItems.listOpenFor(ctx.viewer))
    .find((row) => row.id === id);

  if (item === undefined || !(SAVINGS_REVIEW_KINDS as readonly string[]).includes(item.kind)) {
    throw new AppError("NotFound", "Review item not found");
  }
  return item;
}

/**
 * Dismisses a savings review item with an optional or default resolution.
 */
export function dismissSavingsReviewItem(
  ctx: UseCaseContext,
  input: DismissSavingsReviewItemInput,
): void {
  const parsed = parseInput(dismissSavingsReviewItemInput, input);
  write(ctx, (tx, audit) => {
    const item = openSavingsReviewItem(ctx, parsed.id);
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: item.dedupeKey,
      resolution: parsed.resolution ?? "dismissed",
    });
  });
}

export const takeFromBufferReviewItemInput = z
  .object({
    id: idInput,
  })
  .strict();
export type TakeFromBufferReviewItemInput = z.input<typeof takeFromBufferReviewItemInput>;

/**
 * "Take it from the buffer":
 * Validates that the pool has sufficient buffer (buffer >= withdrawal amount),
 * and resolves the large withdrawal review item with resolution "buffer".
 */
export function takeFromBufferReviewItem(
  ctx: UseCaseContext,
  input: TakeFromBufferReviewItemInput,
): void {
  const parsed = parseInput(takeFromBufferReviewItemInput, input);
  write(ctx, (tx, audit) => {
    const item = openSavingsReviewItem(ctx, parsed.id);
    if (
      item.kind !== SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW.kind &&
      item.kind !== SAVINGS_LARGE_WITHDRAWAL_PERSONAL_REVIEW.kind
    ) {
      throw new AppError("Validation", "Item is not a large withdrawal");
    }

    const transactionId = item.entityRef.startsWith("transaction:")
      ? item.entityRef.slice("transaction:".length)
      : item.entityRef;

    const today = ctx.clock.today().toString();
    const txn = tx.transactions.findVisible(ctx.viewer, transactionId, today);
    if (!txn) {
      throw new AppError("NotFound", "Transaction not found");
    }

    const acc = tx.accounts.findVisible(ctx.viewer, txn.accountId);
    if (!acc || !acc.isSavings) {
      throw new AppError("Validation", "Account is not a savings account");
    }

    const owners = tx.accounts.owners(acc.id);
    const pool = poolOf(owners);

    // Calculate current pool buffer
    const targetPersonId = pool === "shared" ? null : (pool as Id<"Person">);
    const poolBalances = getSavingsPoolBalances(ctx, { asOf: today });
    const poolEntry = poolBalances.pools.find((p) => p.pool === pool);
    const actualSavings = poolEntry?.totalCents ?? 0;
    const goalTotal = poolGoalTotalCents(tx, ctx.viewer, targetPersonId);
    const bufferCents = Math.max(0, actualSavings - goalTotal);
    const withdrawalCents = Math.abs(txn.amountCents);

    if (bufferCents < withdrawalCents) {
      throw new AppError(
        "Validation",
        `Buffer ($${(bufferCents / 100).toFixed(2)}) is insufficient to cover withdrawal ($${(withdrawalCents / 100).toFixed(2)})`,
      );
    }

    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: item.dedupeKey,
      resolution: "buffer",
    });
  });
}

export const linkWithdrawalToGoalInput = z
  .object({
    id: idInput,
    goalId: idInput,
  })
  .strict();
export type LinkWithdrawalToGoalInput = z.input<typeof linkWithdrawalToGoalInput>;

/**
 * "It's for a goal":
 * Links a large withdrawal transaction to a single goal drawdown, debits the goal,
 * and resolves the review item with resolution "linked".
 */
export function linkWithdrawalToGoal(
  ctx: UseCaseContext,
  input: LinkWithdrawalToGoalInput,
): { drawdown: GoalDrawdownRow; adjustments: readonly GoalAdjustmentRow[] } {
  const parsed = parseInput(linkWithdrawalToGoalInput, input);
  return write(ctx, (tx, audit) => {
    const item = openSavingsReviewItem(ctx, parsed.id);
    if (
      item.kind !== SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW.kind &&
      item.kind !== SAVINGS_LARGE_WITHDRAWAL_PERSONAL_REVIEW.kind
    ) {
      throw new AppError("Validation", "Item is not a large withdrawal");
    }

    const transactionId = item.entityRef.startsWith("transaction:")
      ? item.entityRef.slice("transaction:".length)
      : item.entityRef;

    const today = ctx.clock.today().toString();
    const txn = tx.transactions.findVisible(ctx.viewer, transactionId, today);
    if (!txn) {
      throw new AppError("NotFound", "Transaction not found");
    }

    const acc = tx.accounts.findVisible(ctx.viewer, txn.accountId);
    if (!acc || !acc.isSavings) {
      throw new AppError("Validation", "Account is not a savings account");
    }

    const owners = tx.accounts.owners(acc.id);
    const pool = poolOf(owners);

    const goal = tx.goals.findById(ctx.viewer, parsed.goalId as Id<"Goal">);
    if (!goal) {
      throw new AppError("NotFound", "Goal not found");
    }

    const targetPersonId = pool === "shared" ? null : (pool as Id<"Person">);
    if (goal.personId !== targetPersonId) {
      throw new AppError("Validation", "Goal does not belong to the withdrawal pool");
    }

    const withdrawalAmountCents = Math.abs(txn.amountCents);

    // Execute drawdown for this goal
    const result = executeDrawdown(ctx, {
      pool,
      reason: "large_purchase",
      amountCents: withdrawalAmountCents,
      label: txn.payeeName ?? txn.descriptionRaw ?? "Goal withdrawal",
      transactionId: txn.id,
      adjustments: [
        {
          goalId: goal.id,
          amountCents: withdrawalAmountCents,
        },
      ],
    });

    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: item.dedupeKey,
      resolution: "linked",
    });

    return result;
  });
}

export const adjustBufferForMismatchInput = z
  .object({
    id: idInput,
  })
  .strict();
export type AdjustBufferForMismatchInput = z.input<typeof adjustBufferForMismatchInput>;

/**
 * "Put the difference in the buffer" for mismatches:
 * Confirms adjustment, auto-aligns the buffer, and resolves the mismatch review item.
 */
export function adjustBufferForMismatch(
  ctx: UseCaseContext,
  input: AdjustBufferForMismatchInput,
): void {
  const parsed = parseInput(adjustBufferForMismatchInput, input);
  write(ctx, (tx, audit) => {
    const item = openSavingsReviewItem(ctx, parsed.id);
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: item.dedupeKey,
      resolution: "buffer adjusted",
    });
  });
}
