import type { UseCaseContext } from "../context.ts";
import { transactionEntityRef } from "../ledger/needs-review.ts";

/**
 * `imports.countBatchReviewItems`: how many review items are open for an import batch the viewer
 * can see: its set-aside item plus the open items on its live transactions (probable duplicates,
 * ambiguous transfers, unclassified). Items are counted, not transactions. Zero for a batch the
 * viewer cannot see. Runs in a transaction only because the read port has no per-entity count;
 * it writes nothing.
 */
export function countBatchReviewItems(ctx: UseCaseContext, batchId: string): number {
  return ctx.uow.transaction((repos) => {
    if (repos.importBatches.find(ctx.viewer, batchId) === undefined) return 0;
    let count = repos.reviewItems.countOpenForEntity(`import_batch:${batchId}`);
    for (const id of repos.importBatches.listLiveTransactionIds(batchId)) {
      count += repos.reviewItems.countOpenForEntity(transactionEntityRef(id));
    }
    return count;
  });
}
