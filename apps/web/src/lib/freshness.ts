/** An account is stale once its newest transaction is more than this many days old. */
export const STALE_AFTER_DAYS = 45;

const DAY_MS = 86_400_000;
// Spelled out: `Intl` writes September "Sept" in some engines and "Sep" in others.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utcMs = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);

/** True when `newest` (`YYYY-MM-DD`) is more than 45 days before `today`; no date is never stale. */
export function isStale(newest: string | null, today: string): boolean {
  if (newest === null) return false;
  return Math.round((utcMs(today) - utcMs(newest)) / DAY_MS) > STALE_AFTER_DAYS;
}

/** "to 30 Sep" for the day an account's data runs to, or "No transactions yet". */
export function freshnessLabel(newest: string | null): string {
  if (newest === null) return "No transactions yet";
  return `to ${Number(newest.slice(8, 10))} ${MONTHS[Number(newest.slice(5, 7)) - 1]}`;
}
