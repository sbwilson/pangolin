import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { CashFlowTotals } from "../ports/unit-of-work.ts";
import { rangeInput } from "./breakdown.ts";
import { sharedApportionment, viewerShareCents } from "./shared-apportionment.ts";

/**
 * The input of `reports.cashFlowTotals`: an inclusive range of posting days, `from ≤ to`, and
 * optionally `share`: `mine` scopes money out to the viewer's share of shared spending.
 */
export const cashFlowTotalsInput = rangeInput({ share: z.enum(["everything", "mine"]).optional() });
export type CashFlowTotalsInput = z.input<typeof cashFlowTotalsInput>;

/** Money in, money out and kept over `from`..`to` (inclusive), as the viewer sees them. */
export interface CashFlowReport extends CashFlowTotals {
  readonly from: string;
  readonly to: string;
  /**
   * Kept ÷ money in, in thousandths, rounded half away from zero; may be negative. Null when
   * money in is zero or less.
   */
  readonly savingsRatePermille: number | null;
}

/**
 * Kept ÷ money in as an integer permille, rounded half away from zero (a ratio, not money, so
 * AD-13's two rounding functions do not apply); null when `moneyInCents ≤ 0`. Exact integer
 * arithmetic, so no float ever decides a half.
 */
export function savingsRatePermille(keptCents: number, moneyInCents: number): number | null {
  if (moneyInCents <= 0) return null;
  const n = BigInt(keptCents) * 1000n;
  const d = BigInt(moneyInCents);
  const magnitude = ((n < 0n ? -n : n) * 2n + d) / (2n * d);
  return Number(n < 0n ? -magnitude : magnitude) || 0;
}

/**
 * `reports.cashFlowTotals`: money in (the `income` splits), money out (the `expense` splits) and
 * kept (in − out, may be negative) over every split the viewer can see whose transaction is
 * posted in the range, pending or posted. Each split is classed by `flowKind` (AD-23) in SQL;
 * transfers and investing count in neither figure. A transfer to an account the viewer cannot
 * see is a transfer whatever its type, so the partner's figures never depend on the other
 * person's private data (AD-3). A household total: it may differ between the two partners.
 *
 * With `share: "mine"`, money out is the viewer's visible money out with the part whose
 * beneficiary is `shared` replaced by their apportioned share of the shared total (from
 * `sharedApportionment`); money in is unchanged and kept follows. A person viewer only.
 */
export function cashFlowTotals(ctx: UseCaseContext, input: CashFlowTotalsInput): CashFlowReport {
  const { share, ...range } = parseInput(cashFlowTotalsInput, input);
  const today = ctx.clock.today().toString();
  if (share === "mine" && ctx.viewer.kind !== "person") {
    throw new AppError("Validation", "My share needs a signed-in person");
  }
  const scope =
    share === "mine"
      ? { mineShareCents: viewerShareCents(ctx, sharedApportionment(ctx, range)) }
      : undefined;
  const totals = ctx.uow.read((repos) =>
    repos.transactions.cashFlowTotals(ctx.viewer, today, range, scope),
  );
  return {
    from: range.from,
    to: range.to,
    ...totals,
    savingsRatePermille: savingsRatePermille(totals.keptCents, totals.moneyInCents),
  };
}
