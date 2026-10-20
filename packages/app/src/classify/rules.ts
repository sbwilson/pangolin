import type { RuleActions, RuleConditions } from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import { privateOwner } from "../ledger/split-targets.ts";
import { RULE_ORIGINS, type RuleRow, type TxRepos } from "../ports/unit-of-work.ts";
import { defineReviewKind, resolveReviewItem } from "../system/review-items.ts";
import { write } from "../write.ts";
import { auditScope, nameInput, originInput, scopeFor } from "./scope.ts";

/** An unclassified transaction split needing review. Account scope; entity `transaction:<id>`. */
export const CLASSIFY_UNCLASSIFIED_REVIEW = defineReviewKind({
  kind: "classify.unclassified",
  module: "classify",
  scope: "account",
});

/** A rule offered to the user after categorising a split. Account scope; entity `transaction:<id>`. */
export const CLASSIFY_RULE_OFFER_REVIEW = defineReviewKind({
  kind: "classify.rule_offer",
  module: "classify",
  scope: "account",
});

export const ruleConditionsSchema = z
  .object({
    descriptionPattern: z.string().optional(),
    descriptionMatchKind: z.enum(["exact", "contains", "prefix", "regex"]).optional(),
    payeeId: idInput.optional(),
    accountId: idInput.optional(),
    minAmountCents: z.int().min(0).optional(),
    maxAmountCents: z.int().min(0).optional(),
    direction: z.enum(["inflow", "outflow"]).optional(),
  })
  .strict()
  .refine(
    (c) => {
      if (c.descriptionMatchKind === "regex" && c.descriptionPattern !== undefined) {
        try {
          new RegExp(c.descriptionPattern);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: "Invalid regular expression",
      path: ["descriptionPattern"],
    },
  )
  .refine(
    (c) => {
      if (c.minAmountCents !== undefined && c.maxAmountCents !== undefined) {
        return c.minAmountCents <= c.maxAmountCents;
      }
      return true;
    },
    {
      message: "minAmountCents must be less than or equal to maxAmountCents",
      path: ["maxAmountCents"],
    },
  );

export const ruleActionsSchema = z
  .object({
    categoryId: idInput.optional(),
  })
  .strict()
  .refine((a) => a.categoryId !== undefined, {
    message: "At least one action is required",
    path: ["categoryId"],
  });

function requireRuleNameFree(
  tx: TxRepos,
  ctx: UseCaseContext,
  scopePersonId: string | null,
  name: string,
  selfId?: string,
): void {
  if (
    tx.rules
      .list(ctx.viewer)
      .some((r) => r.id !== selfId && r.scopePersonId === scopePersonId && r.name === name)
  ) {
    throw new AppError("Conflict", "A rule with this name already exists");
  }
}

function requireCategory(tx: TxRepos, ctx: UseCaseContext, id: string | undefined): void {
  if (id !== undefined && tx.categories.find(ctx.viewer, id) === undefined) {
    throw new AppError("Validation", "Unknown category");
  }
}

export const createRuleInput = z
  .object({
    name: nameInput,
    priority: z.int().min(1).default(100),
    conditions: ruleConditionsSchema,
    actions: ruleActionsSchema,
    origin: z.enum(RULE_ORIGINS).default("user"),
    originAccountId: originInput,
  })
  .strict();
export type CreateRuleInput = z.input<typeof createRuleInput>;

/** `classify.createRule`: scope comes from origin account (AD-18). Evaluated in ascending priority order. */
export function createRule(ctx: UseCaseContext, input: CreateRuleInput): RuleRow {
  const parsed = parseInput(createRuleInput, input);
  return write(ctx, (tx, audit) => {
    const scope = scopeFor(tx, ctx.viewer, parsed.originAccountId);
    requireCategory(tx, ctx, parsed.actions.categoryId);
    requireRuleNameFree(tx, ctx, scope.scopePersonId, parsed.name);
    const at = formatInstant(ctx.clock.now());
    const row: RuleRow = {
      id: ctx.newId<"Rule">(),
      name: parsed.name,
      priority: parsed.priority,
      conditions: JSON.stringify(parsed.conditions),
      actions: JSON.stringify(parsed.actions),
      origin: parsed.origin,
      scopePersonId: scope.scopePersonId,
      createdAt: at,
      updatedAt: at,
    };
    tx.rules.insert(row, scope.origin);
    audit({
      entity: "rule",
      entityId: row.id,
      action: "create",
      before: null,
      after: row,
      ...auditScope(scope.scopePersonId, scope.origin),
    });
    return row;
  });
}

export const updateRuleInput = z
  .object({
    id: idInput,
    name: nameInput.optional(),
    priority: z.int().min(1).optional(),
    conditions: ruleConditionsSchema.optional(),
    actions: ruleActionsSchema.optional(),
  })
  .strict();
export type UpdateRuleInput = z.input<typeof updateRuleInput>;

/** `classify.updateRule`: another person's scoped rule is `NotFound`. Scope never changes. */
export function updateRule(ctx: UseCaseContext, input: UpdateRuleInput): RuleRow {
  const parsed = parseInput(updateRuleInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.rules.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Rule not found");
    const origin = tx.rules.originOf(ctx.viewer, before.id) ?? null;
    const name = parsed.name ?? before.name;
    const priority = parsed.priority ?? before.priority;
    const conditions =
      parsed.conditions !== undefined ? JSON.stringify(parsed.conditions) : before.conditions;
    const actions = parsed.actions !== undefined ? JSON.stringify(parsed.actions) : before.actions;

    if (parsed.actions?.categoryId) {
      requireCategory(tx, ctx, parsed.actions.categoryId);
    }
    requireRuleNameFree(tx, ctx, before.scopePersonId, name, before.id);

    const after: RuleRow = {
      ...before,
      id: before.id as Id<"Rule">,
      name,
      priority,
      conditions,
      actions,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    if (!tx.rules.update(ctx.viewer, after)) throw new AppError("NotFound", "Rule not found");
    audit({
      entity: "rule",
      entityId: before.id,
      action: "update",
      before,
      after,
      ...auditScope(before.scopePersonId, origin),
    });
    return after;
  });
}

export const deleteRuleInput = z.object({ id: idInput }).strict();
export type DeleteRuleInput = z.input<typeof deleteRuleInput>;

/** `classify.deleteRule`: soft-deletes; another person's scoped rule is `NotFound`. */
export function deleteRule(ctx: UseCaseContext, input: DeleteRuleInput): void {
  const parsed = parseInput(deleteRuleInput, input);
  write(ctx, (tx, audit) => {
    const before = tx.rules.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Rule not found");
    const origin = tx.rules.originOf(ctx.viewer, before.id) ?? null;
    const at = formatInstant(ctx.clock.now());
    if (!tx.rules.softDelete(ctx.viewer, before.id, at)) {
      throw new AppError("NotFound", "Rule not found");
    }
    audit({
      entity: "rule",
      entityId: before.id,
      action: "delete",
      before,
      after: null,
      ...auditScope(before.scopePersonId, origin),
    });
  });
}

export const listRulesInput = z.object({}).strict();
export type ListRulesInput = z.input<typeof listRulesInput>;

/** `classify.listRules`: shared rules and the viewer's own, ordered by priority ascending. */
export function listRules(ctx: UseCaseContext, input: ListRulesInput = {}): RuleRow[] {
  parseInput(listRulesInput, input);
  return ctx.uow.read((repos) => repos.rules.list(ctx.viewer));
}

export const getRuleInput = z.object({ id: idInput }).strict();
export type GetRuleInput = z.input<typeof getRuleInput>;

/** `classify.getRule`: another person's scoped rule is `NotFound`. */
export function getRule(ctx: UseCaseContext, input: GetRuleInput): RuleRow {
  const parsed = parseInput(getRuleInput, input);
  return ctx.uow.read((repos) => {
    const row = repos.rules.find(ctx.viewer, parsed.id);
    if (row === undefined) throw new AppError("NotFound", "Rule not found");
    return row;
  });
}

export interface RuleCorrectionProposal {
  readonly name: string;
  readonly priority: number;
  readonly conditions: RuleConditions;
  readonly actions: RuleActions;
}

/**
 * Generates a rule candidate proposal from a user-categorised transaction split.
 */
export function generateRuleFromCorrection(
  transaction: {
    readonly payeeId: string | null;
    readonly descriptionRaw?: string | null;
    readonly amountCents: number;
  },
  split: { readonly categoryId: string | null },
  payeeName?: string | null,
): RuleCorrectionProposal {
  let name: string;
  let conditions: RuleConditions;

  const rawTrimmed = (transaction.descriptionRaw ?? "").trim().slice(0, 100);
  const fallbackName = rawTrimmed.length > 0 ? rawTrimmed : "Rule";

  if (transaction.payeeId !== null) {
    name = (payeeName ?? "").trim().slice(0, 100) || fallbackName;
    conditions = { payeeId: transaction.payeeId };
  } else {
    name = fallbackName;
    conditions = {
      descriptionPattern: (transaction.descriptionRaw ?? "").trim(),
      descriptionMatchKind: "contains",
    };
  }

  return {
    name,
    priority: 100,
    conditions,
    actions: split.categoryId ? { categoryId: split.categoryId } : {},
  };
}

export const acceptRuleOfferInput = z
  .object({
    transactionId: idInput,
    name: nameInput.optional(),
    priority: z.int().min(1).default(100),
    conditions: ruleConditionsSchema.optional(),
    actions: ruleActionsSchema.optional(),
  })
  .strict();
export type AcceptRuleOfferInput = z.input<typeof acceptRuleOfferInput>;

/**
 * Accepts a rule offer for a transaction: creates a new rule with origin `correction`
 * and resolves the `classify.rule_offer` review item.
 */
export function acceptRuleOffer(ctx: UseCaseContext, input: AcceptRuleOfferInput): RuleRow {
  const parsed = parseInput(acceptRuleOfferInput, input);
  return write(ctx, (tx, audit) => {
    const today = ctx.clock.today().toString();
    const txn = tx.transactions.findVisible(ctx.viewer, parsed.transactionId, today);
    if (txn === undefined) throw new AppError("NotFound", "Transaction not found");
    const split = txn.splits.find((s) => s.categoryId !== null) ?? txn.splits[0];
    if (split === undefined) throw new AppError("NotFound", "Split not found");

    const payee = txn.payeeId ? tx.payees.find(ctx.viewer, txn.payeeId) : undefined;
    const proposal = generateRuleFromCorrection(txn, split, payee?.name);

    const fallbackName = (txn.descriptionRaw ?? "").trim().slice(0, 100) || "Rule";
    const proposalName = (proposal.name ?? "").trim().slice(0, 100) || fallbackName;
    const name = parsed.name ?? proposalName;
    const priority = parsed.priority ?? proposal.priority;
    const conditions = parsed.conditions ?? proposal.conditions;
    const actions = parsed.actions ?? proposal.actions;

    requireCategory(tx, ctx, actions.categoryId);

    // Determine scope from the transaction's account (AD-18)
    const owner = privateOwner(tx, ctx.viewer, txn.accountId);
    const scopePersonId = owner as Id<"Person"> | null;
    const originAccountId = owner !== null ? (txn.accountId as Id<"Account">) : null;

    requireRuleNameFree(tx, ctx, scopePersonId, name);

    const at = formatInstant(ctx.clock.now());
    const ruleRow: RuleRow = {
      id: ctx.newId<"Rule">(),
      name,
      priority,
      conditions: JSON.stringify(conditions),
      actions: JSON.stringify(actions),
      origin: "correction",
      scopePersonId,
      createdAt: at,
      updatedAt: at,
    };
    tx.rules.insert(ruleRow, originAccountId);
    audit({
      entity: "rule",
      entityId: ruleRow.id,
      action: "create",
      before: null,
      after: ruleRow,
      ...auditScope(scopePersonId, originAccountId),
    });

    // Resolve the rule_offer review item
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: `classify.rule_offer:${txn.id}`,
      resolution: "accepted",
    });

    return ruleRow;
  });
}

export const dismissRuleOfferInput = z.object({ transactionId: idInput }).strict();
export type DismissRuleOfferInput = z.input<typeof dismissRuleOfferInput>;

/**
 * Dismisses a rule offer for a transaction by resolving its `classify.rule_offer` review item.
 */
export function dismissRuleOffer(ctx: UseCaseContext, input: DismissRuleOfferInput): void {
  const parsed = parseInput(dismissRuleOfferInput, input);
  write(ctx, (tx, audit) => {
    const today = ctx.clock.today().toString();
    const txn = tx.transactions.findVisible(ctx.viewer, parsed.transactionId, today);
    if (txn === undefined) throw new AppError("NotFound", "Transaction not found");

    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: `classify.rule_offer:${parsed.transactionId}`,
      resolution: "dismissed",
    });
  });
}
