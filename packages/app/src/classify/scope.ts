// The one place a classification row's scope is derived (AD-18). Create takes an optional
// origin account and never a client-supplied scope.
import type { Id } from "@pangolin/shared";
import { z } from "zod";
import { idInput } from "../accounts/inputs.ts";
import { AppError } from "../errors.ts";
import type { TxRepos } from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";

export const nameInput = z.string().trim().min(1, { message: "Enter a name" }).max(100);

/** The optional origin account of a scoped create. */
export const originInput = idInput.nullish();

/** Where a scoped row lives: shared (`scopePersonId` null) or one person's alone. */
export interface Scope {
  readonly scopePersonId: Id<"Person"> | null;
  /** The private origin account to store, or null (never serialised). */
  readonly origin: Id<"Account"> | null;
}

/**
 * `scopeFor(tx, viewer, originAccountId)`: no origin, or a public origin account, gives a shared
 * row; a private origin account gives the account's sole owner as the scope and stores the
 * origin. An account the viewer cannot see is `NotFound` (AD-5); a private account with no
 * owner (corrupt data) is `Conflict`.
 */
export function scopeFor(
  tx: TxRepos,
  viewer: Viewer,
  originAccountId: string | null | undefined,
): Scope {
  if (originAccountId === null || originAccountId === undefined) {
    return { scopePersonId: null, origin: null };
  }
  const account = tx.accounts.findVisible(viewer, originAccountId);
  if (account === undefined) throw new AppError("NotFound", "Account not found");
  if (!account.isPrivate) return { scopePersonId: null, origin: null };
  const [owner] = tx.accounts.owners(account.id);
  if (owner === undefined) throw new AppError("Conflict", "This account has no owner");
  return { scopePersonId: owner.personId, origin: account.id };
}

/**
 * The audit scope of a scoped row: `personId` = its scope person, plus `accountId` of the origin
 * only when it is private. Household-wide and shared rows carry neither.
 */
export function auditScope(
  scopePersonId: string | null,
  origin: string | null,
): { personId?: string; accountId?: string } {
  return {
    ...(scopePersonId === null ? {} : { personId: scopePersonId }),
    ...(origin === null ? {} : { accountId: origin }),
  };
}
