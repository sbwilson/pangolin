import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "./inputs.ts";
import { type AccountView, accountView } from "./pool.ts";

export const listAccountsInput = z.object({}).strict();
export type ListAccountsInput = z.input<typeof listAccountsInput>;

/** `accounts.listAccounts`: the accounts the viewer can see (public ones and their own private ones), oldest first, each with owners and pool. */
export function listAccounts(ctx: UseCaseContext, input: ListAccountsInput = {}): AccountView[] {
  parseInput(listAccountsInput, input);
  return ctx.uow.read((repos) =>
    repos.accounts.list(ctx.viewer).map((row) => accountView(row, repos.accounts.owners(row.id))),
  );
}

export const getAccountInput = z.object({ id: idInput }).strict();
export type GetAccountInput = z.input<typeof getAccountInput>;

/** `accounts.getAccount`: one account by ID; another person's private account is `NotFound`. */
export function getAccount(ctx: UseCaseContext, input: GetAccountInput): AccountView {
  const parsed = parseInput(getAccountInput, input);
  return ctx.uow.read((repos) => {
    const row = repos.accounts.findVisible(ctx.viewer, parsed.id);
    if (row === undefined) throw new AppError("NotFound", "Account not found");
    return accountView(row, repos.accounts.owners(row.id));
  });
}
