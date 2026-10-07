/** A date range as the URL holds it: inclusive `YYYY-MM-DD` ends. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const day = (year: number, month: number, date: number) => `${year}-${pad(month)}-${pad(date)}`;

/** The calendar day of `date` in the browser's time zone, as `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  return day(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** The last day of `month` (1 to 12) of `year`. */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The quarter that contains `today` (`YYYY-MM-DD`): Jan to Mar, Apr to Jun, Jul to Sep, Oct to
 * Dec. An Australian financial year starts on 1 July, so these are its quarters too.
 */
export function quarterRange(today: string): DateRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  const last = first + 2;
  return { from: day(year, first, 1), to: day(year, last, lastDay(year, last)) };
}

/** From 1 July of the financial year that contains `today` up to and including `today`. */
export function fyToDateRange(today: string): DateRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return { from: day(month >= 7 ? year : year - 1, 7, 1), to: today };
}

/** Which preset `from` and `to` are, `custom` when they are set but match neither, else `none`. */
export function rangeKind(
  from: string | undefined,
  to: string | undefined,
  today: string,
): "quarter" | "fy" | "custom" | "none" {
  if (from === undefined && to === undefined) return "none";
  const quarter = quarterRange(today);
  if (from === quarter.from && to === quarter.to) return "quarter";
  const fy = fyToDateRange(today);
  if (from === fy.from && to === fy.to) return "fy";
  return "custom";
}
