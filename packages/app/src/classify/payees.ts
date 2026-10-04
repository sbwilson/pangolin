import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { idInput } from "../accounts/inputs.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import {
  ALIAS_MATCH_KINDS,
  type AliasMatchKind,
  type PayeeAliasRow,
  type PayeeRow,
  type TxRepos,
} from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { auditScope, nameInput, originInput, scopeFor } from "./scope.ts";

const websiteInput = z
  .url({ protocol: /^https?$/, message: "Expected an http or https address" })
  .max(500);

export const MAX_ALIAS_PATTERN_LENGTH = 200;

const patternInput = z
  .string()
  .min(1, { message: "Enter a pattern" })
  .max(MAX_ALIAS_PATTERN_LENGTH, { message: "The pattern is too long" })
  .refine((value) => value.trim() !== "", { message: "Enter a pattern" });

// ---------------------------------------------------------------------------------- payees

function requirePayeeNameFree(
  tx: TxRepos,
  ctx: UseCaseContext,
  scopePersonId: string | null,
  name: string,
  selfId?: string,
): void {
  if (
    tx.payees
      .list(ctx.viewer)
      .some((p) => p.id !== selfId && p.scopePersonId === scopePersonId && p.name === name)
  ) {
    throw new AppError("Conflict", "A payee with this name already exists");
  }
}

function requireCategory(tx: TxRepos, ctx: UseCaseContext, id: string | null): void {
  if (id !== null && tx.categories.find(ctx.viewer, id) === undefined) {
    throw new AppError("Validation", "Unknown category");
  }
}

export const createPayeeInput = z
  .object({
    name: nameInput,
    websiteUrl: websiteInput.nullish(),
    defaultCategoryId: idInput.nullish(),
    originAccountId: originInput,
  })
  .strict();
export type CreatePayeeInput = z.input<typeof createPayeeInput>;

/** `classify.createPayee`: scope comes from the origin account (AD-18), never from the client. */
export function createPayee(ctx: UseCaseContext, input: CreatePayeeInput): PayeeRow {
  const parsed = parseInput(createPayeeInput, input);
  return write(ctx, (tx, audit) => {
    const scope = scopeFor(tx, ctx.viewer, parsed.originAccountId);
    const defaultCategoryId = (parsed.defaultCategoryId ?? null) as Id<"Category"> | null;
    requireCategory(tx, ctx, defaultCategoryId);
    requirePayeeNameFree(tx, ctx, scope.scopePersonId, parsed.name);
    const at = formatInstant(ctx.clock.now());
    const row: PayeeRow = {
      id: ctx.newId<"Payee">(),
      name: parsed.name,
      websiteUrl: parsed.websiteUrl ?? null,
      logoAttachmentId: null,
      defaultCategoryId,
      scopePersonId: scope.scopePersonId,
      createdAt: at,
      updatedAt: at,
    };
    tx.payees.insert(row, scope.origin);
    audit({
      entity: "payee",
      entityId: row.id,
      action: "create",
      before: null,
      after: row,
      ...auditScope(scope.scopePersonId, scope.origin),
    });
    return row;
  });
}

export const updatePayeeInput = z
  .object({
    id: idInput,
    name: nameInput.optional(),
    /** Null clears the address or the default category. */
    websiteUrl: websiteInput.nullish(),
    defaultCategoryId: idInput.nullish(),
  })
  .strict();
export type UpdatePayeeInput = z.input<typeof updatePayeeInput>;

/** `classify.updatePayee`: another person's scoped payee is `NotFound`. Scope never changes. */
export function updatePayee(ctx: UseCaseContext, input: UpdatePayeeInput): PayeeRow {
  const parsed = parseInput(updatePayeeInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.payees.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Payee not found");
    const origin = tx.payees.originOf(ctx.viewer, before.id) ?? null;
    const name = parsed.name ?? before.name;
    const defaultCategoryId =
      parsed.defaultCategoryId === undefined
        ? before.defaultCategoryId
        : (parsed.defaultCategoryId as Id<"Category"> | null);
    if (defaultCategoryId !== before.defaultCategoryId) requireCategory(tx, ctx, defaultCategoryId);
    requirePayeeNameFree(tx, ctx, before.scopePersonId, name, before.id);
    const after: PayeeRow = {
      ...before,
      id: before.id as Id<"Payee">,
      name,
      websiteUrl: parsed.websiteUrl === undefined ? before.websiteUrl : parsed.websiteUrl,
      defaultCategoryId,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    if (!tx.payees.update(ctx.viewer, after)) throw new AppError("NotFound", "Payee not found");
    audit({
      entity: "payee",
      entityId: before.id,
      action: "update",
      before,
      after,
      ...auditScope(before.scopePersonId, origin),
    });
    return after;
  });
}

