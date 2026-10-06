import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { clearCredentials, unusablePasswordHash } from "../identity/re-enrolment.ts";
import { requireRecentAuth } from "../identity/reauth.ts";
import { auditSnapshot } from "../ledger/transaction-view.ts";
import type { TokenPort } from "../ports/tokens.ts";
import type { AccountRow, PersonRow, TxRepos } from "../ports/unit-of-work.ts";
import { type Audit, write } from "../write.ts";
import { FULL_SHARE_BP, ownerRows } from "./inputs.ts";

export const leaveHouseholdInput = z.object({ confirm: z.literal(true) }).strict();
export type LeaveHouseholdInput = z.input<typeof leaveHouseholdInput>;

/** A use-case context that can mint the random bytes of an unusable password. */
export interface LeaveHouseholdContext extends UseCaseContext {
  readonly tokens: TokenPort;
}

/**
 * `accounts.leaveHousehold`: the signed-in person leaves the household and takes their private
 * data with them (Simon's decision of 2026-10-06). Behind a confirmation (`confirm: true`, else
 * `Validation`) and a recent sign-in (`ReauthRequired`); either missing changes nothing. With no
 * other active person to hand the shared accounts to it is `Conflict`, and nothing changes.
 *
 * In one transaction it:
 *  - lifts every hiding of a transaction name the leaver made, also on an account that has since
 *    turned private to the partner, as an upkeep write that bypasses the closed-date lock;
 *  - hard-deletes the leaver's payees, aliases, tags and activities (`scope_person_id`), nulling
 *    the references to them that remain on other rows, and their person-scoped review items;
 *  - hard-deletes each private account of the leaver, with its transactions, splits, split tags,
 *    snapshots, owner rows, transfer-group links, account-scoped review items and audit rows. The
 *    surviving side of a transfer is unlinked and kept (decision 81);
 *  - makes the partner the sole owner of every other account the leaver owned (the shared
 *    accounts and their expenses stay), through an owner swap that does not touch
 *    `updateAccount`'s last-owner rule;
 *  - marks the person as left (`person.deleted_at`) and revokes their passkeys, authenticator,
 *    recovery codes and sessions, making the password unusable;
 *  - erases every audit row scoped to the leaver (`person_id`). Audit rows of shared data stay,
 *    whoever authored them.
 *
 * Backups taken earlier keep the data (accepted). The confirmation and re-authentication screens
 * belong to the app shell epic.
 */
