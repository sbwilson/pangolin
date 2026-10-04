// The one place a hidden name becomes text (AD-4). The SQL projections in `packages/db` have
// already nulled every hidden name, so `redact` decides nothing: it renders the placeholder for
// rows the adapter flagged, once, on everything that leaves `app` (API responses, exports,
// audit-log reads and review items). Notes and everything else stay as they are.
import { parseDate } from "@pangolin/shared/temporal";
import type { Viewer } from "./viewer.ts";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "Hidden until 12 Mar 2027" for a `YYYY-MM-DD` date or an ISO timestamp starting with one. */
export function hiddenLabel(until: string | null): string {
  if (until === null) return "Hidden";
  const date = parseDate(until.slice(0, 10));
  return `Hidden until ${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}

function scrubJson(json: unknown, label: string): unknown {
  if (typeof json !== "string") return json;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return json;
  return JSON.stringify({ ...parsed, descriptionRaw: label });
}

function redactRow(row: object): object {
  const r = row as Record<string, unknown>;
  // A transaction read: the projection flagged it.
  if (r.nameHidden === true) {
    const label = hiddenLabel(typeof r.nameHiddenUntil === "string" ? r.nameHiddenUntil : null);
    return { ...r, descriptionRaw: label, ...("payeeName" in r ? { payeeName: label } : {}) };
  }
  // An audit read: the projection flagged it and removed the name from the JSON.
  if (r.entity === "transaction" && typeof r.hiddenUntil === "string") {
    const label = hiddenLabel(r.hiddenUntil);
    return { ...r, before: scrubJson(r.before, label), after: scrubJson(r.after, label) };
  }
  return row;
}

/**
 * Renders hidden names as "Hidden until <date>". Throws without a viewer. Rows the adapter did
 * not flag (review items, other audit rows) come back unchanged.
 */
export function redact<T extends object>(viewer: Viewer | undefined, rows: readonly T[]): T[] {
  if (viewer === undefined || viewer === null) {
    throw new TypeError("redact: a viewer is required");
  }
  return rows.map((row) => redactRow(row) as T);
}
