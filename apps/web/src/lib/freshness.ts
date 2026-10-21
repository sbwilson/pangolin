import type { LastImport } from "../api.ts";

/** An account is stale once its last import runs through a day more than this many days old. */
export const STALE_AFTER_DAYS = 45;

const DAY_MS = 86_400_000;
// Spelled out: `Intl` writes September "Sept" in some engines and "Sep" in others.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utcMs = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);

/** True when `newest` (`YYYY-MM-DD`, the import's `through`) is more than 45 days before `today`; no date is never stale. */
export function isStale(newest: string | null, today: string): boolean {
  if (newest === null) return false;
  return Math.round((utcMs(today) - utcMs(newest)) / DAY_MS) > STALE_AFTER_DAYS;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The time of day of an ISO instant in the viewer's zone, as `HH:MM`. */
function clockTime(instant: string): string {
  const d = new Date(instant);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "imported up to 30 Sep from ofx, 14:05" for the account's last import (the day its data runs
 * to, the source and the time it ran), or "No imports yet".
 */
export function freshnessLabel(last: LastImport | null): string {
  if (last === null) return "No imports yet";
  const day = `${Number(last.through.slice(8, 10))} ${MONTHS[Number(last.through.slice(5, 7)) - 1]}`;
  return `imported up to ${day} from ${last.source}, ${clockTime(last.importedAt)}`;
}