export function leaveHousehold(ctx: LeaveHouseholdContext, input: LeaveHouseholdInput): void {
  parseInput(leaveHouseholdInput, input);
  const viewer = ctx.viewer;
  if (viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");
  requireRecentAuth(ctx);
  // Drawn before the write (AD-2): the random bytes of the password nobody will know.
  const unusable = unusablePasswordHash(ctx.tokens);
  write(ctx, (tx, audit) => {
    const active = tx.person.listActive();
    const leaver = active.find((person) => person.id === viewer.personId);
    if (leaver === undefined) throw new AppError("Unauthenticated", "Sign in first");
    const partner = active.find((person) => person.id !== leaver.id);
    if (partner === undefined) {
      throw new AppError("Conflict", "There is no one to hand the shared accounts to");
    }
    const at = formatInstant(ctx.clock.now());
    const accounts = knownAccounts(tx, leaver.id, partner.id);

    liftHidings(tx, audit, accounts, leaver.id, at);
    deleteScopedRows(tx, leaver.id);
    for (const owned of tx.accounts.ownedBy(leaver.id)) {
      if (owned.row.isPrivate) deleteAccountRows(tx, audit, accounts, owned.row.id, at);
      else handOver(tx, audit, owned.row, partner.id, at);
    }
    tx.reviewItems.deleteForPerson(leaver.id);

    if (!tx.person.markLeft(leaver.id, at)) {
      throw new Error(`Person ${leaver.id} vanished during their leave`);
    }
    audit({
      entity: "person",
      entityId: leaver.id,
      action: "leave",
      before: leaver,
      after: { ...leaver, updatedAt: at, deletedAt: at } satisfies PersonRow,
    });
    if (leaver.userId !== null) {
      clearCredentials(
        ctx,
        tx,
        audit,
        { ...leaver, userId: leaver.userId },
        "left-household",
        unusable,
      );
    }
    // Last, so no row this write scoped to the leaver outlives it.
    tx.audit.deleteForPerson(leaver.id);
  });
}

/**
 * What the leave knows of the accounts it touches (the leaver's and the partner's, whoever can
 * see them), for the scope an upkeep audit row carries: a private account's owner reads it alone.
 */
interface Accounts {
  /**
   * The audit scope of an upkeep write on a row of `accountId`: the account's owner when it is
   * private, else the leaver, whose scoped rows the leave erases. Never the household's.
   */
  scopeOf(accountId: string): { readonly personId: string };
  /** The audit scope of the survivor of a transfer: its private account's owner, else none. */
  survivorScopeOf(accountId: string): { readonly personId?: string };
}

function knownAccounts(tx: TxRepos, leaver: Id<"Person">, partner: Id<"Person">): Accounts {
  const rows = new Map<string, AccountRow>();
  for (const person of [leaver, partner]) {
    for (const { row } of tx.accounts.ownedBy(person)) rows.set(row.id, row);
  }
  const ownerOf = (accountId: string): string | undefined =>
    rows.get(accountId)?.isPrivate === true
      ? tx.accounts.owners(accountId)[0]?.personId
      : undefined;
  return {
    scopeOf: (accountId) => ({ personId: ownerOf(accountId) ?? leaver }),
    survivorScopeOf: (accountId) => {
      const owner = ownerOf(accountId);
      return owner === undefined ? {} : { personId: owner };
    },
  };
}

/**
 * Lifts every hiding the leaver made (`nameHiddenBy`), lapsed or not, wherever the transaction
 * is. Not `unhideTransactionName`: the leaver may no longer see the row, and the closed-date lock
 * does not apply to upkeep. Each lift is audited as an update scoped to the account's owner when
 * it is private, else to the leaver. The leaver's scoped rows, and those of a private account the
 * leave deletes, are erased later in the same write; only a lift on an account that has turned
 * private to the partner survives, readable by the partner alone.
 */
function liftHidings(
  tx: TxRepos,
  audit: Audit,
  accounts: Accounts,
  leaver: Id<"Person">,
  at: string,
): void {
  const hidings = tx.transactions.hidingsBy(leaver);
  if (hidings.length === 0) return;
  tx.transactions.clearNameHidden(
    hidings.map((row) => row.id),
    at,
  );
  for (const before of hidings) {
    const snapshot = auditSnapshot(before);
    audit({
      entity: "transaction",
      entityId: before.id,
      accountId: before.accountId,
      ...accounts.scopeOf(before.accountId),
      action: "update",
      before: snapshot,
      after: { ...snapshot, nameHiddenBy: null, nameHiddenUntil: null, updatedAt: at },
    });
  }
}

/**
 * Hard-deletes what is scoped to the leaver (AD-18): aliases, payees, tags and activities, with
 * the references that remain on other rows cleared first (foreign keys). A shared transaction or
 * split that used one keeps everything else.
 */
function deleteScopedRows(tx: TxRepos, leaver: Id<"Person">): void {
  tx.transactions.clearScopedPayees(leaver);
  tx.payeeAliases.deleteScopedTo(leaver);
  tx.payees.deleteScopedTo(leaver);
  tx.tags.deleteScopedTo(leaver);
  tx.activities.deleteScopedTo(leaver);
}

/**
 * Makes `partner` the sole owner of an account of the leaver's that is not private, with the
 * whole share. Audited as `updateAccount` and `rejoinAccount` audit an owner change. The
 * account's own row is untouched.
 */
function handOver(
  tx: TxRepos,
  audit: Audit,
  account: AccountRow,
  partner: Id<"Person">,
  at: string,
): void {
  const before = tx.accounts.owners(account.id);
  const after = ownerRows(account.id, [{ personId: partner, shareBp: FULL_SHARE_BP }], at, before);
  tx.accounts.replaceOwners(account.id, after);
  audit({
    entity: "account",
    entityId: account.id,
    accountId: account.id,
    action: "update",
    before: { ...account, owners: before },
    after: { ...account, owners: after },
  });
}

/**
 * The cascade of a private account's delete: transfer-group links (the other side of a transfer
 * is kept and unlinked, audited as its owner's, decision 81), account-scoped review items,
 * balance snapshots, transactions with their splits and split tags, the owner rows and the
 * account, then every audit row of the account. The account's use cases never delete one (a
 * closed account is archived); this is internal to the leave and deliberately not exported.
 */
function deleteAccountRows(
  tx: TxRepos,
  audit: Audit,
  accounts: Accounts,
  accountId: string,
  at: string,
): void {
  const groups = tx.transferGroups.idsInAccount(accountId);
  for (const groupId of groups) {
    const survivors = tx.transferGroups
      .upkeepMembers(groupId)
      .filter((member) => member.accountId !== accountId);
    tx.transactions.setTransferGroup(
      survivors.map((member) => member.id),
      null,
      at,
    );
    // The rest of the group, this account's rows and any deleted ones, goes with it.
    tx.transactions.unlinkGroup(groupId);
    for (const survivor of survivors) {
      audit({
        entity: "transaction",
        entityId: survivor.id,
        accountId: survivor.accountId,
        ...accounts.survivorScopeOf(survivor.accountId),
        action: "update",
        before: survivor,
        after: { ...survivor, transferGroupId: null, updatedAt: at },
      });
    }
  }
  tx.reviewItems.deleteForAccount(accountId);
  tx.balanceSnapshots.deleteForAccount(accountId);
  tx.transactions.deleteForAccount(accountId);
  for (const groupId of groups) {
    if (!tx.transferGroups.delete(groupId)) {
      throw new Error(`Transfer group ${groupId} vanished during an account's deletion`);
    }
  }
  tx.accounts.deleteRows(accountId);
  tx.audit.deleteForAccount(accountId);
}
