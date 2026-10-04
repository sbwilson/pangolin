import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { requireRecentAuth } from "../identity/reauth.ts";
import { resolveReviewItemsForEntity } from "../system/review-items.ts";
import { write } from "../write.ts";
import { transactionEntityRef } from "./needs-review.ts";
import { auditSnapshot } from "./transaction-view.ts";

export const deleteTransactionInput = z.object({ id: z.string().min(1).max(100) }).strict();
export type DeleteTransactionInput = z.input<typeof deleteTransactionInput>;

/**
 * `ledger.deleteTransaction`: soft-deletes a transaction the viewer can see, behind recent
 * re-authentication (`ReauthRequired` first, changing nothing). The row keeps its dedupe keys
 * (AD-20) and drops out of every read. Open review items about it are resolved with "transaction
 * deleted". A missing, already deleted or partner-private transaction is `NotFound`. Audited as
 * one `delete` of `transaction` with its `accountId`.
 */
export function deleteTransaction(ctx: UseCaseContext, input: DeleteTransactionInput): void {
  const parsed = parseInput(deleteTransactionInput, input);
  requireRecentAuth(ctx);
  write(ctx, (tx, audit) => {
    const before = tx.transactions.findVisible(ctx.viewer, parsed.id, ctx.clock.today().toString());
    if (before === undefined) throw new AppError("NotFound", "Transaction not found");
    const at = formatInstant(ctx.clock.now());
    if (!tx.transactions.softDelete(ctx.viewer, before.id, at)) {
      throw new AppError("NotFound", "Transaction not found");
    }
    resolveReviewItemsForEntity(tx, audit, ctx, {
      entityRef: transactionEntityRef(before.id),
      resolution: "transaction deleted",
    });
    const snapshot = auditSnapshot(before);
    audit({
      entity: "transaction",
      entityId: before.id,
      accountId: before.accountId,
      action: "delete",
      before: snapshot,
      after: { ...snapshot, needsReview: false, updatedAt: at, deletedAt: at },
    });
  });
}
