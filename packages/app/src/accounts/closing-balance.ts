// A non-zero closing balance is a warning, never a block (decision of 2026-10-06): a closed cash
// account whose balance as of `closedOn` is not zero carries a warning on its view, and one
// account-scoped review item stays in step with it. "Closed" is `isClosed` (`closed-state.ts`):
// an account with a future `closedOn` has neither until the date arrives.
import type { UseCaseContext } from "../context.ts";
import type { AccountRow, BalanceSnapshotRepo, TxRepos } from "../ports/unit-of-work.ts";
import { defineReviewKind, raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import type { Viewer } from "../viewer.ts";
import type { Audit } from "../write.ts";
import { isClosed } from "./closed-state.ts";
import { type AccountWarning, CASH_ACCOUNT_TYPES } from "./pool.ts";

/** A closed account of a cash type still holds a balance. Account scope; entity `account:<id>`. */
export const CLOSING_BALANCE_REVIEW = defineReviewKind({
  kind: "accounts.closing-balance",
  module: "accounts",
  scope: "account",
});

const dedupeKey = (accountId: string) => `closing-balance:${accountId}`;

/**
 * The balance in cents of a closed cash account as of its `closedOn`, or null when the account
 * is not closed on `today` (open, or `closedOn` still ahead), not of a cash type, or the viewer
 * cannot see it. Zero is returned as 0, not null.
 */
export function closingBalanceOf(
  repos: { readonly balanceSnapshots: Pick<BalanceSnapshotRepo, "balanceAsOf"> },
  viewer: Viewer,
  account: Pick<AccountRow, "id" | "type" | "closedOn">,
  today: string,
): number | null {
  if (
    account.closedOn === null ||
    !isClosed(account, today) ||
    !CASH_ACCOUNT_TYPES.includes(account.type)
  ) {
    return null;
  }
  return repos.balanceSnapshots.balanceAsOf(viewer, account.id, account.closedOn) ?? null;
}

/** The `warning` an account view carries: present only for a non-zero closing balance. */
export function closingBalanceWarning(
  repos: { readonly balanceSnapshots: Pick<BalanceSnapshotRepo, "balanceAsOf"> },
  viewer: Viewer,
  account: Pick<AccountRow, "id" | "type" | "closedOn">,
  today: string,
): AccountWarning | undefined {
  const balanceCents = closingBalanceOf(repos, viewer, account, today);
  return balanceCents === null || balanceCents === 0
    ? undefined
    : { kind: "closing-balance", balanceCents };
}

/**
 * Brings the account's closing-balance review item in step with its balance, inside the
 * caller's write: raises it when the account is closed with a non-zero balance (idempotent),
 * resolves it when the balance is zero (`the closing balance reached zero`), the account is
 * open again (`the account was opened again`) or its closed date has not come
 * (`the closed date has not come`). Call it after any write that can change the
 * balance as of the closed date or the closed date itself. Does nothing for an account the
 * viewer cannot see.
 */
export function syncClosingBalance(
  tx: TxRepos,
  audit: Audit,
  ctx: Pick<UseCaseContext, "viewer" | "clock" | "newId">,
  accountId: string,
): void {
  const account = tx.accounts.findVisible(ctx.viewer, accountId);
  if (account === undefined) return;
  const today = ctx.clock.today().toString();
  const balance = closingBalanceOf(tx, ctx.viewer, account, today);
  const key = dedupeKey(account.id);
  if (balance !== null && balance !== 0) {
    raiseReviewItem(tx, audit, ctx, {
      kind: CLOSING_BALANCE_REVIEW,
      entityRef: `account:${account.id}`,
      dedupeKey: key,
      accountId: account.id,
    });
    return;
  }
  resolveReviewItem(tx, audit, ctx, {
    dedupeKey: key,
    resolution:
      account.closedOn === null
        ? "the account was opened again"
        : isClosed(account, today)
          ? "the closing balance reached zero"
          : "the closed date has not come",
  });
}
