import type {
  SplitRow,
  SplitTagged,
  TagRepo,
  TransactionRepo,
  TransactionRow,
  TransactionWithSplits,
  VisibleTransaction,
} from "../ports/unit-of-work.ts";
import { redact } from "../redact.ts";
import type { Viewer } from "../viewer.ts";
import type { LedgerSplit, LedgerTransaction } from "./list-transactions.ts";

/**
 * The stored columns of a transaction and its splits, for an audit row's before and after: the
 * row from `findStored`, never the actor's projection (hiding applies when the audit is read).
 * Given `tags`, each split also carries its tag IDs (sorted): only the tags visible to the
 * writer (`tagsOf` reads them in the writer's scope), so the tag record is not complete (a full
 * record is deferred). The splits keep their provenance columns.
 */
export function auditSnapshot(
  row: TransactionWithSplits,
  tags?: readonly SplitTagged[],
): TransactionRow & {
  readonly splits: readonly (SplitRow & { readonly tagIds?: readonly string[] })[];
} {
  if (tags === undefined) return row;
  const grouped = tagsBySplit(tags);
  return {
    ...row,
    splits: row.splits.map((s) => ({
      ...s,
      tagIds: (grouped.get(s.id) ?? []).map((t) => t.id).sort(),
    })),
  };
}

/**
 * The stored row of a transaction the viewer may see, for an audit snapshot inside a write. The
 * caller has already found it with `findVisible`, so a miss means it vanished mid-write.
 */
export function storedTransaction(
  repos: { readonly transactions: Pick<TransactionRepo, "findStored"> },
  viewer: Viewer,
  id: string,
): TransactionWithSplits {
  const row = repos.transactions.findStored(viewer, id);
  if (row === undefined) throw new Error(`Transaction ${id} vanished during its update`);
  return row;
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