export const deletePayeeInput = z.object({ id: idInput }).strict();

/**
 * `classify.deletePayee`: soft-deletes the payee and its aliases. A payee that any transaction
 * references is refused with `Conflict`. Another person's scoped payee is `NotFound`.
 */
export function deletePayee(ctx: UseCaseContext, input: z.input<typeof deletePayeeInput>): void {
  const parsed = parseInput(deletePayeeInput, input);
  write(ctx, (tx, audit) => {
    const before = tx.payees.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Payee not found");
    const origin = tx.payees.originOf(ctx.viewer, before.id) ?? null;
    const at = formatInstant(ctx.clock.now());
    for (const { before: alias, originAccountId } of tx.payeeAliases.softDeleteForPayee(
      before.id,
      at,
    )) {
      audit({
        entity: "payee_alias",
        entityId: alias.id,
        action: "delete",
        before: alias,
        after: null,
        ...auditScope(alias.scopePersonId, originAccountId),
      });
    }
    if (!tx.payees.softDelete(ctx.viewer, before.id, at)) {
      throw new AppError("NotFound", "Payee not found");
    }
    audit({
      entity: "payee",
      entityId: before.id,
      action: "delete",
      before,
      after: null,
      ...auditScope(before.scopePersonId, origin),
    });
  });
}

export const listPayeesInput = z.object({}).strict();

/** `classify.listPayees`: shared payees and the viewer's own, by name. */
export function listPayees(
  ctx: UseCaseContext,
  input: z.input<typeof listPayeesInput> = {},
): PayeeRow[] {
  parseInput(listPayeesInput, input);
  return ctx.uow.read((repos) => repos.payees.list(ctx.viewer));
}

export const getPayeeInput = z.object({ id: idInput }).strict();

/** `classify.getPayee`: another person's scoped payee is `NotFound`. */
export function getPayee(ctx: UseCaseContext, input: z.input<typeof getPayeeInput>): PayeeRow {
  const parsed = parseInput(getPayeeInput, input);
  return ctx.uow.read((repos) => {
    const row = repos.payees.find(ctx.viewer, parsed.id);
    if (row === undefined) throw new AppError("NotFound", "Payee not found");
    return row;
  });
}

// ---------------------------------------------------------------------------------- aliases

function requirePatternValid(pattern: string, kind: AliasMatchKind): void {
  if (kind !== "regex") return;
  try {
    new RegExp(pattern);
  } catch {
    throw new AppError("Validation", "The pattern is not a valid regular expression");
  }
}

function requireAliasFree(
  tx: TxRepos,
  ctx: UseCaseContext,
  scopePersonId: string | null,
  kind: AliasMatchKind,
  pattern: string,
  selfId?: string,
): void {
  if (
    tx.payeeAliases
      .list(ctx.viewer)
      .some(
        (a) =>
          a.id !== selfId &&
          a.scopePersonId === scopePersonId &&
          a.matchKind === kind &&
          a.pattern === pattern,
      )
  ) {
    throw new AppError("Conflict", "An alias with this pattern already exists");
  }
}

export const createPayeeAliasInput = z
  .object({
    payeeId: idInput,
    pattern: patternInput,
    matchKind: z.enum(ALIAS_MATCH_KINDS),
    originAccountId: originInput,
  })
  .strict();
export type CreatePayeeAliasInput = z.input<typeof createPayeeAliasInput>;

/**
 * `classify.createPayeeAlias`: the alias takes the scope of its origin account (AD-18) and must
 * agree with its payee: the same scope, or a shared payee. A shared alias never points at a
 * scoped payee. The pattern must compile when it is a regex.
 */
