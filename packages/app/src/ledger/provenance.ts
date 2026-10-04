import type { SplitSource } from "../ports/unit-of-work.ts";

/** Precedence of a source (AD-10): user > rule > payee default > activity default > llm. */
const RANK: Readonly<Record<SplitSource, number>> = {
  user: 5,
  rule: 4,
  payee: 3,
  activity: 2,
  llm: 1,
};

export function sourceRank(source: SplitSource): number {
  return RANK[source];
}

/**
 * Whether `next` may write a field whose value came from `current`. A field with no recorded
 * source (`null`) is unset, so any source may write; otherwise the new rank must be at least the
 * current one, so a user re-edit works and a lower source never overwrites a higher one.
 */
export function mayOverwrite(current: SplitSource | null, next: SplitSource): boolean {
  return current === null || RANK[next] >= RANK[current];
}
