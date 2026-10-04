import { formatInstant, parseDate } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { write } from "../write.ts";
import type { LedgerTransaction } from "./list-transactions.ts";
import "./needs-review.ts";
import { auditSnapshot, tagsOf, toLedgerTransaction } from "./transaction-view.ts";

export const updateTransactionInput = z
  .object({
    id: z.string().min(1).max(100),
    /** `YYYY-MM-DD`. Manual rows only. */
    postedOn: z
      .string()
      .refine(
        (value) => {
          try {
            parseDate(value);
            return true;
          } catch {
            return false;
          }
        },
        { message: "Expected a real YYYY-MM-DD date" },
      )
      .optional(),
    /** Signed integer minor units. Manual rows only. */
    amountCents: z.int().optional(),
    /** Manual rows only. */
    description: z.string().trim().min(1, { message: "Enter a description" }).max(500).optional(),
    /** Plain text, at most 1000 characters; `null` (or blank) clears it. Any visible row. */
    notes: z.string().trim().max(1000).nullable().optional(),
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
 * `transaction` (with its splits) and its `accountId`.
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
    const imported = before.importId !== null || before.externalId !== null;
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
      before: auditSnapshot(before),
      after: auditSnapshot(after),
    });
    return toLedgerTransaction(ctx.viewer, after, tagsOf(tx, ctx.viewer, after));
  });
}
