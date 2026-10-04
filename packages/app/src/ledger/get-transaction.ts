import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { LedgerTransaction } from "./list-transactions.ts";
import { toLedgerTransaction } from "./transaction-view.ts";

export const getTransactionInput = z.object({ id: z.string().min(1).max(100) }).strict();
export type GetTransactionInput = z.input<typeof getTransactionInput>;

/**
 * `ledger.getTransaction`: one live transaction with its splits, with a hidden name rendered by
 * `redact`. A missing or deleted transaction, and one in another person's private account, are
 * `NotFound`.
 */
export function getTransaction(ctx: UseCaseContext, input: GetTransactionInput): LedgerTransaction {
  const parsed = parseInput(getTransactionInput, input);
  const today = ctx.clock.today().toString();
  const row = ctx.uow.read((repos) => repos.transactions.findVisible(ctx.viewer, parsed.id, today));
  if (row === undefined) throw new AppError("NotFound", "Transaction not found");
  return toLedgerTransaction(ctx.viewer, row);
}
