import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { ACCOUNT_TYPES, type AccountRow } from "../ports/unit-of-work.ts";
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

export const createAccountInput = z
  .object({
    name: z.string().trim().min(1, { message: "Enter a name" }).max(100),
    type: z.enum(ACCOUNT_TYPES),
    /** ISO 4217 code; v1 requires it to match the household's base currency. */
    currency: z.string().regex(/^[A-Z]{3}$/, { message: "Expected an ISO 4217 code" }),
    isPrivate: z.boolean(),
    owners: ownersInput,
    institutionId: idInput.nullish(),
    openedOn: dayInput.nullish(),
    /** Counts toward savings. Defaults to false. */
    isSavings: z.boolean().optional(),
  })
  .strict();
export type CreateAccountInput = z.input<typeof createAccountInput>;

/**
 * `accounts.createAccount`: adds an account with its owners, audited as one `create` of
 * `account` (carrying its own `accountId`). A private account has exactly one owner, with the
 * whole share; shares otherwise sum to 100%. A person may create a private account only for
 * themselves. The currency must be the household base currency. Returns the new account's
 * server-minted ID.
 */
export function createAccount(ctx: UseCaseContext, input: CreateAccountInput): Id<"Account"> {
  const parsed = parseInput(createAccountInput, input);
  const owners = parsed.owners;
  validateOwners(owners, parsed.isPrivate, ctx.viewer);
  const institutionId = (parsed.institutionId ?? null) as Id<"Institution"> | null;
  const openedOn = parsed.openedOn ?? null;
  requireDatesInOrder(openedOn, null);

  return write(ctx, (tx, audit) => {
    const { baseCurrency } = tx.householdSettings.get();
    if (parsed.currency !== baseCurrency) {
      throw new AppError("Validation", `The currency must be the base currency, ${baseCurrency}`);
    }
    requireKnownPeople(tx, owners);
    requireInstitution(tx, ctx.viewer, institutionId);
    const at = formatInstant(ctx.clock.now());
    const row: AccountRow = {
      id: ctx.newId<"Account">(),
      name: parsed.name,
      type: parsed.type,
      currency: parsed.currency,
      isPrivate: parsed.isPrivate,
      institutionId,
      openedOn,
      closedOn: null,
      isSavings: parsed.isSavings ?? false,
      createdAt: at,
      updatedAt: at,
    };
    const rows = ownerRows(row.id, owners, at);
    tx.accounts.insert(row, rows);
    audit({
      entity: "account",
      entityId: row.id,
      accountId: row.id,
      action: "create",
      before: null,
      after: { ...row, owners: rows },
    });
    return row.id;
  });
}
