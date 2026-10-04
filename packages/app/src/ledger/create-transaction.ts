import type { Id } from "@pangolin/shared";
import { formatInstant, parseDate } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { SplitRow, TransactionRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

export const createTransactionInput = z
  .object({
    accountId: z.string().min(1).max(100),
    /** `YYYY-MM-DD`. */
    postedOn: z.string().refine(
      (value) => {
        try {
          parseDate(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Expected a real YYYY-MM-DD date" },
    ),
    /** Signed integer minor units. */
    amountCents: z.int(),
    description: z.string().trim().min(1, { message: "Enter a description" }).max(500),
  })
  .strict();
export type CreateTransactionInput = z.input<typeof createTransactionInput>;

/**
 * `ledger.createTransaction`: adds a posted transaction with one split for the whole amount to
 * an account the viewer can see, audited as one `create` of `transaction` with the account's
 * ID. An account that does not exist and another person's private account both answer
 * `NotFound`. The split's beneficiary is the owner of a private account, `shared` otherwise.
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
    const at = formatInstant(ctx.clock.now());
    const row: TransactionRow = {
      id: ctx.newId<"Transaction">(),
      accountId: account.id,
      postedOn: parsed.postedOn,
      amountCents: parsed.amountCents,
      descriptionRaw: parsed.description,
      status: "posted",
      createdAt: at,
      updatedAt: at,
    };
    const split: SplitRow = {
      id: ctx.newId<"Split">(),
      transactionId: row.id,
      amountCents: parsed.amountCents,
      beneficiary,
      memo: null,
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
