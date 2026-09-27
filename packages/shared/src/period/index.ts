// Period and financial-year maths (AD-14). Pure: no clock, no I/O.
// Periods are half-open `[start, end)` in code and shown inclusive on screen.
// Payday business-day roll-back and pay-deposit alignment (`PayCalendar`) belong to epic 6.
import { type PlainDate, Temporal } from "../temporal/index.ts";

/** How a pay anchor's periods repeat under `calendar` alignment. */
export type Cadence =
  /** Every 14 days, counted from `anchor` in both directions. */
  | { readonly kind: "fortnightly"; readonly anchor: PlainDate }
  /** Monthly on `day` (1–31), clamped to the last day of shorter months. */
  | { readonly kind: "monthly"; readonly day: number };

/** A half-open date range `[start, end)`. */
export interface Period {
  readonly start: PlainDate;
  readonly end: PlainDate;
}

/** An Australian financial year, labelled by the year it ends. `end` is exclusive. */
export interface FinancialYear {
  readonly label: `FY${number}`;
  readonly start: PlainDate;
  readonly end: PlainDate;
}

const FORTNIGHT_DAYS = 14;

function assertCadence(cadence: Cadence): void {
  if (cadence.kind === "monthly") {
    if (!Number.isInteger(cadence.day) || cadence.day < 1 || cadence.day > 31) {
      throw new RangeError(`Monthly cadence day must be an integer 1..31, got ${cadence.day}`);
    }
  }
}

/** The monthly boundary in a given month: `day`, or the month's last day if shorter. */
function monthBoundary(month: Temporal.PlainYearMonth, day: number): PlainDate {
  return month.toPlainDate({ day: Math.min(day, month.daysInMonth) });
}

/** The period of `cadence` that contains `date`. */
export function periodContaining(cadence: Cadence, date: PlainDate): Period {
  assertCadence(cadence);
  if (cadence.kind === "fortnightly") {
    const days = cadence.anchor.until(date, { largestUnit: "days" }).days;
    const offset = Math.floor(days / FORTNIGHT_DAYS) * FORTNIGHT_DAYS;
    const start = cadence.anchor.add({ days: offset });
    return { start, end: start.add({ days: FORTNIGHT_DAYS }) };
  }
  const thisMonth = date.toPlainYearMonth();
  const boundary = monthBoundary(thisMonth, cadence.day);
  const startMonth =
    Temporal.PlainDate.compare(date, boundary) >= 0 ? thisMonth : thisMonth.subtract({ months: 1 });
  return {
    start: monthBoundary(startMonth, cadence.day),
    end: monthBoundary(startMonth.add({ months: 1 }), cadence.day),
  };
}

/** The period straight after `period`. */
export function nextPeriod(cadence: Cadence, period: Period): Period {
  return periodContaining(cadence, period.end);
}

/** The period straight before `period`. */
export function previousPeriod(cadence: Cadence, period: Period): Period {
  return periodContaining(cadence, period.start.subtract({ days: 1 }));
}

/** The financial year ending on 30 June of `year`: FY2025 is `[2024-07-01, 2025-07-01)`. */
export function fyRange(year: number): FinancialYear {
  if (!Number.isInteger(year)) {
    throw new RangeError(`FY year must be an integer, got ${year}`);
  }
  return {
    label: `FY${year}`,
    start: Temporal.PlainDate.from({ year: year - 1, month: 7, day: 1 }),
    end: Temporal.PlainDate.from({ year, month: 7, day: 1 }),
  };
}

/** The financial year containing `date`. */
export function fyOf(date: PlainDate): FinancialYear {
  return fyRange(date.month >= 7 ? date.year + 1 : date.year);
}
