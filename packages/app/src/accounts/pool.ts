import type { AccountOwnerRow, AccountRow } from "../ports/unit-of-work.ts";

/** An account as the accounts use cases return it: the row, its owners and its pool. */
export interface AccountView extends AccountRow {
  readonly owners: readonly { readonly personId: string; readonly shareBp: number }[];
  /** `poolOf` of the owners: `shared`, or the sole owner's person ID (AD-26). */
  readonly pool: string;
}

/**
 * `accounts.poolOf` (AD-26): `shared` when the account has two or more owners, otherwise its
 * sole owner. Pure; nothing is stored. An account always has an owner.
 */
export function poolOf(owners: readonly { readonly personId: string }[]): string {
  const [first] = owners;
  if (first === undefined) throw new Error("An account has at least one owner");
  return owners.length >= 2 ? "shared" : first.personId;
}

/**
 * The payer of a transaction (AD-26): its `performedBy` person, else the account's sole owner,
 * else `shared` for a joint account. Pure.
 */
export function payerOf(
  owners: readonly { readonly personId: string }[],
  performedBy: string | null,
): string {
  return performedBy ?? poolOf(owners);
}

export function accountView(row: AccountRow, owners: readonly AccountOwnerRow[]): AccountView {
  return {
    ...row,
    owners: owners.map((owner) => ({ personId: owner.personId, shareBp: owner.shareBp })),
    pool: poolOf(owners),
  };
}
