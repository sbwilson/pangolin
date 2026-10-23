import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import { byAmountThenName, rangeInput, readBreakdown } from "./breakdown.ts";

export const MERCHANT_FLOWS = ["income", "expense"] as const;
export type MerchantFlow = (typeof MERCHANT_FLOWS)[number];

/** The input of `reports.merchants`: an inclusive range and which side of the flow. */
export const merchantsInput = rangeInput({ flow: z.enum(MERCHANT_FLOWS) });
export type MerchantsInput = z.input<typeof merchantsInput>;

/**
 * One merchant (payee) row. `payeeId: null` is one bucket for rows with no payee, a name hidden
 * from the viewer, or a payee scoped to another person (AD-4, AD-18).
 */
export interface MerchantRow {
  readonly payeeId: string | null;
  readonly payeeName: string | null;
  readonly cents: number;
}

/** Merchants over `from`..`to` (inclusive) as the viewer sees them. */
export interface MerchantsReport {
  readonly from: string;
  readonly to: string;
  readonly flow: MerchantFlow;
  /** Equals cash flow's money in (`income`) or money out (`expense`). */
  readonly totalCents: number;
  readonly rows: MerchantRow[];
}

/**
 * `reports.merchants`: the splits of one flow kind the viewer can see in the range, summed per
 * payee as `visibleTxn` projects it, never by the raw payee id, so a hidden name never groups
 * or names a row (AD-4). Positive cents, sorted by amount, then name, then id.
 */
export function merchants(ctx: UseCaseContext, input: MerchantsInput): MerchantsReport {
  const q = parseInput(merchantsInput, input);
  const sums = new Map<string | null, MerchantRow>();
  let totalCents = 0;
  for (const r of readBreakdown(ctx, { from: q.from, to: q.to })) {
    if (r.kind !== q.flow) continue;
    totalCents += r.cents;
    const before = sums.get(r.payeeId);
    sums.set(r.payeeId, {
      payeeId: r.payeeId,
      payeeName: r.payeeName,
      cents: (before?.cents ?? 0) + r.cents,
    });
  }
  const rows = [...sums.values()].sort(
    byAmountThenName(
      (r) => r.payeeName,
      (r) => r.payeeId,
    ),
  );
  return { from: q.from, to: q.to, flow: q.flow, totalCents, rows };
}
