import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { syncClosingBalance } from "../accounts/closing-balance.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { requireRecentAuth } from "../identity/reauth.ts";
import { idInput } from "../inputs.ts";
import { requireEntryOpen } from "../ledger/closed-lock.ts";
import { softDeleteTransactionRow } from "../ledger/delete-transaction.ts";
import { resolveReviewItem } from "../system/review-items.ts";
import { write } from "../write.ts";

export const undoImportBatchInput = z.object({ batchId: idInput }).strict();
export type UndoImportBatchInput = z.input<typeof undoImportBatchInput>;

export interface UndoImportBatchResult {
  readonly batchId: string;
  /** How many live transactions the undo soft-deleted. */
  readonly undoneCount: number;
}

/**
 * `imports.undoImportBatch`: reverses a committed import as one unit, behind recent
 * re-authentication (`ReauthRequired` first, changing nothing). Only the person who imported the
 * batch may undo it; anyone else, or a batch whose account the viewer cannot see, is `NotFound`.
 * A batch with no recorded importer (from before migration 0018, or imported by the system), a
 * batch that is not committed and one already undone are `Conflict`. Every live transaction of
 * the batch is soft-deleted exactly as `deleteTransaction` does (open review items resolved,
 * transfer groups unlinked, audited), the batch's set-aside review item is resolved, and the
 * batch gets `undoneAt`. A row dated after its closed account's `closedOn` refuses the whole
 * undo (`Conflict`). The batch row, its file hash and the deleted rows' fingerprints stay, so
 * importing the same file again stays blocked (AD-20).
 */
export function undoImportBatch(
  ctx: UseCaseContext,
  input: UndoImportBatchInput,
): UndoImportBatchResult {
  const parsed = parseInput(undoImportBatchInput, input);
  requireRecentAuth(ctx);
  return write(ctx, (tx, audit) => {
    const batch = tx.importBatches.find(ctx.viewer, parsed.batchId);
    if (batch === undefined) throw new AppError("NotFound", "Import batch not found");
    if (batch.importedByPersonId === null) {
      throw new AppError(
        "Conflict",
        "This import has no recorded importer, so it cannot be undone",
      );
    }
    if (ctx.viewer.kind !== "person" || ctx.viewer.personId !== batch.importedByPersonId) {
      throw new AppError("NotFound", "Import batch not found");
    }
    if (batch.undoneAt !== null) throw new AppError("Conflict", "This import was already undone");
    if (batch.status !== "committed") {
      throw new AppError("Conflict", "Only a committed import can be undone");
    }
    const today = ctx.clock.today().toString();
    const rows = [];
    for (const id of tx.importBatches.listLiveTransactionIds(batch.id)) {
      const row = tx.transactions.findVisible(ctx.viewer, id, today);
      if (row === undefined) throw new AppError("NotFound", "Import batch not found");
      requireEntryOpen(ctx, tx, row.accountId, row.postedOn);
      rows.push(row.id);
    }
    // Each row is read fresh: an earlier row's transfer unlink changes its partner in the batch.
    for (const id of rows) {
      const row = tx.transactions.findVisible(ctx.viewer, id, today);
      if (row === undefined) continue;
      softDeleteTransactionRow(ctx, tx, audit, row);
    }
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: `import.set_aside:${batch.id}`,
      resolution: "import undone",
    });
    const at = formatInstant(ctx.clock.now());
    if (!tx.importBatches.markUndone(batch.id, at)) {
      throw new AppError("Conflict", "This import was already undone");
    }
    audit({
      entity: "import_batch",
      entityId: batch.id,
      accountId: batch.accountId,
      action: "update",
      before: batch,
      after: { ...batch, undoneAt: at, updatedAt: at },
    });
    syncClosingBalance(tx, audit, ctx, batch.accountId);
    return { batchId: batch.id, undoneCount: rows.length };
  });
}
