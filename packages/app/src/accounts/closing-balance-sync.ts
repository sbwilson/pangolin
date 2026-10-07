// The daily closing-balance sync (Epic 2 retrospective, finding Q1). A read cannot raise the
// review item and a write is not guaranteed on the day, so this job is the one place a closed
// date arriving becomes a review item. The warning on the account view is derived on read and
// needs no job.
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { defineJobKind, defineSchedule, type Schedule } from "../jobs/registry.ts";
import { dailyAt } from "../system/backups.ts";
import { write } from "../write.ts";
import { syncClosingBalance } from "./closing-balance.ts";

/** Brings every account's closing-balance review item in step with the clock's today. Local. */
export const CLOSING_BALANCE_SYNC_JOB = defineJobKind({
  kind: "closing-balance-sync",
  schema: z.object({}).strict(),
  lane: "local",
  retry: { maxAttempts: 3, baseDelayMs: 60_000, maxDelayMs: 15 * 60_000 },
  externalEffects: false,
  needsPersonWhenDead: true,
  timeoutMs: 5 * 60_000,
});

export const CLOSING_BALANCE_SCHEDULE_NAME = "closing-balance-daily";

/** The sync's time of day, in the household time zone: just after midnight. */
export const CLOSING_BALANCE_TIME = { hour: 0, minute: 5 } as const;

/** The daily closing-balance sync at 00:05 in the household time zone. */
export function closingBalanceSchedule(timeZone: string): Schedule {
  return defineSchedule({
    name: CLOSING_BALANCE_SCHEDULE_NAME,
    kind: CLOSING_BALANCE_SYNC_JOB,
    payload: {},
    next: dailyAt(timeZone, CLOSING_BALANCE_TIME.hour, CLOSING_BALANCE_TIME.minute),
  });
}

/**
 * `accounts.syncClosingBalances`: runs `syncClosingBalance` for every account with a set
 * `closedOn`, in one write as `ctx`'s viewer (the job's system viewer, which sees every account).
 * Idempotent: it raises and resolves exactly as the write paths do, so a second run on the same
 * day changes and audits nothing. Returns how many accounts it looked at.
 */
export function syncClosingBalances(ctx: UseCaseContext): number {
  return write(ctx, (tx, audit) => {
    const closing = tx.accounts.list(ctx.viewer).filter((account) => account.closedOn !== null);
    for (const account of closing) syncClosingBalance(tx, audit, ctx, account.id);
    return closing.length;
  });
}
