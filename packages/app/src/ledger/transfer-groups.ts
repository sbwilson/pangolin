import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { write } from "../write.ts";
import type { LedgerTransaction } from "./list-transactions.ts";
import { auditSnapshot, tagsOf, toLedgerTransaction } from "./transaction-view.ts";

const idInput = z.string().min(1).max(100);

export const createTransferGroupInput = z
  .object({ transactionIds: z.tuple([idInput, idInput]) })
  .strict();
export type CreateTransferGroupInput = z.input<typeof createTransferGroupInput>;

export const deleteTransferGroupInput = z.object({ id: idInput }).strict();
export type DeleteTransferGroupInput = z.input<typeof deleteTransferGroupInput>;

/**
 * `ledger.createTransferGroup`: links two live transactions the viewer can see as both sides of a
 * transfer (`matched_by = manual`). They must be in different accounts, have amounts of opposite
 * sign that sum to 0 (`Validation`), and be in no group yet (`Conflict`); a missing or invisible
 * one is `NotFound`. A private-account transaction may be linked to a shared one by its owner.
 * Audited as one `update` of each `transaction` with its `accountId`.
 */
export function createTransferGroup(
  ctx: UseCaseContext,
  input: CreateTransferGroupInput,
): [LedgerTransaction, LedgerTransaction] {
  const { transactionIds } = parseInput(createTransferGroupInput, input);
  const [idA, idB] = transactionIds;
  if (idA === idB) throw new AppError("Validation", "Choose two different transactions");
  return write(ctx, (tx, audit) => {
    const today = ctx.clock.today().toString();
    const a = tx.transactions.findVisible(ctx.viewer, idA, today);
    const b = tx.transactions.findVisible(ctx.viewer, idB, today);
    if (a === undefined || b === undefined) throw new AppError("NotFound", "Transaction not found");
    if (a.accountId === b.accountId) {
      throw new AppError("Validation", "A transfer links two different accounts");
    }
    if (a.amountCents === 0 || a.amountCents + b.amountCents !== 0) {
      throw new AppError("Validation", "A transfer's two sides must have opposite amounts");
    }
    if (a.transferGroupId !== null || b.transferGroupId !== null) {
      throw new AppError("Conflict", "A transaction is already in a transfer group");
    }
    const at = formatInstant(ctx.clock.now());
    const groupId = ctx.newId<"TransferGroup">();
    tx.transferGroups.insert({ id: groupId, matchedBy: "manual", createdAt: at, updatedAt: at });
    if (tx.transactions.setTransferGroup([a.id, b.id], groupId, at) !== 2) {
      throw new Error("A transfer group's transactions vanished during its creation");
    }
    const linked = [a, b].map((before) => {
      const after = tx.transactions.findVisible(ctx.viewer, before.id, today);
      if (after === undefined)
        throw new Error(`Transaction ${before.id} vanished during its update`);
      audit({
        entity: "transaction",
        entityId: before.id,
        accountId: before.accountId,
        action: "update",
        before: auditSnapshot(before),
        after: auditSnapshot(after),
      });
      return toLedgerTransaction(ctx.viewer, after, tagsOf(tx, ctx.viewer, after));
    });
    return linked as [LedgerTransaction, LedgerTransaction];
  });
}

/**
 * `ledger.deleteTransferGroup`: clears the link on every transaction in the group (including
 * ones the viewer cannot see) and deletes the group. The viewer must see at least one live
 * member, else `NotFound`. Audited as one `update` of each member `transaction` with its
 * `accountId`.
 */
export function deleteTransferGroup(ctx: UseCaseContext, input: DeleteTransferGroupInput): void {
  const parsed = parseInput(deleteTransferGroupInput, input);
  write(ctx, (tx, audit) => {
    if (tx.transferGroups.find(ctx.viewer, parsed.id) === undefined) {
      throw new AppError("NotFound", "Transfer group not found");
    }
    const members = tx.transferGroups.members(parsed.id);
    const at = formatInstant(ctx.clock.now());
    tx.transactions.setTransferGroup(
      members.map((m) => m.id),
      null,
      at,
    );
    if (!tx.transferGroups.delete(parsed.id)) {
      throw new AppError("NotFound", "Transfer group not found");
    }
    for (const before of members) {
      audit({
        entity: "transaction",
        entityId: before.id,
        accountId: before.accountId,
        action: "update",
        before,
        after: { ...before, transferGroupId: null, updatedAt: at },
      });
    }
  });
}
