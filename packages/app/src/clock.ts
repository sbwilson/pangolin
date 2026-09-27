import { type PlainDate, parseDate, Temporal } from "@pangolin/shared/temporal";
import type { Clock } from "./ports/clock.ts";

/**
 * The real clock, with "today" taken in `timeZone` (the household time zone, an IANA name).
 * `source` supplies the current instant; it defaults to the system clock and exists so tests
 * can check the zone conversion without reading the real time.
 * Throws `RangeError` for an unknown time zone.
 */
export function systemClock(
  timeZone: string,
  source: () => Temporal.Instant = () => Temporal.Now.instant(),
): Clock {
  // Validate the zone up front, without reading the clock.
  Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timeZone);
  return {
    now: source,
    today: () => source().toZonedDateTimeISO(timeZone).toPlainDate(),
  };
}

/**
 * A clock stopped at `date`. `now()` returns `instant`, or midnight UTC at the start of
 * `date` when no instant is given. For tests, seeds and demo mode.
 */
export function fixedClock(date: PlainDate, instant?: Temporal.Instant): Clock {
  const at = instant ?? date.toZonedDateTime("UTC").toInstant();
  return { today: () => date, now: () => at };
}

/**
 * `fixedClock` at midnight UTC on a `YYYY-MM-DD` string, for callers that may not import
 * `@pangolin/shared/temporal` (e.g. the server's demo mode). Throws `RangeError` for a bad date.
 */
export function fixedClockAt(isoDate: string): Clock {
  return fixedClock(parseDate(isoDate));
}
