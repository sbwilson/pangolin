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

/** What a range steps by on `/cash-flow`: an aligned quarter, a financial year, or its length. */
export type RangeUnit = "quarter" | "fy" | "custom";

/** Days since 1970-01-01 of a `YYYY-MM-DD` day. */
const dayNumber = (value: string) =>
  Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) /
  86_400_000;
/** The `YYYY-MM-DD` of a day number. */
const fromDayNumber = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** True when `range` is one whole calendar quarter (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec). */
function isQuarter(range: DateRange): boolean {
  if (!/^\d{4}-(01|04|07|10)-01$/.test(range.from)) return false;
  return quarterRange(range.from).to === range.to;
}

/** The financial year (labelled by the year it ends) that `range` is, whole or to date, if any. */
function fyOf(range: DateRange, today: string): number | undefined {
  if (!/^\d{4}-07-01$/.test(range.from)) return undefined;
  const start = Number(range.from.slice(0, 4));
  if (range.to === day(start + 1, 6, 30)) return start + 1;
  const current = fyToDateRange(today);
  if (range.from === current.from && range.to === current.to) return start + 1;
  return undefined;
}

/**
 * The unit of `range`: `quarter` for any aligned calendar quarter, `fy` for 1 July to 30 June of
 * any year or 1 July to `today` of the current financial year, else `custom`.
 */
export function rangeUnit(range: DateRange, today: string): RangeUnit {
  if (isQuarter(range)) return "quarter";
  if (fyOf(range, today) !== undefined) return "fy";
  return "custom";
}

/**
 * `range` moved one step back (`-1`) or on (`1`) by its unit: a quarter by a quarter; a financial
 * year by a year, the current one to `today`; a custom range by its own length in days.
 */
export function stepRange(range: DateRange, direction: -1 | 1, today: string): DateRange {
  const unit = rangeUnit(range, today);
  if (unit === "quarter") {
    const year = Number(range.from.slice(0, 4));
    const month = Number(range.from.slice(5, 7)) + direction * 3;
    const from =
      month < 1
        ? day(year - 1, month + 12, 1)
        : month > 12
          ? day(year + 1, month - 12, 1)
          : day(year, month, 1);
    return quarterRange(from);
  }
  if (unit === "fy") {
    const start = Number(range.from.slice(0, 4)) + direction;
    const next = { from: day(start, 7, 1), to: day(start + 1, 6, 30) };
    const current = fyToDateRange(today);
    return next.from === current.from ? current : next;
  }
  const length = dayNumber(range.to) - dayNumber(range.from) + 1;
  const shift = direction * length;
  return {
    from: fromDayNumber(dayNumber(range.from) + shift),
    to: fromDayNumber(dayNumber(range.to) + shift),
  };
}

/** True when stepping `range` on would start after `today`, so the next chevron is disabled. */
export function isLastStep(range: DateRange, today: string): boolean {
  return stepRange(range, 1, today).from > today;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (value: string) => MONTHS[Number(value.slice(5, 7)) - 1] as string;
const dateOf = (value: string) => `${Number(value.slice(8, 10))} ${monthOf(value)}`;

/**
 * The header label of `range`: "Jul – Sep 2026" for a quarter, "FY2026" for a whole financial
 * year and "FY2027 to date" for the current one, else the days: "3 Feb – 14 Mar 2026", with each
 * year when the ends fall in different years, or one day alone.
 */
export function rangeLabel(range: DateRange, today: string): string {
  const year = range.to.slice(0, 4);
  if (isQuarter(range)) return `${monthOf(range.from)} – ${monthOf(range.to)} ${year}`;
  const fy = fyOf(range, today);
  if (fy !== undefined) return range.to.endsWith("-06-30") ? `FY${fy}` : `FY${fy} to date`;
  if (range.from === range.to) return `${dateOf(range.from)} ${year}`;
  const fromYear = range.from.slice(0, 4);
  return fromYear === year
    ? `${dateOf(range.from)} – ${dateOf(range.to)} ${year}`
    : `${dateOf(range.from)} ${fromYear} – ${dateOf(range.to)} ${year}`;
}
