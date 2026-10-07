import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { AccountOwnerRow, TxRepos } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { closingBalanceWarning } from "./closing-balance.ts";
import { FULL_SHARE_BP, idInput } from "./inputs.ts";
import { type AccountView, accountView } from "./pool.ts";

export const setPrivacyInput = z.object({ id: idInput, isPrivate: z.boolean() }).strict();
export type SetPrivacyInput = z.input<typeof setPrivacyInput>;

/**
 * `accounts.setPrivacy`: makes an account private or public.
 *
 * Making it private needs exactly one owner (edit the owners first with `updateAccount`; a person
 * may only do it when they are that owner) and is refused with `Conflict` while any live split
 * of the account is for someone other than that owner: `shared` or the partner (AD-7).
 *
 * Making a private account public is refused with `Conflict` while its live transactions use
 * owner-scoped payees, tags or activities (AD-18; promotion is epic 3): the message and the
 * details (`{payees, tags, activities, owners}`) name each one and the owner, who alone can see
 * the account. Otherwise the account's unscoped audit rows recorded while it was private are
 * scoped to that owner (decision 80), so private-era history stays theirs and joint-era history
 * stays visible to both. An account that is already public is unchanged and nothing is scoped.
 *
 * A hiding of a transaction name outlives either switch (AD-4). Another person's private account
 * is `NotFound`. Audited as one `set_privacy` of `account` with its `accountId` and no person
 * scope, so both partners see the switch.
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
      if (tx.accounts.hasSplitForOthers(before.id, only.personId)) {
        throw new AppError(
          "Conflict",
          "The account has splits for someone other than its owner, so it cannot be private",
        );
      }
    } else if (before.isPrivate) {
      const [only] = owners;
      if (owners.length !== 1 || only === undefined) {
        throw new Error(`Private account ${before.id} does not have exactly one owner`);
      }
      requireNoScopedReferences(tx, before.id, owners);
      tx.audit.scopeToPerson(before.id, only.personId);
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
    return accountView(
      after,
      owners,
      undefined,
      closingBalanceWarning(tx, ctx.viewer, after, ctx.clock.today().toString()),
      tx.transactions.latestPostedOn(ctx.viewer, after.id) ?? null,
    );
  });
}

/**
 * Throws `Conflict` while the account's live transactions use owner-scoped payees, tags or
 * activities, listing each one and the account's owners (only they can see the account).
 */
function requireNoScopedReferences(
  tx: TxRepos,
  accountId: string,
  owners: readonly AccountOwnerRow[],
): void {
  const { payees, tags, activities } = tx.accounts.scopedReferences(accountId);
  if (payees.length + tags.length + activities.length === 0) return;
  const names = new Map(tx.person.listActive().map((p) => [p.id as string, p.displayName]));
  const ownerList = owners.map((o) => ({
    personId: o.personId as string,
    displayName: names.get(o.personId) ?? (o.personId as string),
  }));
  const items = [
    ...payees.map((p) => `payee "${p.name}"`),
    ...tags.map((t) => `tag "${t.name}"`),
    ...activities.map((a) => `activity "${a.name}"`),
  ];
  const who = ownerList.map((o) => o.displayName).join(" and ");
  throw new AppError(
    "Conflict",
    `These are private to ${who} and cannot be used on a shared account yet, so remove them from the account's transactions first: ${items.join(", ")}`,
    { payees, tags, activities, owners: ownerList },
  );
}
