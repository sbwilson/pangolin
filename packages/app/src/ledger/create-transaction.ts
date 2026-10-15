import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { syncClosingBalance } from "../accounts/closing-balance.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import type { SplitRow, TransactionRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { requireOpenOn } from "./closed-lock.ts";
import { descriptionField, postedOnField } from "./fields.ts";
import { fingerprintManual, MANUAL_FINGERPRINT_VERSION } from "./fingerprint.ts";
import { privateOwner } from "./split-targets.ts";

export const createTransactionInput = z
  .object({
    accountId: idInput,
    /** `YYYY-MM-DD`. */
    postedOn: postedOnField,
    /** Signed integer minor units. */
    amountCents: z.int(),
    description: descriptionField,
    /** A payee the viewer can see; omitted or null leaves the transaction without one. */
    payeeId: idInput.nullish(),
  })
  .strict();
export type CreateTransactionInput = z.input<typeof createTransactionInput>;

/**
 * `ledger.createTransaction`: adds a posted transaction with one split for the whole amount to
 * an account the viewer can see, audited as one `create` of `transaction` with the account's
 * ID. An account that does not exist and another person's private account both answer
 * `NotFound`. A closed account refuses a `postedOn` after its `closedOn` (`Conflict`, with the
 * choice in its details). The fingerprint is `fingerprintManual` (version 2): it comes from the new ID, so
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
    requireOpenOn(ctx, tx, account, parsed.postedOn);
    const owner = privateOwner(tx, ctx.viewer, account.id);
    const isPublic = owner === null;
    let beneficiary = "shared";
    if (owner !== null) {
      beneficiary = owner;
    }
    let payeeId: Id<"Payee"> | null = null;
    if (parsed.payeeId !== undefined && parsed.payeeId !== null) {
      const payee = tx.payees.find(ctx.viewer, parsed.payeeId);
      if (payee === undefined) throw new AppError("NotFound", "Payee not found");
      if (isPublic && payee.scopePersonId !== null) {
        throw new AppError("Conflict", "This payee cannot be used on a shared account yet");
      }
      if (!isPublic && payee.scopePersonId !== null && payee.scopePersonId !== owner) {
        throw new AppError("Conflict", "This payee cannot be used on this private account");
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
    syncClosingBalance(tx, audit, ctx, account.id);
    return row.id;
  });
}
