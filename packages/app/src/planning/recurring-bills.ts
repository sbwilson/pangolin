// Recurring bills detection, candidate generation, and queries (AD-3, AD-22, AD-25, CAP-5).
import { detectRecurringSeries, type RecurringOccurrence } from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import { formatInstant, parseDate } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type {
  PayAnchorRow,
  RecurringSeriesRow,
  VisibleTransaction,
} from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

export const detectRecurringBillCandidatesInput = z
  .object({
    accountId: z.string().optional(),
    toleranceBp: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

export type DetectRecurringBillCandidatesInput = z.input<typeof detectRecurringBillCandidatesInput>;

export const listRecurringSeriesInput = z
  .object({
    accountId: z.string().optional(),
    status: z.enum(["candidate", "confirmed", "rejected"]).optional(),
  })
  .strict();

export type ListRecurringSeriesInput = z.input<typeof listRecurringSeriesInput>;

export const confirmRecurringSeriesInput = z
  .object({
    id: z.string(),
  })
  .strict();

export type ConfirmRecurringSeriesInput = z.input<typeof confirmRecurringSeriesInput>;

export const rejectRecurringSeriesInput = z
  .object({
    id: z.string(),
  })
  .strict();

export type RejectRecurringSeriesInput = z.input<typeof rejectRecurringSeriesInput>;

export const createRecurringSeriesInput = z
  .object({
    accountId: z.string().min(1),
    payeeId: z.string().min(1),
    direction: z.enum(["bill", "income"]).default("bill"),
    cadence: z.enum(["weekly", "fortnightly", "monthly", "quarterly", "annual"]),
    expectedCents: z.number().int().positive(),
    toleranceBp: z.number().int().min(0).max(10000).default(1500),
    nextDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  })
  .strict();

export type CreateRecurringSeriesInput = z.input<typeof createRecurringSeriesInput>;

export const deleteRecurringSeriesInput = z
  .object({
    id: z.string(),
  })
  .strict();

export type DeleteRecurringSeriesInput = z.input<typeof deleteRecurringSeriesInput>;

/**
 * Checks whether an incoming transaction is a salary deposit per AD-25:
 * 1. Positive amount (`amountCents > 0`).
 * 2. Matches a pay anchor for that account:
 *    - Matching expected net pay within ±10% tolerance, OR
 *    - Description or payee raw text matching salary/payroll/wages keywords.
 */
export function isSalaryTransaction(
  txn: VisibleTransaction,
  anchors: readonly PayAnchorRow[],
): boolean {
  if (txn.amountCents <= 0) return false;

  // Check against anchors for this account
  const matchingAnchors = anchors.filter((a) => a.accountId === txn.accountId);

  for (const anchor of matchingAnchors) {
    if (anchor.expectedNetCents !== null && anchor.expectedNetCents > 0) {
      const diff = Math.abs(txn.amountCents - anchor.expectedNetCents);
      const tolerance = Math.round(anchor.expectedNetCents * 0.1);
      if (diff <= tolerance) {
        return true;
      }
    }
  }

  // Check salary keywords in description or payee
  const desc = (txn.descriptionRaw ?? "").toLowerCase();
  const payee = (txn.payeeName ?? "").toLowerCase();
  const isPayKeyword =
    /\b(salary|payroll|wages)\b/i.test(desc) ||
    /\b(salary|payroll|wages)\b/i.test(payee) ||
    /\bdirect credit.*pay\b/i.test(desc) ||
    /\bpay\s*(salary|period|run)\b/i.test(desc);

  if (isPayKeyword) {
    return true;
  }

  return false;
}

/**
 * Scans transaction history across visible accounts, groups transactions by (account_id, payee_id),
 * excludes salary deposits and internal transfers, runs pure domain recurring detection,
 * and inserts newly detected candidates into `recurring_series`.
 */
export function detectRecurringBillCandidates(
  ctx: UseCaseContext,
  input?: DetectRecurringBillCandidatesInput,
): readonly RecurringSeriesRow[] {
  const parsed = parseInput(detectRecurringBillCandidatesInput, input ?? {});

  const today = ctx.clock.today().toString();

  // Read transactions, visible pay anchors, and existing recurring series
  const { txns, anchors, existingSeries } = ctx.uow.read((repos) => {
    const txns = repos.transactions.listVisible(ctx.viewer, today);
    const anchors = repos.payAnchors.listVisible(ctx.viewer);
    const existingSeries = repos.recurringSeries.listVisible(ctx.viewer, {
      ...(parsed.accountId ? { accountId: parsed.accountId as Id<"Account"> } : {}),
    });
    return { txns, anchors, existingSeries };
  });

  // Filter transactions
  // 1. Account filter if requested
  // 2. Must have a valid payeeId
  // 3. Exclude internal transfers (`transferGroupId !== null`)
  // 4. Exclude salary deposits (AD-25)
  // 5. Must be an expense/bill (`amountCents < 0`) for bill candidates
  const eligibleTxns = txns.filter((t) => {
    if (parsed.accountId && t.accountId !== parsed.accountId) return false;
    if (!t.payeeId) return false;
    if (t.transferGroupId !== null) return false;
    if (isSalaryTransaction(t, anchors)) return false;
    // We detect recurring bills (direction = 'bill') where amount is negative
    if (t.amountCents >= 0) return false;
    return true;
  });

  // Group by (accountId, payeeId)
  const groups = new Map<
    string,
    { accountId: Id<"Account">; payeeId: Id<"Payee">; txns: VisibleTransaction[] }
  >();
  for (const t of eligibleTxns) {
    const key = `${t.accountId}:${t.payeeId}`;
    let grp = groups.get(key);
    if (!grp) {
      grp = {
        accountId: t.accountId as Id<"Account">,
        payeeId: t.payeeId as Id<"Payee">,
        txns: [],
      };
      groups.set(key, grp);
    }
    grp.txns.push(t);
  }

  // For each group, run pure detection if not already existing
  const candidatesToCreate: Array<{
    accountId: Id<"Account">;
    payeeId: Id<"Payee">;
    cadence: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual";
    expectedCents: number;
    toleranceBp: number;
    nextDueOn: string;
  }> = [];

  for (const group of groups.values()) {
    // Check if a series already exists for this (accountId, payeeId)
    const exists = existingSeries.some(
      (s) => s.accountId === group.accountId && s.payeeId === group.payeeId,
    );
    if (exists) {
      continue;
    }

    const occurrences: RecurringOccurrence[] = group.txns.map((t) => ({
      postedOn: parseDate(t.postedOn),
      amountCents: t.amountCents,
    }));

    const detected = detectRecurringSeries(occurrences, {
      ...(parsed.toleranceBp !== undefined ? { toleranceBp: parsed.toleranceBp } : {}),
    });

    if (detected) {
      candidatesToCreate.push({
        accountId: group.accountId,
        payeeId: group.payeeId,
        cadence: detected.cadence,
        expectedCents: detected.expectedCents,
        toleranceBp: detected.toleranceBp,
        nextDueOn: detected.nextDueOn.toString(),
      });
    }
  }

  if (candidatesToCreate.length === 0) {
    return [];
  }

  return write(ctx, (tx, audit) => {
    const createdList: RecurringSeriesRow[] = [];
    const now = formatInstant(ctx.clock.now());

    for (const c of candidatesToCreate) {
      const id = ctx.newId<"RecurringSeries">();
      const row: RecurringSeriesRow = {
        id,
        accountId: c.accountId,
        payeeId: c.payeeId,
        direction: "bill",
        cadence: c.cadence,
        expectedCents: c.expectedCents,
        toleranceBp: c.toleranceBp,
        nextDueOn: c.nextDueOn,
        status: "candidate",
        createdAt: now,
        updatedAt: now,
      };

      tx.recurringSeries.insert(row);
      audit({
        entity: "recurring_series",
        entityId: row.id,
        accountId: row.accountId,
        action: "create",
        before: null,
        after: row,
      });
      createdList.push(row);
    }

    return createdList;
  });
}

/**
 * Lists recurring series visible to the current viewer.
 */
export function listRecurringSeries(
  ctx: UseCaseContext,
  input?: ListRecurringSeriesInput,
): readonly RecurringSeriesRow[] {
  const parsed = parseInput(listRecurringSeriesInput, input ?? {});
  return ctx.uow.read((repos) =>
    repos.recurringSeries.listVisible(ctx.viewer, {
      ...(parsed.accountId ? { accountId: parsed.accountId as Id<"Account"> } : {}),
      ...(parsed.status ? { status: parsed.status } : {}),
    }),
  );
}

/**
 * Lists candidate recurring series for the viewer.
 */
export function listCandidateSeries(
  ctx: UseCaseContext,
  input?: { readonly accountId?: string },
): readonly RecurringSeriesRow[] {
  return listRecurringSeries(ctx, {
    accountId: input?.accountId,
    status: "candidate",
  });
}

/**
 * Confirms a recurring series candidate with one click (CAP-5).
 */
export function confirmRecurringSeries(
  ctx: UseCaseContext,
  input: ConfirmRecurringSeriesInput,
): RecurringSeriesRow {
  const parsed = parseInput(confirmRecurringSeriesInput, input);
  const id = parsed.id as Id<"RecurringSeries">;

  return write(ctx, (tx, audit) => {
    const existing = tx.recurringSeries.findById(ctx.viewer, id);
    if (!existing) {
      throw new AppError("NotFound", "Recurring series not found");
    }

    const now = formatInstant(ctx.clock.now());
    const updated: RecurringSeriesRow = {
      ...existing,
      status: "confirmed",
      updatedAt: now,
    };

    tx.recurringSeries.update(updated);
    audit({
      entity: "recurring_series",
      entityId: updated.id,
      accountId: updated.accountId,
      action: "update",
      before: existing,
      after: updated,
    });

    return updated;
  });
}

/**
 * Rejects a recurring series candidate.
 */
export function rejectRecurringSeries(
  ctx: UseCaseContext,
  input: RejectRecurringSeriesInput,
): RecurringSeriesRow {
  const parsed = parseInput(rejectRecurringSeriesInput, input);
  const id = parsed.id as Id<"RecurringSeries">;

  return write(ctx, (tx, audit) => {
    const existing = tx.recurringSeries.findById(ctx.viewer, id);
    if (!existing) {
      throw new AppError("NotFound", "Recurring series not found");
    }

    const now = formatInstant(ctx.clock.now());
    const updated: RecurringSeriesRow = {
      ...existing,
      status: "rejected",
      updatedAt: now,
    };

    tx.recurringSeries.update(updated);
    audit({
      entity: "recurring_series",
      entityId: updated.id,
      accountId: updated.accountId,
      action: "update",
      before: existing,
      after: updated,
    });

    return updated;
  });
}

/**
 * Creates a recurring series manually (AD-1, AD-3, AD-25).
 * Defaults status to 'confirmed'.
 */
export function createRecurringSeries(
  ctx: UseCaseContext,
  input: CreateRecurringSeriesInput,
): RecurringSeriesRow {
  const parsed = parseInput(createRecurringSeriesInput, input);

  return write(ctx, (tx, audit) => {
    // Verify account is visible to viewer
    const account = tx.accounts.findVisible(ctx.viewer, parsed.accountId as Id<"Account">);
    if (!account) {
      throw new AppError("NotFound", "Account not found");
    }

    // Verify payee is visible to viewer
    const payee = tx.payees.find(ctx.viewer, parsed.payeeId as Id<"Payee">);
    if (!payee) {
      throw new AppError("NotFound", "Payee not found");
    }

    const id = ctx.newId<"RecurringSeries">();
    const now = formatInstant(ctx.clock.now());

    const row: RecurringSeriesRow = {
      id,
      accountId: parsed.accountId as Id<"Account">,
      payeeId: parsed.payeeId as Id<"Payee">,
      direction: parsed.direction,
      cadence: parsed.cadence,
      expectedCents: parsed.expectedCents,
      toleranceBp: parsed.toleranceBp,
      nextDueOn: parsed.nextDueOn,
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
    };

    tx.recurringSeries.insert(row);
    audit({
      entity: "recurring_series",
      entityId: row.id,
      accountId: row.accountId,
      action: "create",
      before: null,
      after: row,
    });

    return row;
  });
}

/**
 * Deletes a recurring series (AD-1, AD-3).
 */
export function deleteRecurringSeries(
  ctx: UseCaseContext,
  input: DeleteRecurringSeriesInput,
): boolean {
  const parsed = parseInput(deleteRecurringSeriesInput, input);
  const id = parsed.id as Id<"RecurringSeries">;

  return write(ctx, (tx, audit) => {
    const existing = tx.recurringSeries.findById(ctx.viewer, id);
    if (!existing) {
      throw new AppError("NotFound", "Recurring series not found");
    }

    tx.recurringSeries.delete(id);
    audit({
      entity: "recurring_series",
      entityId: existing.id,
      accountId: existing.accountId,
      action: "delete",
      before: existing,
      after: null,
    });

    return true;
  });
}
