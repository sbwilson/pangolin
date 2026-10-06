import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { syncClosingBalance } from "../accounts/closing-balance.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { requireRecentAuth } from "../identity/reauth.ts";
import { resolveReviewItemsForEntity } from "../system/review-items.ts";
import { write } from "../write.ts";
import { requireEntryOpen } from "./closed-lock.ts";
import { transactionEntityRef } from "./needs-review.ts";
import { auditSnapshot, storedTransaction } from "./transaction-view.ts";

export const deleteTransactionInput = z.object({ id: z.string().min(1).max(100) }).strict();
export type DeleteTransactionInput = z.input<typeof deleteTransactionInput>;

/**
 * `ledger.deleteTransaction`: soft-deletes a transaction the viewer can see, behind recent
 * re-authentication (`ReauthRequired` first, changing nothing). The row keeps its dedupe keys
 * (AD-20) and drops out of every read. Open review items about it are resolved with "transaction
 * deleted". A missing, already deleted or partner-private transaction is `NotFound`. A row in a
 * transfer group takes its group with it: the other live sides are unlinked (so each can join a
 * new group) and the group is deleted. Audited as one `delete` of `transaction` with its
 * `accountId`, plus one `update` per unlinked side with that side's `accountId` (and, in a
 * private account, its owner as `personId`, so only the owner reads it). A row dated after its
 * closed account's `closedOn` is locked (`Conflict`); a survivor in a closed account is unlinked
 * whatever its date.
 */
export function deleteTransaction(ctx: UseCaseContext, input: DeleteTransactionInput): void {
  const parsed = parseInput(deleteTransactionInput, input);
  requireRecentAuth(ctx);
  write(ctx, (tx, audit) => {
    const before = tx.transactions.findVisible(ctx.viewer, parsed.id, ctx.clock.today().toString());
    if (before === undefined) throw new AppError("NotFound", "Transaction not found");
    // Only the deleted row is checked; the survivors of its group are upkeep (decision 81).
    requireEntryOpen(ctx, tx, before.accountId, before.postedOn);
    // Read before the delete: `findStored` sees live rows only.
    const stored = storedTransaction(tx, ctx.viewer, before.id);
    const at = formatInstant(ctx.clock.now());
    if (!tx.transactions.softDelete(ctx.viewer, before.id, at)) {
      throw new AppError("NotFound", "Transaction not found");
    }
    resolveReviewItemsForEntity(tx, audit, ctx, {
      entityRef: transactionEntityRef(before.id),
      resolution: "transaction deleted",
    });
    const groupId = before.transferGroupId;
    // The other live sides, read raw: a survivor in the other person's private account is
    // unlinked too, and the viewer never sees it (AD-6: a repo read, not a SystemViewer).
    const survivors = groupId === null ? [] : tx.transferGroups.upkeepMembers(groupId);
    if (groupId !== null) {
      // Clear every link (the deleted row's too) before the group goes: foreign key.
      tx.transactions.setTransferGroup([before.id, ...survivors.map((m) => m.id)], null, at);
      if (!tx.transferGroups.delete(groupId)) {
        throw new Error(`Transfer group ${groupId} vanished during a transaction's deletion`);
      }
    }
    const snapshot = auditSnapshot(stored);
    audit({
      entity: "transaction",
      entityId: before.id,
      accountId: before.accountId,
      action: "delete",
      before: snapshot,
      after: {
        ...snapshot,
        needsReview: false,
        transferGroupId: null,
        updatedAt: at,
        deletedAt: at,
      },
    });
    for (const survivor of survivors) {
      // A survivor in a private account is audited with owner-only scope (decision 81), whether
      // or not the viewer can see that account: the owner is the one person who may read it.
      const account = tx.accounts.findVisible(ctx.viewer, survivor.accountId);
      const owner =
        account === undefined || account.isPrivate
          ? tx.accounts.owners(survivor.accountId)[0]
          : undefined;
      audit({
        entity: "transaction",
        entityId: survivor.id,
        accountId: survivor.accountId,
        ...(owner === undefined ? {} : { personId: owner.personId }),
        action: "update",
        before: survivor,
        after: { ...survivor, transferGroupId: null, updatedAt: at },
      });
    }
    syncClosingBalance(tx, audit, ctx, before.accountId);
  });
}
