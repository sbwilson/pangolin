const LONG_DAY = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** The line a hidden row carries for the partner who may not see its name. */
export const WINK_LINE = "Shh, it's a surprise.";

/** "12 March 2027" for a `YYYY-MM-DD` date or an ISO timestamp that starts with one. */
export function longDay(value: string): string {
  return LONG_DAY.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

/**
 * What the partner's hidden row is called: "Hidden until 12 March 2027". The server's own label
 * uses a short month, so the web formats the date itself from `nameHiddenUntil`.
 */
export function hiddenUntilLabel(until: string | null): string {
  return until === null ? "Hidden" : `Hidden until ${longDay(until)}`;
}

/** `YYYY-MM-DD` of `date` in UTC, the day the server compares a hiding's end against. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** True while a hiding is in force: its end day is after `utcToday` (`YYYY-MM-DD`, UTC). */
export function hidingActive(until: string | null, utcToday: string): boolean {
  return until !== null && until.slice(0, 10) > utcToday;
}
