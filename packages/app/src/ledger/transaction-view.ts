import type {
  SplitRow,
  SplitTagged,
  TagRepo,
  TransactionRow,
  VisibleTransaction,
} from "../ports/unit-of-work.ts";
import { redact } from "../redact.ts";
import type { Viewer } from "../viewer.ts";
import type { LedgerSplit, LedgerTransaction } from "./list-transactions.ts";

/**
 * The stored columns of a transaction and its splits, for an audit row's before and after. Given
 * `tags`, each split also carries its tag IDs (sorted); the splits keep their provenance columns.
 */
export function auditSnapshot(
  row: VisibleTransaction,
  tags?: readonly SplitTagged[],
): Omit<TransactionRow, "descriptionRaw" | "payeeId"> & {
  readonly descriptionRaw: string | null;
  readonly payeeId: string | null;
  readonly splits: readonly (SplitRow & { readonly tagIds?: readonly string[] })[];
} {
  const { payeeName: _n, logoAttachmentId: _l, nameHidden: _h, transferLabel: _t, ...stored } = row;
  if (tags === undefined) return stored;
  const grouped = tagsBySplit(tags);
  return {
    ...stored,
    splits: stored.splits.map((s) => ({
      ...s,
      tagIds: (grouped.get(s.id) ?? []).map((t) => t.id).sort(),
    })),
  };
}

/** Groups `listForSplits` rows by split, keeping their order. */
export function tagsBySplit(tags: readonly SplitTagged[]): Map<string, SplitTagged["tag"][]> {
  const grouped = new Map<string, SplitTagged["tag"][]>();
  for (const { splitId, tag } of tags) {
    const list = grouped.get(splitId) ?? [];
    list.push(tag);
    grouped.set(splitId, list);
  }
  return grouped;
}

/** The transaction amount less the sum of its splits; 0 when they add up (the server owns it). */
export function remainingCents(row: Pick<VisibleTransaction, "amountCents" | "splits">): number {
  return row.amountCents - row.splits.reduce((sum, s) => sum + s.amountCents, 0);
}

/**
 * One transaction as a use case returns it: a hidden name rendered by `redact` (AD-4), each
 * split with its tags (`tags` as `TagRepo.listForSplits` returns them), and `remainingCents`.
 */
export function toLedgerTransaction(
  viewer: Viewer,
  row: VisibleTransaction,
  tags: readonly SplitTagged[] = [],
): LedgerTransaction {
  const grouped = tagsBySplit(tags);
  const splits: LedgerSplit[] = row.splits.map((s) => ({ ...s, tags: grouped.get(s.id) ?? [] }));
  const redacted = redact(viewer, [row])[0] as unknown as Omit<LedgerTransaction, "remainingCents">;
  return { ...redacted, splits, remainingCents: remainingCents(row) };
}

/** The tags on every split of `row`, in one batch read, for the audit snapshot and the view. */
export function tagsOf(
  repos: { readonly tags: Pick<TagRepo, "listForSplits"> },
  viewer: Viewer,
  row: Pick<VisibleTransaction, "splits">,
): SplitTagged[] {
  return repos.tags.listForSplits(
    viewer,
    row.splits.map((s) => s.id),
  );
}
