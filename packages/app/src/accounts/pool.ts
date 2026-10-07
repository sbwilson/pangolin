import { AppError } from "../errors.ts";
import type {
  AccountOwnerRow,
  AccountRow,
  AccountType,
  AuditedOwner,
  OwnerChange,
} from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";

/** The types whose balance is a snapshot plus the transactions after it (AD-19). */
export const CASH_ACCOUNT_TYPES: readonly AccountType[] = [
  "transaction",
  "savings",
  "offset",
  "credit_card",
  "home_loan",
];

/** Who took a person off an account's owners, when, and who the owners were before. */
export interface AccountRemoval {
  /** The person (or `job:`/`cli:` actor) whose owner change dropped the viewer. */
  readonly by: string;
  /** UTC ISO-8601 timestamp of that change. */
  readonly at: string;
  /** The owners and shares just before the change; `rejoinAccount` restores the viewer's. */
  readonly previousOwners: readonly AuditedOwner[];
}

/** An account as the accounts use cases return it: the row, its owners and its pool. */
export interface AccountView extends AccountRow {
  readonly owners: readonly { readonly personId: string; readonly shareBp: number }[];
  /** `poolOf` of the owners: `shared`, or the sole owner's person ID (AD-26). */
  readonly pool: string;
  /**
   * Present only for a person who is not an owner but was one: the latest owner change that
   * dropped them (derived from the audit log, nothing is stored).
   */
  readonly removal?: AccountRemoval;
  /**
   * Present only for a closed cash account (`closedOn` today or earlier, `isClosed`; a later
   * `closedOn` is not closed yet) whose balance as of `closedOn` is not zero (derived on read; a
   * warning, never a block). `balanceCents` is that balance.
   */
  readonly warning?: AccountWarning;
}

/** A closed account still holds a balance. */
export interface AccountWarning {
  readonly kind: "closing-balance";
  readonly balanceCents: number;
}

/**
 * `accounts.poolOf` (AD-26): `shared` when the account has two or more owners, otherwise its
 * sole owner. Pure; nothing is stored. An account always has an owner: one without (corrupt
 * data) is `Conflict`, so one bad row fails with a typed error rather than a 500.
 */
export function poolOf(owners: readonly { readonly personId: string }[]): string {
  const [first] = owners;
  if (first === undefined) throw new AppError("Conflict", "This account has no owner");
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

export function accountView(
  row: AccountRow,
  owners: readonly AccountOwnerRow[],
  removal?: AccountRemoval,
  warning?: AccountWarning,
): AccountView {
  return {
    ...row,
    owners: owners.map((owner) => ({ personId: owner.personId, shareBp: owner.shareBp })),
    pool: poolOf(owners),
    ...(removal === undefined ? {} : { removal }),
    ...(warning === undefined ? {} : { warning }),
  };
}

/**
 * The removal marker for `viewer` (oldest-first `changes` from `AuditRepo.ownerChanges`): the
 * latest change whose before-owners hold the viewer and whose after-owners do not, while the
 * viewer is not an owner now. Undefined for the system viewer, for an owner and for a person
 * who never was one. A person who left by their own change is marked too (`by` is themself).
 */
export function removalOf(
  viewer: Viewer,
  owners: readonly { readonly personId: string }[],
  changes: readonly OwnerChange[],
): AccountRemoval | undefined {
  if (viewer.kind !== "person") return undefined;
  const me: string = viewer.personId;
  if (owners.some((owner) => owner.personId === me)) return undefined;
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i] as OwnerChange;
    if (
      change.before.some((owner) => owner.personId === me) &&
      !change.after.some((owner) => owner.personId === me)
    ) {
      return {
        by: change.actor.startsWith("person:")
          ? change.actor.slice("person:".length)
          : change.actor,
        at: change.at,
        previousOwners: change.before,
      };
    }
  }
  return undefined;
}
