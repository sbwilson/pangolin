import { parseSearch } from "../ledger/search-query.ts";
import type { FewShotExample, ReadRepos, TxRepos } from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";

export type { FewShotExample };

export interface FewShotSearchInput {
  readonly query: string;
  readonly limit?: number;
}

/**
 * Searches for up to 10 past categorised transactions from universally visible public accounts (is_private = 0)
 * matching the query terms using SQLite FTS5 (AD-6).
 *
 * Rules:
 * - Few-shot examples come exclusively from universally visible accounts (`is_private = 0`).
 * - Never includes transactions from private accounts, regardless of provider locality.
 * - Respects `visibleTxn(viewer, today)` and name hiding.
 * - At most 10 examples returned.
 */
export function findFewShotExamples(
  repos: Pick<ReadRepos, "suggestions"> | Pick<TxRepos, "suggestions">,
  viewer: Viewer,
  today: string,
  query: string,
  limit = 10,
): FewShotExample[] {
  if (!query?.trim()) return [];
  const parsed = parseSearch(query);
  if (!parsed || parsed.terms.length === 0) return [];
  return repos.suggestions.findFewShot(viewer, today, query, Math.min(limit, 10));
}
