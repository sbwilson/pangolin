import { AppError } from "../errors.ts";
import type { TxRepos } from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";

// Checks shared by the split use cases. A target the viewer cannot see (missing, deleted, or
// another person's scoped row) is `NotFound`, so nothing reveals that it exists.

export function requireCategory(tx: TxRepos, viewer: Viewer, id: string): void {
  if (tx.categories.find(viewer, id) === undefined) {
    throw new AppError("NotFound", "Category not found");
  }
}

/**
 * An activity the viewer can see. On a public account (`isPublic`) an owner-scoped activity is
 * `Conflict`: it would put one person's private classification on a shared split (AD-18), the
 * same refusal tags and payees give.
 */
export function requireActivity(tx: TxRepos, viewer: Viewer, id: string, isPublic: boolean): void {
  const found = tx.activities.find(viewer, id);
  if (found === undefined) throw new AppError("NotFound", "Activity not found");
  if (isPublic && found.scopePersonId !== null) {
    throw new AppError("Conflict", "This activity cannot be used on a shared account yet");
  }
}

export function requireTaxCategory(tx: TxRepos, viewer: Viewer, id: string): void {
  if (tx.taxCategories.find(viewer, id) === undefined) {
    throw new AppError("NotFound", "Tax category not found");
  }
}

/** `shared` or an existing person. */
export function requireBeneficiary(
  tx: TxRepos,
  value: string,
  fail: (message: string) => AppError,
) {
  if (value === "shared") return;
  if (!tx.person.listActive().some((p) => p.id === value)) throw fail("Unknown beneficiary");
}

/**
 * The owner of a private account (AD-7: its splits' beneficiary), or null for a public one.
 * The viewer can see the account, because they can see the transaction.
 */
export function privateOwner(tx: TxRepos, viewer: Viewer, accountId: string): string | null {
  const account = tx.accounts.findVisible(viewer, accountId);
  if (account === undefined || !account.isPrivate) return null;
  const [owner] = tx.accounts.owners(accountId);
  if (owner === undefined) throw new Error(`Private account ${accountId} has no owner`);
  return owner.personId;
}
