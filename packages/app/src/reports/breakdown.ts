// The shared fold of the report breakdown (story 4.2): P&L, spending and merchants are sums of the
// same `flowBreakdown` rows (AD-23), so the three use cases cannot disagree. Folding integer
// cents here is server-side summing; the web only formats.
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { dayInput } from "../inputs.ts";
import type { DayRange, FlowBreakdownRow } from "../ports/unit-of-work.ts";

/** An inclusive range of posting days with more fields; `from ≤ to`. */
export function rangeInput<S extends z.ZodRawShape>(shape: S) {
  return z
    .object({ from: dayInput, to: dayInput, ...shape })
    .strict()
    .refine((q) => (q as DayRange).from <= (q as DayRange).to, {
      message: "from is after to",
      path: ["from"],
    });
}

/** What a P&L or spending section is grouped by. */
export const REPORT_BY = ["group", "category"] as const;
export type ReportBy = (typeof REPORT_BY)[number];

/**
 * One row of a P&L or spending section: a category group, or a category with its group. The
 * uncategorised row has `id` (and the group fields) null. `cents` is positive for money in and
 * money out alike.
 */
export interface ReportRow {
  readonly id: string | null;
  readonly name: string | null;
  /** By `category` only: the category's group (null for the uncategorised row). */
  readonly groupId?: string | null;
  readonly groupName?: string | null;
  readonly cents: number;
}

/** A section of a report: its rows and their total. */
export interface ReportSection {
  readonly totalCents: number;
  readonly rows: ReportRow[];
}

/** The breakdown rows the viewer may see over `range`. */
export function readBreakdown(ctx: UseCaseContext, range: DayRange): FlowBreakdownRow[] {
  const today = ctx.clock.today().toString();
  return ctx.uow.read((repos) => repos.transactions.flowBreakdown(ctx.viewer, today, range));
}

/** Text order with null after every name. */
function nullsLast(x: string | null | undefined, y: string | null | undefined): number {
  const a = x ?? null;
  const b = y ?? null;
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Amount descending, then name, then id (nulls last). */
export function byAmountThenName<R extends { cents: number }>(
  name: (row: R) => string | null,
  id: (row: R) => string | null,
): (x: R, y: R) => number {
  return (x, y) => y.cents - x.cents || nullsLast(name(x), name(y)) || nullsLast(id(x), id(y));
}

/** The rows of one kind summed per group or category, sorted, with their total. */
export function section(
  rows: readonly FlowBreakdownRow[],
  kind: FlowBreakdownRow["kind"],
  by: ReportBy,
): ReportSection {
  const sums = new Map<string | null, ReportRow>();
  let totalCents = 0;
  for (const r of rows) {
    if (r.kind !== kind) continue;
    totalCents += r.cents;
    const id = by === "group" ? r.groupId : r.categoryId;
    const before = sums.get(id);
    const cents = (before?.cents ?? 0) + r.cents;
    sums.set(
      id,
      by === "group"
        ? { id, name: r.groupName, cents }
        : { id, name: r.categoryName, groupId: r.groupId, groupName: r.groupName, cents },
    );
  }
  const sorted = [...sums.values()].sort(
    byAmountThenName(
      (r) => r.name,
      (r) => r.id,
    ),
  );
  return { totalCents, rows: sorted };
}
