import type { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { LeakMerchantRow } from "../ports/unit-of-work.ts";
import { rangeInput } from "./breakdown.ts";

/** The input of `reports.leaks`: an inclusive range (`from <= to`). */
export const leaksInput = rangeInput({});
export type LeaksInput = z.input<typeof leaksInput>;

export type LeakMerchant = LeakMerchantRow;

/** Leaks report over `from`..`to` (inclusive) as the viewer sees them. */
export interface LeaksReport {
  readonly from: string;
  readonly to: string;
  readonly rows: LeakMerchant[];
}

/**
 * `reports.leaks`: top five merchants with at least 4 visible expense transactions and a median
 * transaction amount <= $25 in `from`..`to` as `visibleTxn` projects it. Payees of transactions
 * with hidden names or scoped to another person never qualify (AD-4, AD-18).
 */
export function leaks(ctx: UseCaseContext, input: LeaksInput): LeaksReport {
  const q = parseInput(leaksInput, input);
  const today = ctx.clock.today().toString();
  const rows = ctx.uow.read((repos) => repos.transactions.merchantLeaks(ctx.viewer, today, q));
  return { from: q.from, to: q.to, rows };
}
