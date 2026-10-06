import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { write } from "../write.ts";
import { requireEntryOpen } from "./closed-lock.ts";
import { descriptionField, notesField, postedOnField } from "./fields.ts";
import type { LedgerTransaction } from "./list-transactions.ts";
import "./needs-review.ts";
import {
  auditSnapshot,
  storedTransaction,
  tagsOf,
  toLedgerTransaction,
} from "./transaction-view.ts";

export const updateTransactionInput = z
  .object({
    id: z.string().min(1).max(100),
    /** `YYYY-MM-DD`. Manual rows only. */
    postedOn: postedOnField.optional(),
    /** Signed integer minor units. Manual rows only. */
    amountCents: z.int().optional(),
    /** Manual rows only. */
    description: descriptionField.optional(),
    /** Plain text, at most 1000 characters; `null` (or blank) clears it. Any visible row. */
    notes: notesField.optional(),
  })
  .strict();
export type UpdateTransactionInput = z.input<typeof updateTransactionInput>;

/**
 * `ledger.updateTransaction`: changes the fields it is given. `notes` may be set, changed or
 * cleared (`null`) on any visible transaction. Date, amount and description change only on a
 * manual row (no `importId` or `externalId`); sending one for an imported row is a `Conflict`,
 * as is changing the amount of a transaction with more than one split (replace its splits
 * instead). The amount is also the
 * single split's amount. Status, `performedBy`, fingerprint, hidden-name fields, payee and
 * categories never change, and an edit that changes nothing writes and audits nothing. A
 * missing, deleted or partner-private transaction is `NotFound`. Audited as one `update` of
 * `transaction` (with its splits) and its `accountId`. On a closed account the date the entry ends
 * on must be on or before `closedOn` (`Conflict` with the choice in its details), so a locked
 * entry must move back to on or before `closedOn`, not merely earlier.
 */
export function updateTransaction(
  ctx: UseCaseContext,
  input: UpdateTransactionInput,
): LedgerTransaction {
  const parsed = parseInput(updateTransactionInput, input);
  return write(ctx, (tx, audit) => {
    const today = ctx.clock.today().toString();
    const before = tx.transactions.findVisible(ctx.viewer, parsed.id, today);
    if (before === undefined) throw new AppError("NotFound", "Transaction not found");
    // Decided on the stored row: the projection nulls `externalId` while the name is hidden.
    const stored = storedTransaction(tx, ctx.viewer, before.id);
    const imported = stored.importId !== null || stored.externalId !== null;
    const touchesLine =
      parsed.postedOn !== undefined ||
      parsed.amountCents !== undefined ||
      parsed.description !== undefined;
    if (imported && touchesLine) {
      throw new AppError(
        "Conflict",
        "An imported transaction's date, amount and description are fixed",
      );
    }
    if (parsed.description !== undefined && before.nameHidden) {
      throw new AppError("Conflict", "This transaction's name is hidden");
    }
    const postedOn = parsed.postedOn ?? before.postedOn;
    const amountCents = parsed.amountCents ?? before.amountCents;
    const notes =
      parsed.notes === undefined ? before.notes : parsed.notes === "" ? null : parsed.notes;
    const amountChanged = amountCents !== before.amountCents;
    const changed =
      amountChanged ||
      postedOn !== before.postedOn ||
      (parsed.description !== undefined && parsed.description !== before.descriptionRaw) ||
      notes !== before.notes;
    if (!changed) return toLedgerTransaction(ctx.viewer, before, tagsOf(tx, ctx.viewer, before));
    // The date it ends on decides: moving a locked entry back to the closed date is allowed.
    requireEntryOpen(ctx, tx, before.accountId, postedOn);
    const [only] = before.splits;
    if (amountChanged && (before.splits.length !== 1 || only === undefined)) {
      throw new AppError(
        "Conflict",
        "A transaction with several splits cannot change amount; replace its splits instead (PUT /api/ledger/transactions/:id/splits)",
      );
    }
    const at = formatInstant(ctx.clock.now());
    const updated = tx.transactions.update(ctx.viewer, {
      id: before.id,
      postedOn,
      amountCents,
      ...(parsed.description === undefined ? {} : { descriptionRaw: parsed.description }),
      notes,
      updatedAt: at,
    });
    if (!updated) throw new AppError("NotFound", "Transaction not found");
    if (amountChanged && only !== undefined) {
      if (!tx.transactions.updateSplitAmount(only.id, amountCents, at)) {
        throw new Error(`Split ${only.id} vanished during its update`);
      }
    }
    const after = tx.transactions.findVisible(ctx.viewer, before.id, today);
    if (after === undefined) throw new Error(`Transaction ${before.id} vanished during its update`);
    audit({
      entity: "transaction",
      entityId: before.id,
      accountId: before.accountId,
      action: "update",
      before: auditSnapshot(stored),
      after: auditSnapshot(storedTransaction(tx, ctx.viewer, before.id)),
    });
    return toLedgerTransaction(ctx.viewer, after, tagsOf(tx, ctx.viewer, after));
  });
}
