import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import {
  SPLIT_SOURCES,
  type SplitRow,
  type SplitSource,
  type TxRepos,
} from "../ports/unit-of-work.ts";
import { type Audit, write } from "../write.ts";
import type { LedgerTransaction } from "./list-transactions.ts";
import "./needs-review.ts";
import { mayOverwrite } from "./provenance.ts";
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

/** The classified fields of a split that carry provenance. `payee_id` lives on the transaction. */
export const SPLIT_FIELDS = [
  "category",
  "activity",
  "tax_category",
  "beneficiary",
  "deductible_bp",
] as const;
export type SplitField = (typeof SPLIT_FIELDS)[number];

export const setSplitFieldInput = z
  .object({
    transactionId: z.string().min(1).max(100),
    splitId: z.string().min(1).max(100),
    field: z.enum(SPLIT_FIELDS),
    /** An ID (category, activity, tax category), `shared` or a person ID (beneficiary), basis points, or null to clear. */
    value: z.union([z.string().min(1).max(100), z.int(), z.null()]),
    /** Internal callers only; HTTP always passes `user`. */
    source: z.enum(SPLIT_SOURCES).default("user"),
  })
  .strict();
export type SetSplitFieldInput = z.input<typeof setSplitFieldInput>;

export interface SetSplitFieldResult {
  /** False when a higher-ranked source already holds the field: nothing was written. */
  readonly applied: boolean;
  /** True when a column (value or source) changed and the write was audited. */
  readonly changed: boolean;
  readonly reason?: string;
  readonly transaction: LedgerTransaction;
}

/** What a listener hears after a classified field is written. */
export interface SplitFieldWrite {
  readonly transactionId: string;
  readonly splitId: string;
  readonly field: SplitField;
  readonly value: string | number | null;
  readonly source: SplitSource;
}
export type SplitFieldListener = (tx: TxRepos, audit: Audit, event: SplitFieldWrite) => void;

const listeners: SplitFieldListener[] = [];

/**
 * The hook for closing open suggestions (AD-10) once `classify` has them: a listener runs inside
 * the write (so a throw rolls it back), after every changed field write. Returns an
 * unregister function. There are none yet.
 */
export function registerSplitFieldListener(listener: SplitFieldListener): () => void {
  listeners.push(listener);
  return () => {
    const at = listeners.indexOf(listener);
    if (at >= 0) listeners.splice(at, 1);
  };
}

type Column = {
  readonly value: keyof SplitRow;
  readonly source: keyof SplitRow;
};
const COLUMNS: Readonly<Record<SplitField, Column>> = {
  category: { value: "categoryId", source: "categorySource" },
  activity: { value: "activityId", source: "activitySource" },
  tax_category: { value: "taxCategoryId", source: "taxCategorySource" },
  beneficiary: { value: "beneficiary", source: "beneficiarySource" },
  deductible_bp: { value: "deductibleBp", source: "deductibleBpSource" },
};

/**
 * `ledger.setSplitField`: sets one classified field of a split with its source (AD-10). A write
 * succeeds when the source ranks at least as high as the one recorded (user > rule > payee >
 * activity > llm; an unset field takes any); a lower-ranked source writing over a higher one
 * changes nothing and returns `{ applied: false, reason }`. `source: user` with `value: null`
 * clears the field and records `user`, so rules do not refill it; only a user may clear, and a
 * beneficiary cannot be cleared. A write that changes only the source (an upgrade) is a change
 * and is audited; one that changes nothing is not. A missing, deleted or other-scope category,
 * activity or tax category is `NotFound`, and an owner-scoped activity on a public account is
 * `Conflict` (AD-18); a beneficiary is `shared` or a person, and in a
 * private account only its owner (`Validation`). Audited as one `update` of `transaction` with
 * its `accountId`, before and after carrying the splits, their sources and tag IDs.
 */
export function setSplitField(ctx: UseCaseContext, input: SetSplitFieldInput): SetSplitFieldResult {
  const parsed = parseInput(setSplitFieldInput, input);
  return write(ctx, (tx, audit) => {
    const today = ctx.clock.today().toString();
    const before = tx.transactions.findVisible(ctx.viewer, parsed.transactionId, today);
    if (before === undefined) throw new AppError("NotFound", "Transaction not found");
    const old = before.splits.find((s) => s.id === parsed.splitId);
    if (old === undefined) throw new AppError("NotFound", "Split not found");
    const { field, source, value } = parsed;
    const fail = (message: string) => new AppError("Validation", message);

    if (value === null) {
      if (source !== "user") throw fail("Only a user can clear a field");
      if (field === "beneficiary") throw fail("A beneficiary cannot be cleared");
    } else if (field === "deductible_bp") {
      if (typeof value !== "number" || value < 0 || value > 10_000) {
        throw fail("Deductible share is 0 to 10000 basis points");
      }
    } else if (typeof value !== "string") {
      throw fail("Expected an ID");
    } else if (field === "category") requireCategory(tx, ctx.viewer, value);
    else if (field === "activity") {
      const isPublic = privateOwner(tx, ctx.viewer, before.accountId) === null;
      requireActivity(tx, ctx.viewer, value, isPublic);
    } else if (field === "tax_category") requireTaxCategory(tx, ctx.viewer, value);
    else {
      const owner = privateOwner(tx, ctx.viewer, before.accountId);
      if (owner !== null && value !== owner) {
        throw fail("A private account's splits belong to its owner");
      }
      requireBeneficiary(tx, value, fail);
    }

    const column = COLUMNS[field];
    const tagsBefore = tagsOf(tx, ctx.viewer, before);
    const current = old[column.source] as SplitSource | null;
    if (!mayOverwrite(current, source)) {
      return {
        applied: false,
        changed: false,
        reason: `The ${field.replace("_", " ")} was set by a higher-ranked source (${current})`,
        transaction: toLedgerTransaction(ctx.viewer, before, tagsBefore),
      };
    }
    if (old[column.value] === value && current === source) {
      return {
        applied: true,
        changed: false,
        transaction: toLedgerTransaction(ctx.viewer, before, tagsBefore),
      };
    }
    const row = {
      ...old,
      [column.value]: value,
      [column.source]: source,
      updatedAt: formatInstant(ctx.clock.now()),
    } as SplitRow;
    const stored = storedTransaction(tx, ctx.viewer, before.id);
    if (!tx.transactions.updateSplit(row)) {
      throw new Error(`Split ${old.id} vanished during its update`);
    }
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
    for (const listener of listeners) {
      listener(tx, audit, { transactionId: before.id, splitId: old.id, field, value, source });
    }
    return {
      applied: true,
      changed: true,
      transaction: toLedgerTransaction(ctx.viewer, after, tagsAfter),
    };
  });
}
