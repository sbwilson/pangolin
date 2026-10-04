import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { SplitRow, TransactionRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { descriptionField, postedOnField } from "./fields.ts";
import { fingerprintManual, MANUAL_FINGERPRINT_VERSION } from "./fingerprint.ts";
import "./needs-review.ts";

export const createTransactionInput = z
  .object({
    accountId: z.string().min(1).max(100),
    /** `YYYY-MM-DD`. */
    postedOn: postedOnField,
    /** Signed integer minor units. */
    amountCents: z.int(),
    description: descriptionField,
    /** A payee the viewer can see; omitted or null leaves the transaction without one. */
    payeeId: z.string().min(1).max(100).nullish(),
  })
  .strict();
export type CreateTransactionInput = z.input<typeof createTransactionInput>;

/**
 * `ledger.createTransaction`: adds a posted transaction with one split for the whole amount to
 * an account the viewer can see, audited as one `create` of `transaction` with the account's
 * ID. An account that does not exist and another person's private account both answer
 * `NotFound`. The fingerprint is `fingerprintManual` (version 2): it comes from the new ID, so
 * identical manual lines coexist. The split's beneficiary is the owner of a private account,
 * `shared` otherwise. A payee the viewer cannot see (missing, or another person's) is `NotFound`;
 * a payee scoped to one person cannot go on a public account's transaction (`Conflict`, as for a
 * tag) until promotion exists.
 * Returns the new transaction's server-minted ID.
 */
export function createTransaction(
  ctx: UseCaseContext,
  input: CreateTransactionInput,
): Id<"Transaction"> {
  const parsed = parseInput(createTransactionInput, input);
  return write(ctx, (tx, audit) => {
    const account = tx.accounts.findVisible(ctx.viewer, parsed.accountId);
    if (account === undefined) throw new AppError("NotFound", "Account not found");
    let beneficiary = "shared";
    if (account.isPrivate) {
      const [owner] = tx.accounts.owners(account.id);
      if (owner === undefined) throw new Error(`Private account ${account.id} has no owner`);
      beneficiary = owner.personId;
    }
    let payeeId: Id<"Payee"> | null = null;
    if (parsed.payeeId !== undefined && parsed.payeeId !== null) {
      const payee = tx.payees.find(ctx.viewer, parsed.payeeId);
      if (payee === undefined) throw new AppError("NotFound", "Payee not found");
      if (!account.isPrivate && payee.scopePersonId !== null) {
        throw new AppError("Conflict", "This payee cannot be used on a shared account yet");
      }
      payeeId = payee.id as Id<"Payee">;
    }
    const at = formatInstant(ctx.clock.now());
    const id = ctx.newId<"Transaction">();
    const row: TransactionRow = {
      id,
      accountId: account.id,
      postedOn: parsed.postedOn,
      amountCents: parsed.amountCents,
      descriptionRaw: parsed.description,
      payeeId,
      status: "posted",
      externalId: null,
      fingerprint: fingerprintManual(account.id, id),
      fingerprintVersion: MANUAL_FINGERPRINT_VERSION,
      importId: null,
      performedBy: null,
      transferGroupId: null,
      needsReview: false,
      isHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      notes: null,
      createdAt: at,
      updatedAt: at,
    };
    const split: SplitRow = {
      id: ctx.newId<"Split">(),
      transactionId: row.id,
      amountCents: parsed.amountCents,
      categoryId: null,
      activityId: null,
      beneficiary,
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: at,
      updatedAt: at,
    };
    tx.transactions.insert(row, [split]);
    audit({
      entity: "transaction",
      entityId: row.id,
      accountId: account.id,
      action: "create",
      before: null,
      after: { ...row, splits: [split] },
    });
    return row.id;
  });
}
