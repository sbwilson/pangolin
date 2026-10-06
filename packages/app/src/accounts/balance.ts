import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { requireOpenOn } from "../ledger/closed-lock.ts";
import { BALANCE_SOURCES, type BalanceSnapshotRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { syncClosingBalance } from "./closing-balance.ts";
import { dayInput, idInput } from "./inputs.ts";
import { CASH_ACCOUNT_TYPES } from "./pool.ts";

export { CASH_ACCOUNT_TYPES };

export const recordBalanceSnapshotInput = z
  .object({
    accountId: idInput,
    /** `YYYY-MM-DD`; the snapshot covers that whole day. */
    asOf: dayInput,
    /** Signed: loans and credit cards are negative (AD-12). */
    balanceCents: z.int(),
    source: z.enum(BALANCE_SOURCES).optional(),
  })
  .strict();
export type RecordBalanceSnapshotInput = z.input<typeof recordBalanceSnapshotInput>;

/**
 * `accounts.recordBalanceSnapshot`: records an account's balance on one day, for any viewer who
 * can see the account (`manual` unless a source is given). Another person's private account is
 * `NotFound`. On a closed account an `asOf` after its `closedOn` is a `Conflict`. Audited as one `create` of `balance_snapshot` with the `accountId`.
 */
export function recordBalanceSnapshot(
  ctx: UseCaseContext,
  input: RecordBalanceSnapshotInput,
): BalanceSnapshotRow {
  const parsed = parseInput(recordBalanceSnapshotInput, input);
  return write(ctx, (tx, audit) => {
    const account = tx.accounts.findVisible(ctx.viewer, parsed.accountId);
    if (account === undefined) throw new AppError("NotFound", "Account not found");
    requireOpenOn(ctx, tx, account, parsed.asOf, "balance snapshot");
    const at = formatInstant(ctx.clock.now());
    const row: BalanceSnapshotRow = {
      id: ctx.newId<"BalanceSnapshot">(),
      accountId: account.id,
      asOf: parsed.asOf,
      balanceCents: parsed.balanceCents,
      source: parsed.source ?? "manual",
      createdAt: at,
      updatedAt: at,
    };
    tx.balanceSnapshots.insert(row);
    audit({
      entity: "balance_snapshot",
      entityId: row.id,
      accountId: account.id,
      action: "create",
      before: null,
      after: row,
    });
    syncClosingBalance(tx, audit, ctx, account.id);
    return row;
  });
}

export const listBalanceSnapshotsInput = z.object({ accountId: idInput }).strict();
export type ListBalanceSnapshotsInput = z.input<typeof listBalanceSnapshotsInput>;

/** `accounts.listBalanceSnapshots`: an account's snapshots, newest day first; `NotFound` for an account the viewer cannot see. */
export function listBalanceSnapshots(
  ctx: UseCaseContext,
  input: ListBalanceSnapshotsInput,
): BalanceSnapshotRow[] {
  const parsed = parseInput(listBalanceSnapshotsInput, input);
  return ctx.uow.read((repos) => {
    if (repos.accounts.findVisible(ctx.viewer, parsed.accountId) === undefined) {
      throw new AppError("NotFound", "Account not found");
    }
    return repos.balanceSnapshots.listVisible(ctx.viewer, parsed.accountId);
  });
}

export const balanceAsOfInput = z
  .object({
    accountId: idInput,
    /** `YYYY-MM-DD`; today (by the clock) when omitted. */
    date: dayInput.optional(),
  })
  .strict();
export type BalanceAsOfInput = z.input<typeof balanceAsOfInput>;

/**
 * `accounts.balanceAsOf` (AD-19): the account's balance in cents on `date`, from the one db
 * function `balanceAsOf`. Cash types only (transaction, savings, offset, credit card, home
 * loan); any other type is `Validation`. Another person's private account is `NotFound`.
 */
export function balanceAsOf(ctx: UseCaseContext, input: BalanceAsOfInput): number {
  const parsed = parseInput(balanceAsOfInput, input);
  const date = parsed.date ?? ctx.clock.today().toString();
  return ctx.uow.read((repos) => {
    const account = repos.accounts.findVisible(ctx.viewer, parsed.accountId);
    if (account === undefined) throw new AppError("NotFound", "Account not found");
    if (!CASH_ACCOUNT_TYPES.includes(account.type)) {
      throw new AppError("Validation", `A ${account.type} account has no snapshot balance`);
    }
    const balance = repos.balanceSnapshots.balanceAsOf(ctx.viewer, account.id, date);
    if (balance === undefined) throw new AppError("NotFound", "Account not found");
    return balance;
  });
}
