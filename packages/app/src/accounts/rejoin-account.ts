import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { AccountOwnerRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { FULL_SHARE_BP, idInput, ownerRows } from "./inputs.ts";
import { type AccountView, accountView, removalOf } from "./pool.ts";

export const rejoinAccountInput = z.object({ id: idInput }).strict();
export type RejoinAccountInput = z.input<typeof rejoinAccountInput>;

/**
 * `accounts.rejoinAccount`: puts a person who was removed from a public account back among its
 * owners at the share they had (the `removal.previousOwners` entry of their marker), scaling the
 * current owners down to fit so the shares still add up to 100%. A current owner keeps at least
 * one basis point, so a previous share of 100% is trimmed to leave room. `Validation` when the
 * person already owns the account, when nothing removed them, and for the system viewer (only a
 * person rejoins). Another person's private account is `NotFound`. Audited as one `update` of
 * `account` with its `accountId` and both owner lists, as `updateAccount` audits an owner change.
 */
export function rejoinAccount(ctx: UseCaseContext, input: RejoinAccountInput): AccountView {
  const parsed = parseInput(rejoinAccountInput, input);
  const viewer = ctx.viewer;
  if (viewer.kind !== "person") {
    throw new AppError("Validation", "Only a person can rejoin an account");
  }
  return write(ctx, (tx, audit) => {
    const before = tx.accounts.findVisible(viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Account not found");
    const beforeOwners = tx.accounts.owners(before.id);
    if (beforeOwners.some((owner) => owner.personId === viewer.personId)) {
      throw new AppError("Validation", "You are already an owner of this account");
    }
    const removal = removalOf(viewer, beforeOwners, tx.audit.ownerChanges(viewer, before.id));
    const previous = removal?.previousOwners.find((owner) => owner.personId === viewer.personId);
    if (
      removal === undefined ||
      previous === undefined ||
      !Number.isInteger(previous.shareBp) ||
      previous.shareBp < 1
    ) {
      throw new AppError("Validation", "You were not removed from this account");
    }
    if (beforeOwners.length >= 2) {
      throw new AppError("Validation", "An account has at most two owners");
    }
    const mine = Math.min(previous.shareBp, FULL_SHARE_BP - beforeOwners.length);
    const shares = scaleShares(
      beforeOwners.map((owner) => owner.shareBp),
      FULL_SHARE_BP - mine,
    );
    const at = formatInstant(ctx.clock.now());
    const afterOwners: AccountOwnerRow[] = [
      ...ownerRows(
        before.id,
        beforeOwners.map((owner, i) => ({
          personId: owner.personId,
          shareBp: shares[i] as number,
        })),
        at,
        beforeOwners,
      ),
      ...ownerRows(before.id, [{ personId: viewer.personId, shareBp: mine }], at),
    ];
    const after = { ...before, updatedAt: at };
    tx.accounts.update(after);
    tx.accounts.replaceOwners(before.id, afterOwners);
    audit({
      entity: "account",
      entityId: before.id,
      accountId: before.id,
      action: "update",
      before: { ...before, owners: beforeOwners },
      after: { ...after, owners: afterOwners },
    });
    return accountView(after, afterOwners);
  });
}

/**
 * Scales `shares` to add up to `total` (at least 1 each), the largest remainders taking the
 * leftover basis points. `total` must be at least the number of shares.
 */
function scaleShares(shares: readonly number[], total: number): number[] {
  const sum = shares.reduce((a, b) => a + b, 0);
  const exact = shares.map((share) => (share * total) / sum);
  const scaled = exact.map((value) => Math.max(1, Math.floor(value)));
  let left = total - scaled.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, i) => ({ i, rest: value - Math.floor(value) }))
    .sort((x, y) => y.rest - x.rest || x.i - y.i);
  for (let k = 0; left !== 0 && k < order.length * 2; k++) {
    const i = (order[k % order.length] as { i: number }).i;
    if (left > 0) {
      scaled[i] = (scaled[i] as number) + 1;
      left--;
    } else if ((scaled[i] as number) > 1) {
      scaled[i] = (scaled[i] as number) - 1;
      left++;
    }
  }
  return scaled;
}
