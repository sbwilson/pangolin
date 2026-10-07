import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { requireClosableOn } from "../ledger/closed-lock.ts";
import type { AccountOwnerRow, AccountRow } from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";
import { write } from "../write.ts";
import { closingBalanceWarning, syncClosingBalance } from "./closing-balance.ts";
import {
  dayInput,
  idInput,
  type OwnersInput,
  ownerRows,
  ownersInput,
  requireDatesInOrder,
  requireInstitution,
  requireKnownPeople,
  validateOwners,
} from "./inputs.ts";
import { type AccountView, accountView } from "./pool.ts";

export const updateAccountInput = z
  .object({
    id: idInput,
    name: z.string().trim().min(1, { message: "Enter a name" }).max(100).optional(),
    /** Immutable: accepted only when it equals the account's own currency. */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, { message: "Expected an ISO 4217 code" })
      .optional(),
    institutionId: idInput.nullish(),
    openedOn: dayInput.nullish(),
    /** A date closes the account; null clears it and reopens the account. */
    closedOn: dayInput.nullish(),
    isSavings: z.boolean().optional(),
    /** Replaces every owner and share, with the same validation as create. */
    owners: ownersInput.optional(),
  })
  .strict();
export type UpdateAccountInput = z.input<typeof updateAccountInput>;

/**
 * `accounts.updateAccount`: changes the fields it is given (an omitted field stays; `null` clears
 * an institution or date). The type, currency and privacy never change here: the currency must
 * match, and `setPrivacy` owns privacy. Clearing `closedOn` reopens the account; setting a new
 * `closedOn` before the latest transaction or balance snapshot is a `Conflict` carrying the
 * choice (`ClosedAccountDetails`). Owners are
 * replaced as a whole and take effect from the next open period (AD-26). On a public account a
 * person who owns it may set the owners freely (share it, remove themself or the other, change
 * shares; one or two owners whose shares add up to 100%); a person who does not own it may only
 * join it, so the new list must be its current owners plus themself. A private account keeps its
 * one owner. The system viewer is exempt from the join rule. Another person's private account is
 * `NotFound`. Audited as one `update` of `account` with its `accountId`, both owner lists in the
 * row: a removed person's `removal` marker is derived from it.
 */
export function updateAccount(ctx: UseCaseContext, input: UpdateAccountInput): AccountView {
  const parsed = parseInput(updateAccountInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.accounts.findVisible(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Account not found");
    if (parsed.currency !== undefined && parsed.currency !== before.currency) {
      throw new AppError("Validation", "An account's currency cannot change");
    }
    const beforeOwners = tx.accounts.owners(before.id);
    if (parsed.owners !== undefined) {
      validateOwners(parsed.owners, before.isPrivate, ctx.viewer);
      requireKnownPeople(tx, parsed.owners);
      requireOwnerChangeAllowed(ctx.viewer, beforeOwners, parsed.owners);
    }
    const institutionId =
      parsed.institutionId === undefined
        ? before.institutionId
        : (parsed.institutionId as Id<"Institution"> | null);
    requireInstitution(tx, ctx.viewer, institutionId);
    const openedOn = parsed.openedOn === undefined ? before.openedOn : parsed.openedOn;
    const closedOn = parsed.closedOn === undefined ? before.closedOn : parsed.closedOn;
    requireDatesInOrder(openedOn, closedOn);
    if (closedOn !== null && closedOn !== before.closedOn) {
      requireClosableOn(ctx, tx, before.id, closedOn);
    }
    const at = formatInstant(ctx.clock.now());
    const after: AccountRow = {
      ...before,
      name: parsed.name ?? before.name,
      institutionId,
      openedOn,
      closedOn,
      isSavings: parsed.isSavings ?? before.isSavings,
      updatedAt: at,
    };
    tx.accounts.update(after);
    const afterOwners =
      parsed.owners === undefined
        ? beforeOwners
        : ownerRows(before.id, parsed.owners, at, beforeOwners);
    if (parsed.owners !== undefined) tx.accounts.replaceOwners(before.id, afterOwners);
    audit({
      entity: "account",
      entityId: before.id,
      accountId: before.id,
      action: "update",
      before: { ...before, owners: beforeOwners },
      after: { ...after, owners: afterOwners },
    });
    if (closedOn !== before.closedOn) syncClosingBalance(tx, audit, ctx, before.id);
    return accountView(
      after,
      afterOwners,
      undefined,
      closingBalanceWarning(tx, ctx.viewer, after, ctx.clock.today().toString()),
      tx.transactions.latestPostedOn(ctx.viewer, after.id) ?? null,
    );
  });
}

/**
 * Throws `Validation` when a person who does not own the account does more than join it: their
 * new owner list must be the current owners plus themself. An owner may change the owners freely
 * (`validateOwners` has already checked the shape and the shares), and the system viewer is
 * exempt, as it is from `validateOwners`.
 */
function requireOwnerChangeAllowed(
  viewer: Viewer,
  before: readonly AccountOwnerRow[],
  owners: OwnersInput,
): void {
  if (viewer.kind !== "person") return;
  const me = viewer.personId as string;
  if (before.some((owner) => owner.personId === me)) return;
  const expected = new Set([...before.map((owner) => owner.personId as string), me]);
  const given = new Set(owners.map((owner) => owner.personId));
  const joins = given.size === expected.size && [...expected].every((id) => given.has(id));
  if (!joins) {
    throw new AppError(
      "Validation",
      "Add yourself to the current owners: you cannot change who else owns this account",
    );
  }
}