export function createPayeeAlias(ctx: UseCaseContext, input: CreatePayeeAliasInput): PayeeAliasRow {
  const parsed = parseInput(createPayeeAliasInput, input);
  return write(ctx, (tx, audit) => {
    const payee = tx.payees.find(ctx.viewer, parsed.payeeId);
    if (payee === undefined) throw new AppError("NotFound", "Payee not found");
    const scope = scopeFor(tx, ctx.viewer, parsed.originAccountId);
    if (payee.scopePersonId !== null && payee.scopePersonId !== scope.scopePersonId) {
      throw new AppError("Validation", "An alias for this payee needs a matching origin account");
    }
    requirePatternValid(parsed.pattern, parsed.matchKind);
    requireAliasFree(tx, ctx, scope.scopePersonId, parsed.matchKind, parsed.pattern);
    const at = formatInstant(ctx.clock.now());
    const row: PayeeAliasRow = {
      id: ctx.newId<"PayeeAlias">(),
      pattern: parsed.pattern,
      matchKind: parsed.matchKind,
      payeeId: payee.id,
      scopePersonId: scope.scopePersonId,
      createdAt: at,
      updatedAt: at,
    };
    tx.payeeAliases.insert(row, scope.origin);
    audit({
      entity: "payee_alias",
      entityId: row.id,
      action: "create",
      before: null,
      after: row,
      ...auditScope(scope.scopePersonId, scope.origin),
    });
    return row;
  });
}

export const updatePayeeAliasInput = z
  .object({
    id: idInput,
    pattern: patternInput.optional(),
    matchKind: z.enum(ALIAS_MATCH_KINDS).optional(),
  })
  .strict();
export type UpdatePayeeAliasInput = z.input<typeof updatePayeeAliasInput>;

/** `classify.updatePayeeAlias`: another person's scoped alias is `NotFound`. Scope never changes. */
export function updatePayeeAlias(ctx: UseCaseContext, input: UpdatePayeeAliasInput): PayeeAliasRow {
  const parsed = parseInput(updatePayeeAliasInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.payeeAliases.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Alias not found");
    const origin = tx.payeeAliases.originOf(ctx.viewer, before.id) ?? null;
    const pattern = parsed.pattern ?? before.pattern;
    const matchKind = parsed.matchKind ?? before.matchKind;
    requirePatternValid(pattern, matchKind);
    requireAliasFree(tx, ctx, before.scopePersonId, matchKind, pattern, before.id);
    const after: PayeeAliasRow = {
      ...before,
      id: before.id as Id<"PayeeAlias">,
      pattern,
      matchKind,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    if (!tx.payeeAliases.update(ctx.viewer, after))
      throw new AppError("NotFound", "Alias not found");
    audit({
      entity: "payee_alias",
      entityId: before.id,
      action: "update",
      before,
      after,
      ...auditScope(before.scopePersonId, origin),
    });
    return after;
  });
}

export const deletePayeeAliasInput = z.object({ id: idInput }).strict();

/** `classify.deletePayeeAlias`: soft-deletes; another person's scoped alias is `NotFound`. */
export function deletePayeeAlias(
  ctx: UseCaseContext,
  input: z.input<typeof deletePayeeAliasInput>,
): void {
  const parsed = parseInput(deletePayeeAliasInput, input);
  write(ctx, (tx, audit) => {
    const before = tx.payeeAliases.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Alias not found");
    const origin = tx.payeeAliases.originOf(ctx.viewer, before.id) ?? null;
    const at = formatInstant(ctx.clock.now());
    if (!tx.payeeAliases.softDelete(ctx.viewer, before.id, at)) {
      throw new AppError("NotFound", "Alias not found");
    }
    audit({
      entity: "payee_alias",
      entityId: before.id,
      action: "delete",
      before,
      after: null,
      ...auditScope(before.scopePersonId, origin),
    });
  });
}

export const listPayeeAliasesInput = z.object({}).strict();

/** `classify.listPayeeAliases`: shared aliases and the viewer's own, by pattern. */
export function listPayeeAliases(
  ctx: UseCaseContext,
  input: z.input<typeof listPayeeAliasesInput> = {},
): PayeeAliasRow[] {
  parseInput(listPayeeAliasesInput, input);
  return ctx.uow.read((repos) => repos.payeeAliases.list(ctx.viewer));
}

export const getPayeeAliasInput = z.object({ id: idInput }).strict();

/** `classify.getPayeeAlias`: another person's scoped alias is `NotFound`. */
export function getPayeeAlias(
  ctx: UseCaseContext,
  input: z.input<typeof getPayeeAliasInput>,
): PayeeAliasRow {
  const parsed = parseInput(getPayeeAliasInput, input);
  return ctx.uow.read((repos) => {
    const row = repos.payeeAliases.find(ctx.viewer, parsed.id);
    if (row === undefined) throw new AppError("NotFound", "Alias not found");
    return row;
  });
}
