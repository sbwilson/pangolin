import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { AccountRow, ReadRepos } from "../ports/unit-of-work.ts";
import { closingBalanceWarning } from "./closing-balance.ts";
import { idInput } from "./inputs.ts";
import { type AccountView, accountView, removalOf } from "./pool.ts";

export const listAccountsInput = z.object({ includeClosed: z.boolean().optional() }).strict();
export type ListAccountsInput = z.input<typeof listAccountsInput>;

/**
 * `accounts.listAccounts`: the open accounts the viewer can see (public ones and their own private ones), oldest first, each with owners and pool and a `removal` marker for a public account the viewer was taken off. A closed account is archived, never deleted: `closedOn` is the only archive state, and an account is closed once `closedOn` is today or earlier (an account with a later `closedOn` is still open). The default list leaves closed accounts out; `includeClosed: true` adds them. A closed cash account's closing-balance `warning` therefore shows only with `includeClosed`, on `getAccount` and in the review item. Which accounts the viewer can see does not change.
 */
export function listAccounts(ctx: UseCaseContext, input: ListAccountsInput = {}): AccountView[] {
  const parsed = parseInput(listAccountsInput, input);
  return ctx.uow.read((repos) => {
    const rows = repos.accounts.list(ctx.viewer);
    const today = ctx.clock.today().toString();
    const shown =
      parsed.includeClosed === true ? rows : rows.filter((row) => !isArchived(row, today));
    return shown.map((row) => viewOf(ctx, repos, row));
  });
}

/** Archived is closed: the closed date has come, so the ledger refuses later entries. */
function isArchived(row: AccountRow, today: string): boolean {
  return row.closedOn !== null && row.closedOn <= today;
}

/** The view of one account the viewer can see, with the removal marker for a removed person. */
function viewOf(
  ctx: UseCaseContext,
  repos: Pick<ReadRepos, "accounts" | "audit" | "balanceSnapshots">,
  row: AccountRow,
): AccountView {
  const owners = repos.accounts.owners(row.id);
  const viewer = ctx.viewer;
  const isOwner = viewer.kind !== "person" || owners.some((o) => o.personId === viewer.personId);
  const removal = isOwner
    ? undefined
    : removalOf(ctx.viewer, owners, repos.audit.ownerChanges(ctx.viewer, row.id));
  return accountView(row, owners, removal, closingBalanceWarning(repos, viewer, row));
}

export const getAccountInput = z.object({ id: idInput }).strict();
export type GetAccountInput = z.input<typeof getAccountInput>;

/** `accounts.getAccount`: one account by ID; another person's private account is `NotFound`. A person who was removed from a public account gets its `removal` marker. */
export function getAccount(ctx: UseCaseContext, input: GetAccountInput): AccountView {
  const parsed = parseInput(getAccountInput, input);
  return ctx.uow.read((repos) => {
    const row = repos.accounts.findVisible(ctx.viewer, parsed.id);
    if (row === undefined) throw new AppError("NotFound", "Account not found");
    return viewOf(ctx, repos, row);
  });
}
