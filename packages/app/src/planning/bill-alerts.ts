// Bill alert review item generator (AD-3, AD-17, AD-22, CAP-5).
import { getPaymentMatchingWindow, isPaymentPastDueWindow, isPriceRise } from "@pangolin/domain";
import { parseDate } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import type { RecurringSeriesRow, ReviewItemRow, TxRepos } from "../ports/unit-of-work.ts";
import { defineReviewKind, raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import type { Audit } from "../write.ts";
import { write } from "../write.ts";

/**
 * Review kind for missed bill payments.
 * Scope is "account" (AD-3, AD-22): only users who can see that account can see this alert.
 */
export const BILL_ALERT_MISSED_PAYMENT_REVIEW = defineReviewKind({
  kind: "planning.bill_alert.missed_payment",
  module: "planning",
  scope: "account",
});

/**
 * Review kind for bill price rises (>10%).
 * Scope is "account" (AD-3, AD-22).
 */
export const BILL_ALERT_PRICE_RISE_REVIEW = defineReviewKind({
  kind: "planning.bill_alert.price_rise",
  module: "planning",
  scope: "account",
});

export const BILL_ALERT_REVIEW_KINDS = [
  BILL_ALERT_MISSED_PAYMENT_REVIEW.kind,
  BILL_ALERT_PRICE_RISE_REVIEW.kind,
] as const;

/**
 * Deterministic dedupe key for a missed payment alert:
 * `bill:missed:<seriesId>:<expectedDate>`
 */
export function billMissedPaymentDedupeKey(seriesId: string, expectedDate: string): string {
  return `bill:missed:${seriesId}:${expectedDate}`;
}

/**
 * Deterministic dedupe key for a price rise alert:
 * `bill:price_rise:<seriesId>:<transactionId>`
 */
export function billPriceRiseDedupeKey(seriesId: string, transactionId: string): string {
  return `bill:price_rise:${seriesId}:${transactionId}`;
}

/**
 * Deterministic entityRef for recurring series:
 * `recurring_series:<seriesId>`
 */
export function recurringSeriesEntityRef(seriesId: string): string {
  return `recurring_series:${seriesId}`;
}

/**
 * Deterministic entityRef for transaction:
 * `transaction:<transactionId>`
 */
export function transactionEntityRef(transactionId: string): string {
  return `transaction:${transactionId}`;
}

export const dismissBillAlertReviewItemInput = z
  .object({
    id: idInput,
  })
  .strict();
export type DismissBillAlertReviewItemInput = z.input<typeof dismissBillAlertReviewItemInput>;

function openBillAlertReviewItem(ctx: UseCaseContext, id: string): ReviewItemRow {
  const item = ctx.uow
    .read((repos) => repos.reviewItems.listOpenFor(ctx.viewer))
    .find((row) => row.id === id);

  if (item === undefined || !(BILL_ALERT_REVIEW_KINDS as readonly string[]).includes(item.kind)) {
    throw new AppError("NotFound", "Review item not found");
  }
  return item;
}

/**
 * Dismisses a bill alert review item with resolution "acknowledged".
 */
export function dismissBillAlertReviewItem(
  ctx: UseCaseContext,
  input: DismissBillAlertReviewItemInput,
): void {
  const parsed = parseInput(dismissBillAlertReviewItemInput, input);
  write(ctx, (tx, audit) => {
    const item = openBillAlertReviewItem(ctx, parsed.id);
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: item.dedupeKey,
      resolution: "acknowledged",
    });
  });
}

/**
 * Evaluates and syncs bill alerts for a single recurring series:
 * - Checks for matching payments in `[nextDueOn - graceDays, today]`.
 * - If past due window and no matching payment: raises missed payment alert.
 * - If matching payment exists: auto-resolves any open missed payment alert with "paid".
 * - For matching payments: if amount represents a price rise > 10%, raises price rise alert.
 */
export function syncBillAlertsForSeries(
  tx: TxRepos,
  audit: Audit,
  ctx: UseCaseContext,
  series: RecurringSeriesRow,
): void {
  // Only evaluate confirmed bill series
  if (series.status !== "confirmed" || series.direction !== "bill") {
    return;
  }

  const today = ctx.clock.today();
  const nextDue = parseDate(series.nextDueOn);
  const { windowStart, windowEnd } = getPaymentMatchingWindow(nextDue, today, series.cadence);

  // List visible transactions for the series account
  const txns = tx.transactions.listVisible(ctx.viewer, today.toString());
  const windowStartStr = windowStart.toString();
  const windowEndStr = windowEnd.toString();

  // Find candidate payments:
  // - matching accountId and payeeId
  // - postedOn within matching window [windowStart, windowEnd]
  // - bill expense (amountCents < 0)
  // - not an internal transfer (transferGroupId === null)
  const matchingPayments = txns.filter((t) => {
    if (t.accountId !== series.accountId) return false;
    if (t.payeeId !== series.payeeId) return false;
    if (t.transferGroupId !== null) return false;
    if (t.amountCents >= 0) return false;
    return t.postedOn >= windowStartStr && t.postedOn <= windowEndStr;
  });

  const missedDedupeKey = billMissedPaymentDedupeKey(series.id, series.nextDueOn);
  const seriesRef = recurringSeriesEntityRef(series.id);

  if (matchingPayments.length > 0) {
    // A matching payment exists in the window -> resolve any open missed payment alert
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: missedDedupeKey,
      resolution: "paid",
    });

    // Check matching payments for price rises > 10%
    for (const payment of matchingPayments) {
      if (isPriceRise(payment.amountCents, series.expectedCents)) {
        const priceRiseKey = billPriceRiseDedupeKey(series.id, payment.id);
        raiseReviewItem(tx, audit, ctx, {
          kind: BILL_ALERT_PRICE_RISE_REVIEW,
          accountId: series.accountId,
          entityRef: seriesRef,
          dedupeKey: priceRiseKey,
        });
      }
    }
  } else {
    // No matching payment found in window
    if (isPaymentPastDueWindow(nextDue, today, series.cadence)) {
      raiseReviewItem(tx, audit, ctx, {
        kind: BILL_ALERT_MISSED_PAYMENT_REVIEW,
        accountId: series.accountId,
        entityRef: seriesRef,
        dedupeKey: missedDedupeKey,
      });
    }
  }
}

/**
 * Evaluates and syncs all bill alerts across all confirmed recurring series visible to viewer
 * (or system-wide when running under system viewer).
 */
export function syncAllBillAlertReviewItems(ctx: UseCaseContext): number {
  return write(ctx, (tx, audit) => {
    const seriesList = tx.recurringSeries.listVisible(ctx.viewer, {
      status: "confirmed",
    });

    for (const series of seriesList) {
      syncBillAlertsForSeries(tx, audit, ctx, series);
    }

    return seriesList.length;
  });
}
