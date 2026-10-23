import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import {
  REPORT_BY,
  type ReportBy,
  type ReportRow,
  rangeInput,
  readBreakdown,
  section,
} from "./breakdown.ts";

/** The input of `reports.spending`: an inclusive range and what the rows are grouped by. */
export const spendingInput = rangeInput({ by: z.enum(REPORT_BY) });
export type SpendingInput = z.input<typeof spendingInput>;

/** Spending over `from`..`to` (inclusive) as the viewer sees it. */
export interface SpendingReport {
  readonly from: string;
  readonly to: string;
  readonly by: ReportBy;
  /** Equals cash flow's money out. */
  readonly totalCents: number;
  readonly rows: ReportRow[];
}

/**
 * `reports.spending`: the P&L expense section alone, the `expense` splits the viewer can see in
 * the range summed per category group or category, as positive cents (AD-23).
 */
export function spending(ctx: UseCaseContext, input: SpendingInput): SpendingReport {
  const q = parseInput(spendingInput, input);
  const expense = section(readBreakdown(ctx, { from: q.from, to: q.to }), "expense", q.by);
  return { from: q.from, to: q.to, by: q.by, ...expense };
}
