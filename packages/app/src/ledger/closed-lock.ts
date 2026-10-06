import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import type { TxRepos } from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";

/** The most manually entered transactions a closed-account `Conflict` lists. */
export const CLOSED_CONFLICT_MANUAL_LIMIT = 20;

/**
 * The `details` of a closed-account `Conflict`: what a client needs to offer "move the closed
 * date" or "move these entries" without a second request. `closedOn` is the date the account
 * is (or would be) closed on; `latestEntryDate` is the latest of the account's live
 * transactions and balance snapshots (null when it has neither), and `latestSnapshotAsOf` the
 * latest balance snapshot's day alone (null when there is none), so a client can tell a snapshot
 * that blocks from a transaction that does. `manualEntries` are the
 * manually entered transactions (`importId` and `externalId` both null, read from the stored
 * columns) after `closedOn`, oldest first, up to 20; `importedCount` counts the others after it.
 */
export interface ClosedAccountDetails {
  readonly accountId: string;
  readonly closedOn: string;
  readonly latestEntryDate: string | null;
  readonly latestSnapshotAsOf: string | null;
  readonly manualEntries: readonly { readonly id: string; readonly postedOn: string }[];
  readonly importedCount: number;
}

/** Builds the details of a closed-account `Conflict` for an account `viewer` may see. */
export function closedAccountDetails(
  tx: TxRepos,
  viewer: Viewer,
  accountId: string,
  closedOn: string,
): ClosedAccountDetails {
  const latestEntry = tx.transactions.latestPostedOn(viewer, accountId);
  const [latestSnapshot] = tx.balanceSnapshots.listVisible(viewer, accountId);
  const dates = [latestEntry, latestSnapshot?.asOf].filter((d): d is string => d !== undefined);
  const latestEntryDate = dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b));
  const { manual, importedCount } = tx.transactions.listManualAfter(
    viewer,
    accountId,
    closedOn,
    CLOSED_CONFLICT_MANUAL_LIMIT,
  );
  return {
    accountId,
    closedOn,
    latestEntryDate,
    latestSnapshotAsOf: latestSnapshot?.asOf ?? null,
    manualEntries: manual,
    importedCount,
  };
}

/**
 * A closed account is a historical record: an entry (or a balance snapshot) dated after its
 * `closedOn` is locked until the account is opened again. Throws `Conflict` carrying
 * `ClosedAccountDetails` when `date` (`YYYY-MM-DD`) is after the account's `closedOn`. An open
 * account never refuses, and neither does the system viewer (the seed and jobs). Call it on a
 * person-initiated write only, never on invariant upkeep (decision 81's transfer unlink).
 */
export function requireOpenOn(
  ctx: UseCaseContext,
  tx: TxRepos,
  account: { readonly id: string; readonly closedOn: string | null },
  date: string,
  kind: "transaction" | "balance snapshot" = "transaction",
): void {
  if (ctx.viewer.kind === "system") return;
  const { closedOn } = account;
  if (closedOn === null || date <= closedOn) return;
  throw new AppError(
    "Conflict",
    `This account was closed on ${closedOn}, so a ${kind} dated ${date} is locked. ` +
      `Move the closed date to ${date} or later, move its manually entered transactions dated after ${closedOn} back to on or before it, or reopen the account.`,
    closedAccountDetails(tx, ctx.viewer, account.id, closedOn),
  );
}

/**
 * `requireOpenOn` for a transaction's account, found with `findVisible`. A transaction the
 * viewer can see always has a visible account, so a missing one is skipped.
 */
export function requireEntryOpen(
  ctx: UseCaseContext,
  tx: TxRepos,
  accountId: string,
  postedOn: string,
): void {
  if (ctx.viewer.kind === "system") return;
  const account = tx.accounts.findVisible(ctx.viewer, accountId);
  if (account === undefined) return;
  requireOpenOn(ctx, tx, account, postedOn);
}

/**
 * Throws `Conflict` carrying `ClosedAccountDetails` when closing the account on `closedOn`
 * (`YYYY-MM-DD`) would leave a live transaction or a balance snapshot after it. The system viewer
 * is exempt, as it is from `requireOpenOn`.
 */
export function requireClosableOn(
  ctx: UseCaseContext,
  tx: TxRepos,
  accountId: string,
  closedOn: string,
): void {
  if (ctx.viewer.kind === "system") return;
  const details = closedAccountDetails(tx, ctx.viewer, accountId, closedOn);
  if (details.latestEntryDate === null || details.latestEntryDate <= closedOn) return;
  const blockers = [
    details.manualEntries.length + details.importedCount > 0 ? "a later transaction" : null,
    details.latestSnapshotAsOf !== null && details.latestSnapshotAsOf > closedOn
      ? `a balance snapshot dated ${details.latestSnapshotAsOf}`
      : null,
  ].filter((b): b is string => b !== null);
  throw new AppError(
    "Conflict",
    `This account cannot close on ${closedOn}: it has ${blockers.join(" and ")} (latest ${details.latestEntryDate}). ` +
      `Close it on ${details.latestEntryDate} or later, move its manually entered transactions dated after ${closedOn} back to on or before it, or leave the account open.`,
    details,
  );
}
