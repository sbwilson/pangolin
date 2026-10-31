// Pay deposit detection (AD-14, AD-25).
import type { PlainDate } from "@pangolin/shared/temporal";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import type { UseCaseContext } from "../context.ts";
import type { PayAnchorRow } from "../ports/unit-of-work.ts";

export interface DetectedPayDeposit {
  readonly transactionId: string;
  readonly postedOn: PlainDate;
  readonly amountCents: number;
  readonly descriptionRaw: string;
}

/**
 * Detects pay deposits in the linked account for the given pay anchor.
 * Qualifying deposits:
 * 1. Must be in the anchor's `accountId`.
 * 2. Amount is positive income (`amountCents > 0`).
 * 3. Matches expected net pay (within a reasonable 10% tolerance if expectedNetCents is set),
 *    or description indicates pay/salary (e.g. includes "salary", "pay", "payroll", "wages").
 */
export function detectPayDeposits(
  ctx: UseCaseContext,
  anchor: PayAnchorRow,
  options?: { readonly from?: PlainDate; readonly to?: PlainDate },
): readonly DetectedPayDeposit[] {
  const today = ctx.clock.today().toString();
  // Read all transactions visible to the viewer in the anchor's account
  const txns = ctx.uow.read((repos) =>
    repos.transactions.listPage(
      ctx.viewer,
      today,
      {
        accountId: anchor.accountId,
        type: "in",
        from: options?.from?.toString(),
        to: options?.to?.toString(),
      },
      { offset: 0 },
      1000,
    ),
  );

  const deposits: DetectedPayDeposit[] = [];

  for (const txn of txns) {
    if (txn.accountId !== anchor.accountId) continue;
    if (txn.amountCents <= 0) continue;

    let matches = false;

    // 1. Check expectedNetCents if set (tolerance: ±10%)
    if (anchor.expectedNetCents !== null && anchor.expectedNetCents > 0) {
      const diff = Math.abs(txn.amountCents - anchor.expectedNetCents);
      const tolerance = Math.round(anchor.expectedNetCents * 0.1);
      if (diff <= tolerance) {
        matches = true;
      }
    }

    // 2. Check payee or description keywords: match whole words "salary", "payroll", "wages",
    // or specific phrases like "direct credit pay", avoiding generic "pay" (e.g. BPAY, Apple Pay, PayPal).
    const desc = (txn.descriptionRaw ?? "").toLowerCase();
    const payee = (txn.payeeName ?? "").toLowerCase();
    const isPayKeyword =
      /\b(salary|payroll|wages)\b/i.test(desc) ||
      /\b(salary|payroll|wages)\b/i.test(payee) ||
      /\bdirect credit.*pay\b/i.test(desc) ||
      /\bpay\s*(salary|period|run)\b/i.test(desc);

    if (isPayKeyword) {
      matches = true;
    }

    // If expectedNetCents was null and no keywords matched, but it's an income deposit and no other filter:
    // If neither expectedNetCents nor keywords matched, we don't treat it as pay deposit.

    if (matches) {
      deposits.push({
        transactionId: txn.id,
        postedOn: parseDate(txn.postedOn),
        amountCents: txn.amountCents,
        descriptionRaw: txn.descriptionRaw ?? "",
      });
    }
  }

  // Sort deposits ascending by postedOn date
  deposits.sort((a, b) => Temporal.PlainDate.compare(a.postedOn, b.postedOn));

  return deposits;
}
