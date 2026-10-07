/**
 * The text search of the transaction list. One parser serves the SQLite index (FTS5) and the
 * in-memory adapter, so the two agree: a query is split on whitespace, every term is cut into
 * the same tokens FTS5's `unicode61` tokenizer makes (letters and digits, case and accents
 * folded), a term matches a field when its tokens appear next to each other in it with the last
 * one a prefix, and every term must match (AND). Punctuation and operators (`"`, `*`, `AND`)
 * are only ever text, so no input can be an FTS syntax error. A term with no tokens is dropped, and
 * only the first `SEARCH_MAX_TERMS` terms are used.
 * A query that is a plain amount also matches rows by `abs(amountCents)` (sign ignored): `142`
 * is $142.00 to $142.99, `142.8` is $142.80 to $142.89, `142.85` exactly $142.85.
 */

/** The longest query a search takes. */
export const SEARCH_QUERY_MAX = 200;

/** The most terms a search uses; further terms are ignored, so a query stays cheap to run. */
export const SEARCH_MAX_TERMS = 8;

/** Tokens of `text` as the `unicode61` tokenizer makes them. */
export function searchTokens(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** The inclusive range of `abs(amountCents)` a numeric query matches. */
export interface AmountMagnitude {
  readonly minCents: number;
  readonly maxCents: number;
}

export interface ParsedSearch {
  /** One token list per term (at least one, or `magnitude` is set). */
  readonly terms: readonly (readonly string[])[];
  readonly magnitude?: AmountMagnitude | undefined;
}

const AMOUNT = /^[-+]?\$?(\d{1,3}(?:,\d{3})+|\d{1,12})(?:\.(\d{1,2}))?$/;

/** The magnitude range for a query that is an amount, else undefined. */
export function amountMagnitude(query: string): AmountMagnitude | undefined {
  const match = AMOUNT.exec(query.trim());
  if (match === null) return undefined;
  const dollars = Number((match[1] as string).replaceAll(",", ""));
  const fraction = match[2];
  const base = dollars * 100;
  if (fraction === undefined) return { minCents: base, maxCents: base + 99 };
  if (fraction.length === 1) {
    const tens = Number(fraction) * 10;
    return { minCents: base + tens, maxCents: base + tens + 9 };
  }
  return { minCents: base + Number(fraction), maxCents: base + Number(fraction) };
}

/** The search in `query`, or undefined when it holds nothing to search for (no filter). */
export function parseSearch(query: string): ParsedSearch | undefined {
  const terms = query
    .split(/\s+/)
    .map(searchTokens)
    .filter((tokens) => tokens.length > 0)
    .slice(0, SEARCH_MAX_TERMS);
  const magnitude = amountMagnitude(query);
  if (terms.length === 0 && magnitude === undefined) return undefined;
  return { terms, magnitude };
}

/**
 * Whether every term matches in `fields` (each field a string, matched on its own: a phrase
 * never spans two fields).
 */
export function searchMatches(terms: readonly (readonly string[])[], fields: readonly string[]) {
  const tokenised = fields.map(searchTokens);
  return terms.every((term) => tokenised.some((tokens) => hasPhrase(tokens, term)));
}

function hasPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  const last = phrase.length - 1;
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j <= last && ok; j++) {
      const token = tokens[i + j] as string;
      const want = phrase[j] as string;
      ok = j === last ? token.startsWith(want) : token === want;
    }
    if (ok) return true;
  }
  return false;
}
