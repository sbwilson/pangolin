import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { SplitRow, SplitSource } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import type { LedgerTransaction } from "./list-transactions.ts";
import "./needs-review.ts";
import {
  privateOwner,
  requireActivity,
  requireBeneficiary,
  requireCategory,
  requireTaxCategory,
} from "./split-targets.ts";
import {
  auditSnapshot,
  storedTransaction,
  tagsOf,
  toLedgerTransaction,
} from "./transaction-view.ts";

export const MAX_SPLITS = 50;

const splitInput = z
  .object({
    /** An existing split of this transaction (updated in place); omit to add a new one. */
    id: z.string().min(1).max(100).optional(),
    amountCents: z.int(),
    categoryId: z.string().min(1).max(100).nullable().optional(),
    activityId: z.string().min(1).max(100).nullable().optional(),
    beneficiary: z.string().min(1).max(100).optional(),
    taxCategoryId: z.string().min(1).max(100).nullable().optional(),
    deductibleBp: z.int().min(0).max(10_000).nullable().optional(),
    memo: z.string().trim().max(1000).nullable().optional(),
    propertyId: z.string().min(1).max(100).nullable().optional(),
  })
  .strict();

export const setSplitsInput = z
  .object({
    transactionId: z.string().min(1).max(100),
    splits: z.array(splitInput).min(1).max(MAX_SPLITS),
  })
  .strict();
export type SetSplitsInput = z.input<typeof setSplitsInput>;

/** A classified field's new value and source: `undefined` keeps, `null` clears, a value sets. */
function resolve<T>(
  existing: { value: T | null; source: SplitSource | null } | undefined,
  given: T | null | undefined,
): { value: T | null; source: SplitSource | null } {
  if (given === undefined) return existing ?? { value: null, source: null };
  if (existing === undefined) return { value: given, source: "user" };
  // An explicit null is a user clear even on an unset field, so a rule cannot refill it.
  if (given === existing.value && (given !== null || existing.source === "user")) return existing;
  return { value: given, source: "user" };
}

/**
 * `ledger.setSplits` (replace splits): makes `splits` the transaction's whole split list. The
 * amounts must sum exactly to the transaction amount (1 to 50 splits); otherwise nothing is
 * written and the `Validation` error carries `details: { remainingCents }`. A split with an `id`
 * of this transaction is updated in place and keeps its provenance and tags; one without is
 * minted; an existing split that is left out is deleted with its `split_tag` rows. On an
 * existing split an omitted field stays as it is and `null` clears it; on a new split an omitted
 * field is empty. A field the call changes is recorded as source `user` (this is the user's
 * edit; precedence cannot refuse it). A zero-amount split needs a zero-amount transaction. In a
 * private account every split's beneficiary is the owner (omitted means the owner; any other
 * is `Validation`); in a public account it is `shared` unless given. A missing, deleted or
 * other-scope category, activity or tax category, an unknown split ID and a partner-private
 * transaction are `NotFound`; an owner-scoped activity on a public account is `Conflict` (AD-18),
 * and a non-null `propertyId` is `Validation` (nothing is written). Audited as one `update` of `transaction` with its `accountId`,
 * before and after snapshots carrying the splits, their sources and tag IDs. Returns the
 * transaction as `getTransaction` does, whose `remainingCents` is 0.
 */
