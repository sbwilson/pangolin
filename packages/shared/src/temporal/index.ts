// The single entry point for dates and times (AD-14). Everything else imports `Temporal`,
// `PlainDate` and the date helpers from `@pangolin/shared/temporal`, never from the polyfill.
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import { z } from "zod";

/** The native global `Temporal` where the runtime has one, otherwise `temporal-polyfill`. */
export const Temporal: typeof TemporalPolyfill =
  (globalThis as { Temporal?: typeof TemporalPolyfill }).Temporal ?? TemporalPolyfill;

// Type-only namespace so `Temporal.Instant` etc. work as types alongside the value above.
export declare namespace Temporal {
  export type PlainDate = TemporalPolyfill.PlainDate;
  export type PlainTime = TemporalPolyfill.PlainTime;
  export type PlainDateTime = TemporalPolyfill.PlainDateTime;
  export type PlainYearMonth = TemporalPolyfill.PlainYearMonth;
  export type PlainMonthDay = TemporalPolyfill.PlainMonthDay;
  export type Instant = TemporalPolyfill.Instant;
  export type ZonedDateTime = TemporalPolyfill.ZonedDateTime;
  export type Duration = TemporalPolyfill.Duration;

  export type CalendarLike = TemporalPolyfill.CalendarLike;
  export type DurationLike = TemporalPolyfill.DurationLike;
  export type InstantLike = TemporalPolyfill.InstantLike;
  export type PlainDateLike = TemporalPolyfill.PlainDateLike;
  export type PlainDateTimeLike = TemporalPolyfill.PlainDateTimeLike;
  export type PlainMonthDayLike = TemporalPolyfill.PlainMonthDayLike;
  export type PlainTimeLike = TemporalPolyfill.PlainTimeLike;
  export type PlainYearMonthLike = TemporalPolyfill.PlainYearMonthLike;
  export type TimeZoneLike = TemporalPolyfill.TimeZoneLike;
  export type ZonedDateTimeLike = TemporalPolyfill.ZonedDateTimeLike;
  export type PartialTemporalLike<T extends object> = TemporalPolyfill.PartialTemporalLike<T>;

  export type DateLikeObject = TemporalPolyfill.DateLikeObject;
  export type DateTimeLikeObject = TemporalPolyfill.DateTimeLikeObject;
  export type DurationLikeObject = TemporalPolyfill.DurationLikeObject;
  export type TimeLikeObject = TemporalPolyfill.TimeLikeObject;
  export type YearMonthLikeObject = TemporalPolyfill.YearMonthLikeObject;
  export type ZonedDateTimeLikeObject = TemporalPolyfill.ZonedDateTimeLikeObject;
}

/** A calendar date with no time or zone. Business dates are always this type. */
export type PlainDate = TemporalPolyfill.PlainDate;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a wire date. Only `YYYY-MM-DD` is accepted, and the date must exist
 * (`2026-02-30` and `2026-2-3` both throw `RangeError`).
 */
export function parseDate(value: string): PlainDate {
  if (!DATE_RE.test(value)) {
    throw new RangeError(`Not a YYYY-MM-DD date: ${JSON.stringify(value)}`);
  }
  // An ISO string with an out-of-range day throws RangeError here rather than clamping.
  return Temporal.PlainDate.from(value, { overflow: "reject" });
}

/** Formats a date for the wire as `YYYY-MM-DD`. Years outside 0000–9999 throw `RangeError`. */
export function formatDate(date: PlainDate): string {
  const text = date.toString({ calendarName: "never" });
  if (!DATE_RE.test(text)) {
    throw new RangeError(`Date has no YYYY-MM-DD form: ${text}`);
  }
  return text;
}

/** Zod schema for a wire date: a `YYYY-MM-DD` string in, a `PlainDate` out. */
export const plainDateSchema = z.string().transform((value, ctx): PlainDate => {
  try {
    return parseDate(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Expected a valid YYYY-MM-DD date" });
    return z.NEVER;
  }
});
