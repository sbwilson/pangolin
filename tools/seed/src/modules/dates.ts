// Date helpers for the ledger modules: the 12 months before the seed's "today", and the
// recurring dates (monthly, fortnightly, quarterly) that fall in it. Only `shared/temporal`.
import { formatDate, type PlainDate, Temporal } from "@pangolin/shared/temporal";

/** The seed's ledger window: inclusive `start` and `end` (today). */
export interface Window {
  readonly start: PlainDate;
  readonly end: PlainDate;
}

/** The 12 months before `today`: from the day after the same date a year back, to `today`. */
export function windowOf(today: PlainDate): Window {
  return { start: today.subtract({ months: 12 }).add({ days: 1 }), end: today };
}

/** The day before the window opens: where opening balances are stated. */
export function openingDay(window: Window): PlainDate {
  return window.start.subtract({ days: 1 });
}

export function inWindow(window: Window, date: PlainDate): boolean {
  return (
    Temporal.PlainDate.compare(date, window.start) >= 0 &&
    Temporal.PlainDate.compare(date, window.end) <= 0
  );
}

export function iso(date: PlainDate): string {
  return formatDate(date);
}

/** The date `day` of every month the window touches (clamped to short months) inside it. */
export function monthlyOn(window: Window, day: number): PlainDate[] {
  return everyMonth(window, 1, 0, day);
}

/** The date `day` of every `step`-th month, starting `offset` months into the window's first month. */
export function everyMonth(window: Window, step: number, offset: number, day: number): PlainDate[] {
  const out: PlainDate[] = [];
  let month = window.start.toPlainYearMonth().add({ months: offset });
  const last = window.end.toPlainYearMonth();
  while (Temporal.PlainYearMonth.compare(month, last) <= 0) {
    const date = Temporal.PlainDate.from(
      { year: month.year, month: month.month, day },
      { overflow: "constrain" },
    );
    if (inWindow(window, date)) out.push(date);
    month = month.add({ months: step });
  }
  return out;
}

/** `first`, then every `days` days after it, while inside the window. */
export function everyDays(window: Window, first: PlainDate, days: number): PlainDate[] {
  const out: PlainDate[] = [];
  for (
    let date = first;
    Temporal.PlainDate.compare(date, window.end) <= 0;
    date = date.add({ days })
  ) {
    if (inWindow(window, date)) out.push(date);
  }
  return out;
}

/** The last day of every month that ends inside the window, strictly before its last day. */
export function monthEnds(window: Window): PlainDate[] {
  const out: PlainDate[] = [];
  let month = window.start.toPlainYearMonth();
  for (;;) {
    const end = month.toPlainDate({ day: month.daysInMonth });
    if (Temporal.PlainDate.compare(end, window.end) >= 0) break;
    if (inWindow(window, end)) out.push(end);
    month = month.add({ months: 1 });
  }
  return out;
}

/** `date` moved by `days` (positive or negative), or `null` when that leaves the window. */
export function shifted(window: Window, date: PlainDate, days: number): PlainDate | null {
  const moved = date.add({ days });
  return inWindow(window, moved) ? moved : null;
}