export function setSplits(ctx: UseCaseContext, input: SetSplitsInput): LedgerTransaction {
  const parsed = parseInput(setSplitsInput, input);
  return write(ctx, (tx, audit) => {
    const today = ctx.clock.today().toString();
    const before = tx.transactions.findVisible(ctx.viewer, parsed.transactionId, today);
    if (before === undefined) throw new AppError("NotFound", "Transaction not found");
    const remainingCents =
      before.amountCents - parsed.splits.reduce((sum, s) => sum + s.amountCents, 0);
    const fail = (message: string) => new AppError("Validation", message, { remainingCents });

    const existing = new Map(before.splits.map((s) => [s.id as string, s]));
    const seen = new Set<string>();
    for (const s of parsed.splits) {
      if (s.id === undefined) continue;
      if (!existing.has(s.id)) throw new AppError("NotFound", "Split not found");
      if (seen.has(s.id)) throw fail("A split appears twice");
      seen.add(s.id);
    }
    // Nothing exists to reference until the property epic (epic-loans-property) ships.
    if (parsed.splits.some((s) => s.propertyId !== undefined && s.propertyId !== null)) {
      throw new AppError("Validation", "A split cannot be linked to a property yet");
    }
    if (before.amountCents !== 0 && parsed.splits.some((s) => s.amountCents === 0)) {
      throw fail("A split cannot be zero unless the transaction is");
    }
    if (remainingCents !== 0) throw fail("Splits must add up to the transaction amount");

    const owner = privateOwner(tx, ctx.viewer, before.accountId);
    const at = formatInstant(ctx.clock.now());
    const next: SplitRow[] = parsed.splits.map((s) => {
      const old = s.id === undefined ? undefined : existing.get(s.id);
      // A target is checked only when its value changes, so a target deleted since does not
      // block an unrelated edit.
      if (s.categoryId && s.categoryId !== old?.categoryId) {
        requireCategory(tx, ctx.viewer, s.categoryId);
      }
      if (s.activityId && s.activityId !== old?.activityId) {
        requireActivity(tx, ctx.viewer, s.activityId, owner === null);
      }
      if (s.taxCategoryId && s.taxCategoryId !== old?.taxCategoryId) {
        requireTaxCategory(tx, ctx.viewer, s.taxCategoryId);
      }
      const pick = <V>(value: V | null | undefined, source: SplitSource | null | undefined) =>
        old === undefined ? undefined : { value: value as V | null, source: source ?? null };
      const category = resolve(
        pick(old?.categoryId, old?.categorySource),
        s.categoryId as SplitRow["categoryId"] | null | undefined,
      );
      const activity = resolve(
        pick(old?.activityId, old?.activitySource),
        s.activityId as SplitRow["activityId"] | null | undefined,
      );
      const taxCategory = resolve(
        pick(old?.taxCategoryId, old?.taxCategorySource),
        s.taxCategoryId as SplitRow["taxCategoryId"] | null | undefined,
      );
      const deductibleBp = resolve(
        pick(old?.deductibleBp, old?.deductibleBpSource),
        s.deductibleBp,
      );
      if (s.beneficiary !== undefined) {
        if (owner !== null && s.beneficiary !== owner) {
          throw fail("A private account's splits belong to its owner");
        }
        requireBeneficiary(tx, s.beneficiary, fail);
      }
      const beneficiary = resolve<string>(
        old === undefined ? undefined : { value: old.beneficiary, source: old.beneficiarySource },
        s.beneficiary ?? (old === undefined ? (owner ?? "shared") : undefined),
      );
      // A default the user did not type is not a user choice.
      if (old === undefined && s.beneficiary === undefined) beneficiary.source = null;
      const row: SplitRow = {
        id: old?.id ?? ctx.newId<"Split">(),
        transactionId: before.id,
        amountCents: s.amountCents,
        categoryId: category.value,
        activityId: activity.value,
        beneficiary: beneficiary.value ?? "shared",
        propertyId: s.propertyId === undefined ? (old?.propertyId ?? null) : s.propertyId,
        taxCategoryId: taxCategory.value,
        deductibleBp: deductibleBp.value,
        memo:
          s.memo === undefined
            ? (old?.memo ?? null)
            : s.memo === "" || s.memo === null
              ? null
              : s.memo,
        categorySource: category.source,
        activitySource: activity.source,
        taxCategorySource: taxCategory.source,
        beneficiarySource: beneficiary.source,
        deductibleBpSource: deductibleBp.source,
        createdAt: old?.createdAt ?? at,
        updatedAt: at,
      };
      if (old !== undefined && sameSplit(old, row)) return old;
      return row;
    });

    const unchanged =
      next.length === before.splits.length && next.every((row) => existing.get(row.id) === row);
    const tagsBefore = tagsOf(tx, ctx.viewer, before);
    if (unchanged) return toLedgerTransaction(ctx.viewer, before, tagsBefore);

    const stored = storedTransaction(tx, ctx.viewer, before.id);
    tx.transactions.replaceSplits(before.id, next);
    const after = tx.transactions.findVisible(ctx.viewer, before.id, today);
    if (after === undefined) throw new Error(`Transaction ${before.id} vanished during its update`);
    const tagsAfter = tagsOf(tx, ctx.viewer, after);
    audit({
      entity: "transaction",
      entityId: before.id,
      accountId: before.accountId,
      action: "update",
      before: auditSnapshot(stored, tagsBefore),
      after: auditSnapshot(storedTransaction(tx, ctx.viewer, before.id), tagsAfter),
    });
    return toLedgerTransaction(ctx.viewer, after, tagsAfter);
  });
}

/** Every column but `updatedAt` equal. */
function sameSplit(a: SplitRow, b: SplitRow): boolean {
  const { updatedAt: _a, ...left } = a;
  const { updatedAt: _b, ...right } = b;
  return JSON.stringify(left) === JSON.stringify(right);
}
