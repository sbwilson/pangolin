// Pure net-worth projection (8.5): one monthly series from today's figures. No I/O, no clock:
// the app supplies today's asset pot, flat card liabilities, loan starting balances and terms,
// the monthly savings/super contributions and this line's annual return. Each month adds the
// contributions to the pot, compounds the pot at the return, and re-reads every loan's balance
// from its amortisation schedule — a loan without complete terms is held flat, so the walk
// never stalls on missing data. The same input with a higher return can only land higher:
// the lines share everything else, and the grown pot is assets-only (never negative).
import { Decimal } from "@pangolin/shared";
import type { PlainDate } from "@pangolin/shared/temporal";
import {
  type MortgageSchedule,
  type MortgageScheduleInput,
  mortgageSchedule,
} from "../amortise/mortgage-schedule.ts";

/** The horizons the projection offers, in years from `startDate`. */
export const NET_WORTH_PROJECTION_HORIZONS = [1, 2, 5, 10] as const;
export type NetWorthProjectionHorizon = (typeof NET_WORTH_PROJECTION_HORIZONS)[number];

/** Private decimal context: the same one `mortgageSchedule` walks the loan in. */
const ProjectionDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** Replicates the private `DECIMAL_STRING_RE` in `shared/money.ts`: plain decimal strings only. */
const DECIMAL_STRING_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * One open home loan as the walk sees it. The projection covers every open visible loan:
 * a complete `annualRatePercent` + `monthlyRepaymentCents` pair amortises it via
 * `mortgageSchedule`; anything else keeps its balance at today's value forever.
 */
export interface NetWorthLoanInput {
  /** Outstanding today: positive safe-integer cents owed (0 or less = nothing to pay down). */
  readonly principalCents: number;
  /** Annual rate as a decimal-string percent (`"6.175"` is 6.175% p.a.), or null = no terms. */
  readonly annualRatePercent: string | null;
  /** The nominal monthly repayment in positive cents, or null = no terms. */
  readonly monthlyRepaymentCents: number | null;
  /**
   * Balance sitting against this loan all term (the open-offset pool when its selection
   * counts offsets; 0 otherwise). Interest never accrues on the offset, never on a negative base.
   */
  readonly offsetCents: number;
}

export interface NetWorthProjectionInput {
  /** Today: series point 0, and the first repayment month of every amortising loan. */
  readonly startDate: PlainDate;
  /** 1, 2, 5 or 10 years; each series carries `horizonYears × 12 + 1` points. */
  readonly horizonYears: NetWorthProjectionHorizon;
  /** Today's visible assets: the pot the line starts from. Never negative. */
  readonly assetsCents: number;
  /** Credit-card balances in signed cents (positive owed): subtracted flat every point. */
  readonly creditCardCents: number;
  readonly loans: readonly NetWorthLoanInput[];
  /** Added to the pot before compounding each month (savings-rate share of income). */
  readonly monthlySavingsCents: number;
  /** Added to the pot before compounding each month (super-rate share of income). */
  readonly monthlySuperCents: number;
  /** This line's annual return as a decimal-string percent: `"5"` is 5% p.a. Never negative. */
  readonly annualReturnPercent: string;
}

/** One month of the walk. Point 0 is `startDate`; point m is `startDate + m` months. */
export interface NetWorthProjectionPoint {
  /** 0-based month index from `startDate`. */
  readonly month: number;
  readonly date: PlainDate;
  readonly netWorthCents: number;
}

export interface NetWorthProjection {
  readonly points: readonly NetWorthProjectionPoint[];
}

/**
 * Validates a safe-integer cent amount and returns it, normalising -0 to 0 the way
 * `shared/money.ts` `cents()` does. Throws `RangeError` for anything else.
 */
function requireCents(name: string, value: number, nonNegative: boolean): number {
  if (!Number.isSafeInteger(value) || (nonNegative && value < 0)) {
    throw new RangeError(
      `projectNetWorth: ${name} must be a ${nonNegative ? "non-negative " : ""}safe-integer cent value, got ${value}`,
    );
  }
  return value === 0 ? 0 : value;
}

/** Validates a non-negative finite decimal-string percent. Throws `RangeError` for anything else. */
function requirePercent(name: string, value: string): void {
  if (!DECIMAL_STRING_RE.test(value)) {
    throw new RangeError(
      `projectNetWorth: ${name} is not a decimal string: ${JSON.stringify(value)}`,
    );
  }
  const percent = new ProjectionDecimal(value);
  if (!percent.isFinite() || percent.isNegative()) {
    throw new RangeError(
      `projectNetWorth: ${name} must be a non-negative finite percent, got ${value}`,
    );
  }
}

