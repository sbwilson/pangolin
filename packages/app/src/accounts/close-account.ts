import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { requireClosableOn } from "../ledger/closed-lock.ts";
import { write } from "../write.ts";
import { closingBalanceWarning, syncClosingBalance } from "./closing-balance.ts";
import { dayInput, idInput, requireDatesInOrder } from "./inputs.ts";
import { type AccountView, accountView } from "./pool.ts";

export const closeAccountInput = z
  .object({
    id: idInput,
    /** `YYYY-MM-DD`; today (by the clock) when omitted. */
    closedOn: dayInput.optional(),
  })
  .strict();
export type CloseAccountInput = z.input<typeof closeAccountInput>;

/**
 * `accounts.closeAccount`: sets `closedOn` and nothing else; transactions are untouched, and
 * `updateAccount` with `closedOn: null` reopens the account. An open account only: closing a
 * closed one is a `Conflict`, and so is a date before the account's latest transaction or balance
 * snapshot (its details say which dates and which manual entries to move; see
 * `ClosedAccountDetails`). From then on the ledger refuses entries after `closedOn`. Another person's private account is `NotFound`. A non-zero balance as of `closedOn` on a cash account is a
 * warning on the returned view and one open review item, never a block. Audited as one
 * `close` of `account` with its `accountId`.
 */
export function closeAccount(ctx: UseCaseContext, input: CloseAccountInput): AccountView {
  const parsed = parseInput(closeAccountInput, input);
  const closedOn = parsed.closedOn ?? ctx.clock.today().toString();
  return write(ctx, (tx, audit) => {
    const before = tx.accounts.findVisible(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Account not found");
    if (before.closedOn !== null) throw new AppError("Conflict", "The account is already closed");
    requireDatesInOrder(before.openedOn, closedOn);
    requireClosableOn(ctx, tx, before.id, closedOn);
    const after = { ...before, closedOn, updatedAt: formatInstant(ctx.clock.now()) };
    tx.accounts.update(after);
    const owners = tx.accounts.owners(before.id);
    audit({
      entity: "account",
      entityId: before.id,
      accountId: before.id,
      action: "close",
      before: { ...before, owners },
      after: { ...after, owners },
    });
    syncClosingBalance(tx, audit, ctx, before.id);
    return accountView(after, owners, undefined, closingBalanceWarning(tx, ctx.viewer, after));
  });
}
