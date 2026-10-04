import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { write } from "../write.ts";
import { FULL_SHARE_BP, idInput } from "./inputs.ts";
import { type AccountView, accountView } from "./pool.ts";

export const setPrivacyInput = z.object({ id: idInput, isPrivate: z.boolean() }).strict();
export type SetPrivacyInput = z.input<typeof setPrivacyInput>;

/**
 * `accounts.setPrivacy`: makes an account private or public. Making it private needs exactly one
 * owner (edit the owners first with `updateAccount`; a person may only do it when they are that
 * owner) and is refused with `Conflict` while any live split of the account is shared (AD-7);
 * making it public has no split rule. Another person's private account is `NotFound`. Audited as
 * one `set_privacy` of `account` with its `accountId`.
 */
export function setPrivacy(ctx: UseCaseContext, input: SetPrivacyInput): AccountView {
  const parsed = parseInput(setPrivacyInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.accounts.findVisible(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Account not found");
    const owners = tx.accounts.owners(before.id);
    if (parsed.isPrivate) {
      const [only] = owners;
      if (owners.length !== 1 || only?.shareBp !== FULL_SHARE_BP) {
        throw new AppError(
          "Validation",
          "A private account has one owner: edit the owners down to one person first",
        );
      }
      if (ctx.viewer.kind === "person" && only.personId !== ctx.viewer.personId) {
        throw new AppError("Validation", "You can only make your own account private");
      }
      if (tx.accounts.hasSharedSplit(before.id)) {
        throw new AppError("Conflict", "The account has shared splits, so it cannot be private");
      }
    }
    const after = {
      ...before,
      isPrivate: parsed.isPrivate,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    tx.accounts.update(after);
    audit({
      entity: "account",
      entityId: before.id,
      accountId: before.id,
      action: "set_privacy",
      before: { ...before, owners },
      after: { ...after, owners },
    });
    return accountView(after, owners);
  });
}