/**
 * `mortgageSchedule` for one loan, or null when its terms cannot amortise (a repayment below
 * the first month's interest, a term past 1200 months). A stored assumption must not break the
 * view: such a loan is held flat by the caller. Anything that is not a `RangeError` rethrows.
 */
function buildSchedule(input: MortgageScheduleInput): MortgageSchedule | null {
  try {
    return mortgageSchedule(input);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return null;
  }
}

/**
 * One loan's balance per month, indexed like the series (0 = today). With complete terms the
 * balance follows `mortgageSchedule` to `monthsToPayoff` and stays 0 after; without them — or
 * when the terms cannot amortise — the balance is held at `principalCents` forever.
 */
function loanBalances(
  loan: NetWorthLoanInput,
  startDate: PlainDate,
  months: number,
): readonly number[] {
  const heldFlat = (): readonly number[] => new Array<number>(months + 1).fill(loan.principalCents);
  const { annualRatePercent, monthlyRepaymentCents } = loan;
  if (loan.principalCents <= 0 || annualRatePercent === null || monthlyRepaymentCents === null) {
    return heldFlat();
  }

  const schedule = buildSchedule({
    principalCents: loan.principalCents,
    annualRatePercent,
    monthlyRepaymentCents,
    offsetCents: loan.offsetCents,
    startDate,
  });
  if (schedule === null) return heldFlat();

  const balances: number[] = [loan.principalCents];
  for (let month = 1; month <= months; month++) {
    balances.push(month <= schedule.monthsToPayoff ? schedule.rows[month - 1]!.closingCents : 0);
  }
  return balances;
}

/**
 * Walks `horizonYears × 12` months: the pot starts at `assetsCents`; each month adds
 * `monthlySavingsCents + monthlySuperCents`, then compounds at `annualReturnPercent ÷ 1200`
 * rounded half-even. Each point is `pot − Σ loan balances − creditCardCents`, so point 0 is
 * today's net worth of exactly the figures supplied. Throws `RangeError` for invalid input.
 */
export function projectNetWorth(input: NetWorthProjectionInput): NetWorthProjection {
  if (!NET_WORTH_PROJECTION_HORIZONS.includes(input.horizonYears)) {
    throw new RangeError(
      `projectNetWorth: horizonYears must be one of ${NET_WORTH_PROJECTION_HORIZONS.join(", ")}; got ${String(input.horizonYears)}`,
    );
  }
  requireCents("assetsCents", input.assetsCents, true);
  requireCents("creditCardCents", input.creditCardCents, false);
  requireCents("monthlySavingsCents", input.monthlySavingsCents, true);
  requireCents("monthlySuperCents", input.monthlySuperCents, true);
  requirePercent("annualReturnPercent", input.annualReturnPercent);
  for (const loan of input.loans) {
    requireCents("loan.principalCents", loan.principalCents, false);
    requireCents("loan.offsetCents", loan.offsetCents, true);
    if (loan.annualRatePercent !== null) {
      requirePercent("loan.annualRatePercent", loan.annualRatePercent);
    }
    if (loan.monthlyRepaymentCents !== null) {
      requireCents("loan.monthlyRepaymentCents", loan.monthlyRepaymentCents, true);
      if (loan.monthlyRepaymentCents === 0) {
        throw new RangeError("projectNetWorth: loan.monthlyRepaymentCents must be positive");
      }
    }
  }

  const months = input.horizonYears * 12;
  const series = input.loans.map((loan) => loanBalances(loan, input.startDate, months));
  const monthlyContribution = input.monthlySavingsCents + input.monthlySuperCents;
  const factor = new ProjectionDecimal(1).plus(
    new ProjectionDecimal(input.annualReturnPercent).dividedBy(1200),
  );

  let potCents = input.assetsCents;
  const points: NetWorthProjectionPoint[] = [];
  for (let month = 0; month <= months; month++) {
    if (month > 0) {
      potCents += monthlyContribution;
      potCents = new ProjectionDecimal(potCents)
        .times(factor)
        .toDecimalPlaces(0, ProjectionDecimal.ROUND_HALF_EVEN)
        .toNumber();
    }
    let loanCents = 0;
    for (const balances of series) loanCents += balances[month]!;
    points.push({
      month,
      date: input.startDate.add({ months: month }),
      netWorthCents: potCents - loanCents - input.creditCardCents,
    });
  }

  return { points };
}
