/** `?token=` of a one-time link: a non-empty string, else absent (a bad value falls back). */
export function validateTokenSearch(search: Record<string, unknown>): { token?: string } {
  const { token } = search;
  return typeof token === "string" && token !== "" ? { token } : {};
}

/** Paths that carry a one-time link's token. */
const LINK_PATHS = ["/setup", "/recover"];

/**
 * What the root layout does with a location's search: the token is read only on `/setup` and
 * `/recover`, and any search at all on those paths is stripped (valid or not).
 */
export function oneTimeLink(
  pathname: string,
  search: Record<string, unknown>,
): { token: string; strip: boolean } {
  if (!LINK_PATHS.includes(pathname)) return { token: "", strip: false };
  return { token: validateTokenSearch(search).token ?? "", strip: Object.keys(search).length > 0 };
}

/** Search parsing that keeps every value a string (the default would JSON-parse "1e5" to a number). */
export function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** The filters, date range and paging position of `/transactions`, all strings in the URL. */
export interface TransactionsSearch {
  readonly account?: string;
  readonly from?: string;
  readonly to?: string;
  readonly category?: string;
  readonly tag?: string;
  readonly payee?: string;
  readonly minCents?: string;
  readonly maxCents?: string;
  readonly type?: "in" | "out";
  readonly uncategorised?: "true";
  readonly transfers?: "true";
  readonly hidden?: "true";
  readonly page?: string;
  readonly after?: string;
  readonly before?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The server's limit on `page`. */
const MAX_PAGE = 1_000_000;

/** A real calendar date: `2026-02-30` is not one. */
function isRealDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}
const CURSOR = /^\d{4}-\d{2}-\d{2}~[0-9A-Za-z_-]{1,100}$/;
const WORD = /^[0-9A-Za-z_-]{1,100}$/;
const COUNT = /^\d{1,15}$/;

/**
 * What `/transactions` reads from the URL: a known name with a well-formed value is kept, anything
 * else (an unknown name, a bad value) is dropped, so a mistyped link still opens the list. The
 * server validates again; this keeps a bad value from reaching it.
 */
export function validateTransactionsSearch(search: object): TransactionsSearch {
  const out: Record<string, string> = {};
  const keep = (name: string, ok: (v: string) => boolean) => {
    const value = (search as Record<string, unknown>)[name];
    if (typeof value === "string" && ok(value)) out[name] = value;
  };
  for (const name of ["account", "category", "tag", "payee"]) keep(name, (v) => WORD.test(v));
  for (const name of ["from", "to"]) keep(name, isRealDay);
  for (const name of ["minCents", "maxCents"]) keep(name, (v) => COUNT.test(v));
  keep("type", (v) => v === "in" || v === "out");
  for (const name of ["uncategorised", "transfers", "hidden"]) keep(name, (v) => v === "true");
  keep("page", (v) => /^[1-9]\d{0,6}$/.test(v) && Number(v) <= MAX_PAGE);
  for (const name of ["after", "before"]) keep(name, (v) => CURSOR.test(v));
  // What the server would refuse: a reversed pair is dropped whole, and only one paging position
  // stays (a cursor beats a page number, `after` beats `before`).
  if (out.from !== undefined && out.to !== undefined && out.from > out.to) {
    delete out.from;
    delete out.to;
  }
  if (out.minCents !== undefined && out.maxCents !== undefined) {
    if (Number(out.minCents) > Number(out.maxCents)) {
      delete out.minCents;
      delete out.maxCents;
    }
  }
  if (out.after !== undefined) delete out.before;
  if (out.after !== undefined || out.before !== undefined) delete out.page;
  return out as TransactionsSearch;
}

/** The part of `search` that narrows rows: everything but the paging position. */
export function filtersOf(search: TransactionsSearch): TransactionsSearch {
  const { page: _p, after: _a, before: _b, ...filters } = search;
  return filters;
}

/** Whether a filter other than the date range narrows the list (what Clear filters resets). */
export function hasClearableFilters(search: TransactionsSearch): boolean {
  const { from: _f, to: _t, ...rest } = filtersOf(search);
  return Object.keys(rest).length > 0;
}

/** Whether any filter, the date range included, narrows the list. */
export function hasFilters(search: TransactionsSearch): boolean {
  return Object.keys(filtersOf(search)).length > 0;
}

/** `search` with every filter cleared but the date range, and back on the first page. */
export function clearedFilters(search: TransactionsSearch): TransactionsSearch {
  return {
    ...(search.from === undefined ? {} : { from: search.from }),
    ...(search.to === undefined ? {} : { to: search.to }),
  };
}
