import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import {
  REPORT_BY,
  type ReportBy,
  type ReportSection,
  rangeInput,
  readBreakdown,
  section,
} from "./breakdown.ts";

/** The input of `reports.profitAndLoss`: an inclusive range and what the rows are grouped by. */
export const profitAndLossInput = rangeInput({ by: z.enum(REPORT_BY) });
export type ProfitAndLossInput = z.input<typeof profitAndLossInput>;

/** P&L over `from`..`to` (inclusive) as the viewer sees it. */
export interface ProfitAndLossReport {
  readonly from: string;
  readonly to: string;
  readonly by: ReportBy;
  /** The `income` splits; `totalCents` equals cash flow's money in. */
  readonly income: ReportSection;
  /** The `expense` splits, positive; `totalCents` equals cash flow's money out. */
  readonly expense: ReportSection;
  /** The uncategorised splits of each section (also each section's `id: null` row). */
  readonly uncategorised: { readonly inCents: number; readonly outCents: number };
}

/**
 * `reports.profitAndLoss`: the `income` and `expense` splits the viewer can see in the range,
 * summed per category group or per category (with its group), soft-deleted categories included
 * under their own names. Transfers and investing appear nowhere (AD-23). A household total: it
 * may differ between the two partners, and never depends on the other person's private data.
 */
export function profitAndLoss(ctx: UseCaseContext, input: ProfitAndLossInput): ProfitAndLossReport {
  const q = parseInput(profitAndLossInput, input);
  const rows = readBreakdown(ctx, { from: q.from, to: q.to });
  const income = section(rows, "income", q.by);
  const expense = section(rows, "expense", q.by);
  const uncategorised = (s: ReportSection) => s.rows.find((r) => r.id === null)?.cents ?? 0;
  return {
    from: q.from,
    to: q.to,
    by: q.by,
    income,
    expense,
    uncategorised: { inCents: uncategorised(income), outCents: uncategorised(expense) },
  };
}
