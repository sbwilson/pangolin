import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { AccountRow, ReadRepos } from "../ports/unit-of-work.ts";
import { idInput } from "./inputs.ts";
import { type AccountView, accountView, removalOf } from "./pool.ts";

export const listAccountsInput = z.object({}).strict();
export type ListAccountsInput = z.input<typeof listAccountsInput>;

/** `accounts.listAccounts`: the accounts the viewer can see (public ones and their own private ones), oldest first, each with owners and pool, and a `removal` marker for a public account the viewer was taken off. */
export function listAccounts(ctx: UseCaseContext, input: ListAccountsInput = {}): AccountView[] {
  parseInput(listAccountsInput, input);
  return ctx.uow.read((repos) =>
    repos.accounts.list(ctx.viewer).map((row) => viewOf(ctx, repos, row)),
  );
}

/** The view of one account the viewer can see, with the removal marker for a removed person. */
function viewOf(
  ctx: UseCaseContext,
  repos: Pick<ReadRepos, "accounts" | "audit">,
  row: AccountRow,
): AccountView {
  const owners = repos.accounts.owners(row.id);
  const viewer = ctx.viewer;
  const isOwner = viewer.kind !== "person" || owners.some((o) => o.personId === viewer.personId);
  const removal = isOwner
    ? undefined
    : removalOf(ctx.viewer, owners, repos.audit.ownerChanges(ctx.viewer, row.id));
  return accountView(row, owners, removal);
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
