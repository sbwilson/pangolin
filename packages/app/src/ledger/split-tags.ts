import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { write } from "../write.ts";
import type { LedgerTransaction } from "./list-transactions.ts";
import "./needs-review.ts";
import { privateOwner } from "./split-targets.ts";
import {
  auditSnapshot,
  storedTransaction,
  tagsOf,
  toLedgerTransaction,
} from "./transaction-view.ts";

export const setSplitTagsInput = z
  .object({
    transactionId: z.string().min(1).max(100),
    splitId: z.string().min(1).max(100),
    tagIds: z.array(z.string().min(1).max(100)).max(100),
  })
  .strict();
export type SetSplitTagsInput = z.input<typeof setSplitTagsInput>;

/**
 * `ledger.setSplitTags`: makes `tagIds` the whole tag set of one split (an empty list removes
 * them all; repeated IDs count once). Each tag is checked with `tags.find(viewer, id)`: a
 * missing, deleted or another person's scoped tag is `NotFound`. A shared tag may go on a
 * private split; an owner-scoped tag on a split in a public account is a `Conflict` until
 * promotion exists. A missing split or transaction, and a partner-private one, are `NotFound`.
 * Setting the tags a split already has writes and audits nothing. Audited as one `update` of
 * `transaction` with its `accountId`, before and after carrying splits, sources and tag IDs.
 */
export function setSplitTags(ctx: UseCaseContext, input: SetSplitTagsInput): LedgerTransaction {
  const parsed = parseInput(setSplitTagsInput, input);
  return write(ctx, (tx, audit) => {
    const today = ctx.clock.today().toString();
    const before = tx.transactions.findVisible(ctx.viewer, parsed.transactionId, today);
    if (before === undefined) throw new AppError("NotFound", "Transaction not found");
    const target = before.splits.find((s) => s.id === parsed.splitId);
    if (target === undefined) throw new AppError("NotFound", "Split not found");
    const wanted = [...new Set(parsed.tagIds)];
    const isPublic = privateOwner(tx, ctx.viewer, before.accountId) === null;
    for (const id of wanted) {
      const tag = tx.tags.find(ctx.viewer, id);
      if (tag === undefined) throw new AppError("NotFound", "Tag not found");
      if (isPublic && tag.scopePersonId !== null) {
        throw new AppError("Conflict", "This tag cannot be used on a shared account yet");
      }
    }
    const tagsBefore = tagsOf(tx, ctx.viewer, before);
    const have = tagsBefore.filter((t) => t.splitId === target.id).map((t) => t.tag.id as string);
    if (have.length === wanted.length && wanted.every((id) => have.includes(id))) {
      return toLedgerTransaction(ctx.viewer, before, tagsBefore);
    }
    const stored = storedTransaction(tx, ctx.viewer, before.id);
    tx.tags.replaceForSplit(ctx.viewer, target.id, wanted, formatInstant(ctx.clock.now()));
    const after = tx.transactions.findVisible(ctx.viewer, before.id, today);
    if (after === undefined) throw new Error(`Transaction ${before.id} vanished during its update`);
    const tagsAfter = tagsOf(tx, ctx.viewer, after);
    audit({
      entity: "transaction",
      entityId: before.id,
      accountId: before.accountId,
      action: "update",
      before: auditSnapshot(stored, tagsBefore),
      after: auditSnapshot(storedTransaction(tx, ctx.viewer, before.id), tagsAfter),
    });
    return toLedgerTransaction(ctx.viewer, after, tagsAfter);
  });
}
