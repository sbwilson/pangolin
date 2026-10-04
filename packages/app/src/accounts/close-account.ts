import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { write } from "../write.ts";
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
 * closed one is a `Conflict`. Another person's private account is `NotFound`. Audited as one
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
    return accountView(after, owners);
  });
}
