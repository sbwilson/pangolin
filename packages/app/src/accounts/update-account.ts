import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { AccountRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import {
  dayInput,
  idInput,
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
 * match, and `setPrivacy` owns privacy. Clearing `closedOn` reopens the account. Owners are
 * replaced as a whole and take effect from the next open period (AD-26). Another person's
 * private account is `NotFound`. Audited as one `update` of `account` with its `accountId`.
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
    }
    const institutionId =
      parsed.institutionId === undefined
        ? before.institutionId
        : (parsed.institutionId as Id<"Institution"> | null);
    requireInstitution(tx, ctx.viewer, institutionId);
    const openedOn = parsed.openedOn === undefined ? before.openedOn : parsed.openedOn;
    const closedOn = parsed.closedOn === undefined ? before.closedOn : parsed.closedOn;
    requireDatesInOrder(openedOn, closedOn);
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
    return accountView(after, afterOwners);
  });
}
