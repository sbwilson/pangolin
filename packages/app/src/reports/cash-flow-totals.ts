import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import { dayInput } from "../inputs.ts";
import type { CashFlowTotals } from "../ports/unit-of-work.ts";

/** The input of `reports.cashFlowTotals`: an inclusive range of posting days, `from ≤ to`. */
export const cashFlowTotalsInput = z
  .object({ from: dayInput, to: dayInput })
  .strict()
  .refine((q) => q.from <= q.to, { message: "from is after to", path: ["from"] });
export type CashFlowTotalsInput = z.input<typeof cashFlowTotalsInput>;

/** Money in, money out and kept over `from`..`to` (inclusive), as the viewer sees them. */
export interface CashFlowReport extends CashFlowTotals {
  readonly from: string;
  readonly to: string;
}

/**
 * `reports.cashFlowTotals`: money in (the `income` splits), money out (the `expense` splits) and
 * kept (in − out, may be negative) over every split the viewer can see whose transaction is
 * posted in the range, pending or posted. Each split is classed by `flowKind` (AD-23) in SQL;
 * transfers and investing count in neither figure. A transfer to an account the viewer cannot
 * see is a transfer whatever its type, so the partner's figures never depend on the other
 * person's private data (AD-3). A household total: it may differ between the two partners.
 */
export function cashFlowTotals(ctx: UseCaseContext, input: CashFlowTotalsInput): CashFlowReport {
  const range = parseInput(cashFlowTotalsInput, input);
  const today = ctx.clock.today().toString();
  const totals = ctx.uow.read((repos) =>
    repos.transactions.cashFlowTotals(ctx.viewer, today, range),
  );
  return { from: range.from, to: range.to, ...totals };
}
