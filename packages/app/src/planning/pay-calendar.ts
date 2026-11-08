// Resolution of PayCalendar (AD-14, AD-25).
import type { Cadence, PayCalendar, PayPeriod, Period } from "@pangolin/shared/period";
import {
  createCalendarPayCalendar,
  nextPeriod,
  periodContaining,
  rollBackToBusinessDay,
} from "@pangolin/shared/period";
import type { PlainDate } from "@pangolin/shared/temporal";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import type { UseCaseContext } from "../context.ts";
import type { PayAnchorRow } from "../ports/unit-of-work.ts";
import { detectPayDeposits } from "./detect-pay-deposits.ts";

export function payAnchorCadence(anchor: PayAnchorRow): Cadence {
  if (anchor.cadence === "fortnightly") {
    if (!anchor.anchorDate) {
      throw new Error(`PayAnchor ${anchor.id} has fortnightly cadence without anchorDate`);
    }
    return {
      kind: "fortnightly",
      anchor: parseDate(anchor.anchorDate),
    };
  }
  if (!anchor.dayOfMonth) {
    throw new Error(`PayAnchor ${anchor.id} has monthly cadence without dayOfMonth`);
  }
  return {
    kind: "monthly",
    day: anchor.dayOfMonth,
  };
}

/**
 * Resolves a PayCalendar for the given PayAnchor.
 * - When alignment is 'calendar', uses calendar cadence rule with expected paydays rolled back to previous business day if weekend.
 * - When alignment is 'deposit', boundaries follow detected salary/pay deposits in anchor's deposit account.
 *   If no qualifying deposit is found or for periods beyond the latest deposit, cleanly falls back to the calendar rule.
 */
export function resolvePayCalendar(ctx: UseCaseContext, anchor: PayAnchorRow): PayCalendar {
  const cadence = payAnchorCadence(anchor);
  const today = ctx.clock.today();

  if (anchor.alignment === "calendar") {
    return createCalendarPayCalendar(anchor.id, cadence, today);
  }

  // alignment === 'deposit'
  const deposits = detectPayDeposits(ctx, anchor);

  if (deposits.length === 0) {
    // Clean fallback to calendar rule
    return createCalendarPayCalendar(anchor.id, cadence, today);
  }

  // We have deposits. Build historical pay periods aligned to deposits.
  // A deposit on D starts a pay period at D.
  // The next period starts at the next deposit D_next. So the period is [D, D_next).
  // For the period after the latest deposit D_last:
  // its start is D_last, and its end is predicted from calendar cadence or next cycle.
  // For dates before the first deposit or after the latest deposit, fallback to calendar intervals.

  function calendarPeriod(p: Period): PayPeriod {
    const expectedPayDate = rollBackToBusinessDay(p.start);
    const isProjected = Temporal.PlainDate.compare(p.start, today) > 0;
    return {
      start: p.start,
      end: p.end,
      expectedPayDate,
      actualPayDate: null,
      isProjected,
    };
  }

  // Map each deposit into a period:
  // Deposit i: start = deposits[i].postedOn
  // If i+1 exists: end = deposits[i+1].postedOn
  // If i is the last deposit:
  //   period end is calculated using cadence from start
  const depositPeriods: PayPeriod[] = [];
  for (let i = 0; i < deposits.length; i++) {
    const dep = deposits[i]!;
    const start = dep.postedOn;
    let end: PlainDate;
    if (i + 1 < deposits.length) {
      end = deposits[i + 1]?.postedOn;
    } else {
      // Last deposit: end follows calendar cadence from this start
      if (cadence.kind === "fortnightly") {
        end = start.add({ days: 14 });
      } else {
        // Monthly from start
        const nextMonth = start.toPlainYearMonth().add({ months: 1 });
        const day = Math.min(cadence.day, nextMonth.daysInMonth);
        end = nextMonth.toPlainDate({ day });
      }
    }
    const expectedPayDate = rollBackToBusinessDay(start);
    const isProjected = Temporal.PlainDate.compare(start, today) > 0;
    depositPeriods.push({
      start,
      end,
      expectedPayDate,
      actualPayDate: dep.postedOn,
      isProjected,
    });
  }

  const firstDepositDate = deposits[0]?.postedOn;
  const lastDepositPeriod = depositPeriods[depositPeriods.length - 1]!;

  function getPeriodContaining(date: PlainDate): PayPeriod {
    // If date is before first deposit date, fall back to calendar rule
    if (Temporal.PlainDate.compare(date, firstDepositDate) < 0) {
      return calendarPeriod(periodContaining(cadence, date));
    }

    // Check if within any deposit period
    for (const dp of depositPeriods) {
      if (
        Temporal.PlainDate.compare(date, dp.start) >= 0 &&
        Temporal.PlainDate.compare(date, dp.end) < 0
      ) {
        return dp;
      }
    }

    // If date is at or after the end of the last deposit period:
    // Future periods project forward using the calendar rule!
    let cur: Period = {
      start: lastDepositPeriod.end,
      end:
        cadence.kind === "fortnightly"
          ? lastDepositPeriod.end.add({ days: 14 })
          : (() => {
              const m = lastDepositPeriod.end.toPlainYearMonth().add({ months: 1 });
              return m.toPlainDate({ day: Math.min(cadence.day, m.daysInMonth) });
            })(),
    };

    while (Temporal.PlainDate.compare(date, cur.end) >= 0) {
      cur = nextPeriod(cadence, cur);
    }
    return calendarPeriod(cur);
  }

  return {
    anchorId: anchor.id,
    cadence,
    alignment: "deposit",
    periodContaining: getPeriodContaining,
    periodsBetween(from: PlainDate, to: PlainDate): readonly PayPeriod[] {
      if (Temporal.PlainDate.compare(from, to) >= 0) return [];
      const result: PayPeriod[] = [];
      let cur = getPeriodContaining(from);
      while (Temporal.PlainDate.compare(cur.start, to) < 0) {
        result.push(cur);
        cur = getPeriodContaining(cur.end);
      }
      return result;
    },
  };
}
