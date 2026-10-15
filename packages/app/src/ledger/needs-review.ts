// `transaction.needs_review` is derived from open review items (AD-11, AD-17): true exactly when
// at least one open item has `entity_ref = 'transaction:<id>'`. `system` calls this listener from
// `raiseReviewItem` and `resolveReviewItem` (it cannot import `ledger`), in the same write.
import { formatInstant } from "@pangolin/shared/temporal";
import { registerEntitySync } from "../system/review-items.ts";

/** The `entity_ref` prefix of review items about a transaction. */
export const TRANSACTION_ENTITY_PREFIX = "transaction:";

/** `transaction:<id>`, the `entityRef` for a review item about transaction `id`. */
export function transactionEntityRef(id: string): string {
  return `${TRANSACTION_ENTITY_PREFIX}${id}`;
}

/** Registers the sync listener that derives `transaction.needs_review` from open review items. */
export function registerTransactionNeedsReviewSync(): void {
  registerEntitySync(TRANSACTION_ENTITY_PREFIX, (tx, ctx, entityRef) => {
    const id = entityRef.slice(TRANSACTION_ENTITY_PREFIX.length);
    const open = tx.reviewItems.countOpenForEntity(entityRef) > 0;
    tx.transactions.setNeedsReview(id, open, formatInstant(ctx.clock.now()));
  });
}
