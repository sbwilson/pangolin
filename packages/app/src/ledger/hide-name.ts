import { formatDate, formatInstant, parseDate } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { VisibleTransaction } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import type { LedgerTransaction } from "./list-transactions.ts";
import { auditSnapshot, tagsOf, toLedgerTransaction } from "./transaction-view.ts";

/** A hiding lasts at most this many calendar months from today. */
export const MAX_HIDE_MONTHS = 12;

const dayInput = z.string().refine(
  (value) => {
    try {
      parseDate(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Expected a real YYYY-MM-DD date" },
);

export const hideTransactionNameInput = z
  .object({ id: z.string().min(1).max(100), until: dayInput.optional() })
  .strict();
export type HideTransactionNameInput = z.input<typeof hideTransactionNameInput>;

export const unhideTransactionNameInput = z.object({ id: z.string().min(1).max(100) }).strict();
export type UnhideTransactionNameInput = z.input<typeof unhideTransactionNameInput>;

function personOf(ctx: UseCaseContext): string {
  if (ctx.viewer.kind !== "person") {
    throw new AppError("Validation", "Only a person can hide or unhide a name");
  }
  return ctx.viewer.personId;
}

/** True while the row's hiding is in force (`nameHiddenUntil` after today). */
function active(row: VisibleTransaction, today: string): boolean {
  return row.nameHiddenUntil !== null && row.nameHiddenUntil.slice(0, 10) > today;
}

/**
 * Fails with `Conflict` when a hiding is active and set by someone other than `me`: only the
 * hider may re-hide or unhide it (the other person cannot see the name).
 */
function requireHider(row: VisibleTransaction, me: string, today: string): void {
  if (active(row, today) && row.nameHiddenBy !== me) {
    throw new AppError("Conflict", "This name is hidden by someone else");
  }
}

/**
 * `ledger.hideTransactionName`: hides a live transaction's payee and description from the other
 * owner of a shared account until `until` (`YYYY-MM-DD`, after today and at most 12 calendar
 * months out; default the 12-month maximum). Sets `nameHiddenBy` to the viewer; re-hiding
 * replaces both columns. While another person's hiding is active it is a `Conflict`; a lapsed
 * one may be replaced. A private account is `Validation`; a missing, deleted or partner-private
 * transaction is `NotFound`. Amount, date, category, tags and notes are untouched. Audited as one
 * `update` of `transaction` with its `accountId`.
 */
export function hideTransactionName(
  ctx: UseCaseContext,
  input: HideTransactionNameInput,
): LedgerTransaction {
  const parsed = parseInput(hideTransactionNameInput, input);
  const me = personOf(ctx);
  const todayDate = ctx.clock.today();
  const today = todayDate.toString();
  const max = formatDate(todayDate.add({ months: MAX_HIDE_MONTHS }));
  const until = parsed.until ?? max;
  if (until <= today) throw new AppError("Validation", "Choose a day after today");
  if (until > max) {
    throw new AppError("Validation", `A name can be hidden for at most ${MAX_HIDE_MONTHS} months`);
  }
  return write(ctx, (tx, audit) => {
    const before = tx.transactions.findVisible(ctx.viewer, parsed.id, today);
    if (before === undefined) throw new AppError("NotFound", "Transaction not found");
    const account = tx.accounts.findVisible(ctx.viewer, before.accountId);
    if (account === undefined) throw new AppError("NotFound", "Transaction not found");
    if (account.isPrivate) {
      throw new AppError("Validation", "A name in a private account cannot be hidden");
    }
    requireHider(before, me, today);
    const at = formatInstant(ctx.clock.now());
    if (!tx.transactions.setNameHidden(ctx.viewer, before.id, me, until, at)) {
      throw new AppError("NotFound", "Transaction not found");
    }
    return finish(ctx, tx, audit, before, today);
  });
}

/**
 * `ledger.unhideTransactionName`: clears `nameHiddenBy` and `nameHiddenUntil`. Does nothing, and
 * audits nothing, when none is set. While another person's hiding is active it is a `Conflict`.
 * A missing, deleted or partner-private transaction is `NotFound`.
 */
export function unhideTransactionName(
  ctx: UseCaseContext,
  input: UnhideTransactionNameInput,
): LedgerTransaction {
  const parsed = parseInput(unhideTransactionNameInput, input);
  const me = personOf(ctx);
  const today = ctx.clock.today().toString();
  return write(ctx, (tx, audit) => {
    const before = tx.transactions.findVisible(ctx.viewer, parsed.id, today);
    if (before === undefined) throw new AppError("NotFound", "Transaction not found");
    if (before.nameHiddenBy === null && before.nameHiddenUntil === null) {
      return toLedgerTransaction(ctx.viewer, before, tagsOf(tx, ctx.viewer, before));
    }
    requireHider(before, me, today);
    const at = formatInstant(ctx.clock.now());
    if (!tx.transactions.setNameHidden(ctx.viewer, before.id, null, null, at)) {
      throw new AppError("NotFound", "Transaction not found");
    }
    return finish(ctx, tx, audit, before, today);
  });
}

function finish(
  ctx: UseCaseContext,
  tx: Parameters<Parameters<typeof write>[1]>[0],
  audit: Parameters<Parameters<typeof write>[1]>[1],
  before: VisibleTransaction,
  today: string,
): LedgerTransaction {
  const after = tx.transactions.findVisible(ctx.viewer, before.id, today);
  if (after === undefined) throw new Error(`Transaction ${before.id} vanished during its update`);
  audit({
    entity: "transaction",
    entityId: before.id,
    accountId: before.accountId,
    action: "update",
    before: auditSnapshot(before),
    after: auditSnapshot(after),
  });
  return toLedgerTransaction(ctx.viewer, after, tagsOf(tx, ctx.viewer, after));
}
