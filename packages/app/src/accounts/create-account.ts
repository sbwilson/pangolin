import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { ACCOUNT_TYPES, type AccountOwnerRow, type AccountRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

const FULL_SHARE_BP = 10_000;

export const createAccountInput = z
  .object({
    name: z.string().trim().min(1, { message: "Enter a name" }).max(100),
    type: z.enum(ACCOUNT_TYPES),
    /** ISO 4217 code; v1 requires it to match the household's base currency. */
    currency: z.string().regex(/^[A-Z]{3}$/, { message: "Expected an ISO 4217 code" }),
    isPrivate: z.boolean(),
    owners: z
      .array(
        z
          .object({
            personId: z.string().min(1).max(100),
            /** Basis points: 5000 = 50%. */
            shareBp: z.int().min(1).max(FULL_SHARE_BP),
          })
          .strict(),
      )
      .min(1, { message: "An account needs an owner" })
      .max(2),
  })
  .strict();
export type CreateAccountInput = z.input<typeof createAccountInput>;

/**
 * `accounts.createAccount`: adds an account with its owners, audited as one `create` of
 * `account` (carrying its own `accountId`). A private account has exactly one owner, with the
 * whole share; shares otherwise sum to 100%. A person may create a private account only for
 * themselves. Returns the new account's server-minted ID.
 */
export function createAccount(ctx: UseCaseContext, input: CreateAccountInput): Id<"Account"> {
  const parsed = parseInput(createAccountInput, input);
  const owners = parsed.owners;
  if (new Set(owners.map((owner) => owner.personId)).size !== owners.length) {
    throw new AppError("Validation", "An owner is listed twice");
  }
  if (parsed.isPrivate) {
    const [only] = owners;
    if (owners.length !== 1 || only?.shareBp !== FULL_SHARE_BP) {
      throw new AppError("Validation", "A private account has one owner with the whole share");
    }
    if (ctx.viewer.kind === "person" && only.personId !== ctx.viewer.personId) {
      throw new AppError("Validation", "You can only make a private account for yourself");
    }
  } else if (owners.reduce((sum, owner) => sum + owner.shareBp, 0) !== FULL_SHARE_BP) {
    throw new AppError("Validation", "Owner shares must add up to 100%");
  }

  return write(ctx, (tx, audit) => {
    const { baseCurrency } = tx.householdSettings.get();
    if (parsed.currency !== baseCurrency) {
      throw new AppError("Validation", `The currency must be the base currency, ${baseCurrency}`);
    }
    const people = new Set(tx.person.listActive().map((person) => person.id as string));
    for (const owner of owners) {
      if (!people.has(owner.personId)) throw new AppError("Validation", "Unknown owner");
    }
    const at = formatInstant(ctx.clock.now());
    const row: AccountRow = {
      id: ctx.newId<"Account">(),
      name: parsed.name,
      type: parsed.type,
      currency: parsed.currency,
      isPrivate: parsed.isPrivate,
      createdAt: at,
      updatedAt: at,
    };
    const ownerRows: AccountOwnerRow[] = owners.map((owner) => ({
      accountId: row.id,
      personId: owner.personId as Id<"Person">,
      shareBp: owner.shareBp,
      createdAt: at,
      updatedAt: at,
    }));
    tx.accounts.insert(row, ownerRows);
    audit({
      entity: "account",
      entityId: row.id,
      accountId: row.id,
      action: "create",
      before: null,
      after: { ...row, owners: ownerRows },
    });
    return row.id;
  });
}
