// Pure mortgage amortisation (AD-13 money, AD-14 dates). No I/O, no clock: interest accrues
// monthly on the balance net of an offset, the constant repayment splits into interest and
// principal, and an extra repayment goes to principal only — shortening the term, never the
// payment. The net-worth projection and the loan schedule both walk this schedule.
import { Decimal } from "@pangolin/shared";
import type { PlainDate } from "@pangolin/shared/temporal";

/** Termination guard: a term running past 100 years is input error, not a mortgage. */
const MAX_MONTHS = 1200;

/** Private decimal context: the same one `shared/money.ts` rounds money in. */
const ScheduleDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** Replicates the private `DECIMAL_STRING_RE` in `shared/money.ts`: plain decimal strings only. */
const DECIMAL_STRING_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export interface MortgageScheduleInput {
  /** The amount borrowed. A positive safe-integer number of cents. */
  readonly principalCents: number;
  /** Annual rate as a decimal-string percent: `"6.175"` is 6.175% p.a. Never a float (AD-13). */
  readonly annualRatePercent: string;
  /** The nominal monthly repayment, which never changes. A positive safe-integer number of cents. */
  readonly monthlyRepaymentCents: number;
  /**
   * Balance sitting against the loan all term. Interest accrues on (balance − offset), never on
   * the offset, and never on a negative base. 0 means no offset.
   */
  readonly offsetCents?: number;
  /** Principal-only repayment applied after the scheduled one each month. Defaults to 0. */
  readonly extraRepaymentCents?: number;
  /** The date of the first repayment month; month `m` falls on `startDate + (m − 1)` months. */
  readonly startDate: PlainDate;
}

/** One month of the walk. The nominal repayment is `interestCents + scheduledPrincipalCents`. */
export interface MortgageScheduleRow {
  /** 1-based month index. */
  readonly month: number;
  readonly date: PlainDate;
  readonly openingCents: number;
  /** Interest on `(openingCents − offset)` clamped at 0, rounded half-even. */
  readonly interestCents: number;
  /** Repayment minus interest, clamped to the balance — so it is never negative. */
  readonly scheduledPrincipalCents: number;
  /** The extra repayment actually applied, clamped to what the repayment left outstanding. */
  readonly extraPrincipalCents: number;
  readonly closingCents: number;
}

export interface MortgageSchedule {
  readonly rows: readonly MortgageScheduleRow[];
  readonly totalInterestCents: number;
  readonly monthsToPayoff: number;
  readonly payoffDate: PlainDate;
}

/**
 * Validates a safe-integer cent amount within `positive` bounds (throws `RangeError`) and
 * returns it. Normalises -0 to 0 the way `shared/money.ts` `cents()` does, so -0 can never
 * reach a row.
 */
function requireCents(name: string, value: number, positive: boolean): number {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new RangeError(
      `mortgageSchedule: ${name} must be a ${positive ? "positive" : "non-negative"} safe-integer cent value, got ${value}`,
    );
  }
  return value === 0 ? 0 : value;
}

/**
 * Walks the loan month by month until the balance reaches exactly 0: interest on
 * `max(0, opening − offsetCents)` at `annualRatePercent ÷ 1200` rounded half-even, then the
 * scheduled repayment split interest-first, then the extra repayment as principal clamped to
 * what remains. Throws `RangeError` for invalid input, for a loan whose first-month interest
 * reaches the repayment, and for a term that would run past 1200 months.
 */
export function mortgageSchedule(input: MortgageScheduleInput): MortgageSchedule {
  requireCents("principalCents", input.principalCents, true);
  requireCents("monthlyRepaymentCents", input.monthlyRepaymentCents, true);
  const offsetCents = requireCents("offsetCents", input.offsetCents ?? 0, false);
  const extraRepaymentCents = requireCents(
    "extraRepaymentCents",
    input.extraRepaymentCents ?? 0,
    false,
  );

  if (!DECIMAL_STRING_RE.test(input.annualRatePercent)) {
    throw new RangeError(
      `mortgageSchedule: annualRatePercent is not a decimal string: ${JSON.stringify(input.annualRatePercent)}`,
    );
  }
  const annualRate = new ScheduleDecimal(input.annualRatePercent);
  if (!annualRate.isFinite() || annualRate.isNegative()) {
    throw new RangeError(
      `mortgageSchedule: annualRatePercent must be a non-negative finite rate, got ${input.annualRatePercent}`,
    );
  }

  const rows: MortgageScheduleRow[] = [];
  let totalInterestCents = 0;
  let openingCents = input.principalCents;
  for (let month = 1; ; month++) {
    if (month > MAX_MONTHS) {
      throw new RangeError(
        `mortgageSchedule: the loan does not amortise within ${MAX_MONTHS} months; check the repayment`,
      );
    }

    // The offset reduces the interest base only; it never earns interest itself.
    const interestBaseCents = Math.max(0, openingCents - offsetCents);
    const interestCents = new ScheduleDecimal(interestBaseCents)
      .times(annualRate)
      .dividedBy(1200)
      .toDecimalPlaces(0, ScheduleDecimal.ROUND_HALF_EVEN)
      .toNumber();
    if (month === 1 && interestCents >= input.monthlyRepaymentCents) {
      throw new RangeError(
        `mortgageSchedule: first-month interest ${interestCents} reaches the repayment ${input.monthlyRepaymentCents}; the balance would never fall`,
      );
    }

    // The nominal repayment never changes; the final month clamps payment to interest + balance.
    const scheduledPrincipalCents = Math.min(
      input.monthlyRepaymentCents - interestCents,
      openingCents,
    );
    const extraPrincipalCents = Math.min(
      extraRepaymentCents,
      openingCents - scheduledPrincipalCents,
    );
    const closingCents = openingCents - scheduledPrincipalCents - extraPrincipalCents;

    const date = input.startDate.add({ months: month - 1 });
    rows.push({
      month,
      date,
      openingCents,
      interestCents,
      scheduledPrincipalCents,
      extraPrincipalCents,
      closingCents,
    });
    totalInterestCents += interestCents;
    if (closingCents === 0) {
      return { rows, totalInterestCents, monthsToPayoff: month, payoffDate: date };
    }
    openingCents = closingCents;
  }
}
