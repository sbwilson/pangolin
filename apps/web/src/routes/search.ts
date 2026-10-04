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
