import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { idInput } from "../accounts/inputs.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { CategoryRow, TxRepos } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { auditScope, nameInput } from "./scope.ts";

function requireGroup(tx: TxRepos, ctx: UseCaseContext, groupId: string): void {
  if (tx.categoryGroups.find(ctx.viewer, groupId) === undefined) {
    throw new AppError("Validation", "Unknown category group");
  }
}

function requireNameFree(
  tx: TxRepos,
  ctx: UseCaseContext,
  groupId: string,
  name: string,
  selfId?: string,
): void {
  if (
    tx.categories
      .list(ctx.viewer)
      .some((c) => c.id !== selfId && c.groupId === groupId && c.name === name)
  ) {
    throw new AppError("Conflict", "A category with this name already exists in the group");
  }
}

export const createCategoryInput = z
  .object({
    groupId: idInput,
    name: nameInput,
    isFixedCost: z.boolean().optional(),
  })
  .strict();
export type CreateCategoryInput = z.input<typeof createCategoryInput>;

/** `classify.createCategory`: household-wide, so the audit row carries no scope. */
export function createCategory(ctx: UseCaseContext, input: CreateCategoryInput): CategoryRow {
  const parsed = parseInput(createCategoryInput, input);
  return write(ctx, (tx, audit) => {
    requireGroup(tx, ctx, parsed.groupId);
    requireNameFree(tx, ctx, parsed.groupId, parsed.name);
    const at = formatInstant(ctx.clock.now());
    const row: CategoryRow = {
      id: ctx.newId<"Category">(),
      groupId: parsed.groupId as Id<"CategoryGroup">,
      name: parsed.name,
      isFixedCost: parsed.isFixedCost ?? false,
      createdAt: at,
      updatedAt: at,
    };
    tx.categories.insert(row);
    audit({ entity: "category", entityId: row.id, action: "create", before: null, after: row });
    return row;
  });
}

export const updateCategoryInput = z
  .object({
    id: idInput,
    groupId: idInput.optional(),
    name: nameInput.optional(),
    isFixedCost: z.boolean().optional(),
  })
  .strict();
export type UpdateCategoryInput = z.input<typeof updateCategoryInput>;

/** `classify.updateCategory`: renames, moves to another group or flips the fixed-cost flag. */
export function updateCategory(ctx: UseCaseContext, input: UpdateCategoryInput): CategoryRow {
  const parsed = parseInput(updateCategoryInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.categories.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Category not found");
    const groupId = (parsed.groupId ?? before.groupId) as Id<"CategoryGroup">;
    if (groupId !== before.groupId) requireGroup(tx, ctx, groupId);
    const name = parsed.name ?? before.name;
    requireNameFree(tx, ctx, groupId, name, before.id);
    const after: CategoryRow = {
      ...before,
      id: before.id as Id<"Category">,
      groupId,
      name,
      isFixedCost: parsed.isFixedCost ?? before.isFixedCost,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    tx.categories.update(after);
    audit({ entity: "category", entityId: before.id, action: "update", before, after });
    return after;
  });
}

export const deleteCategoryInput = z.object({ id: idInput }).strict();
export type DeleteCategoryInput = z.input<typeof deleteCategoryInput>;

/**
 * `classify.deleteCategory`: soft-deletes the category. Splits that reference it are left
 * untouched; every payee default that named it is cleared (each audited with its own scope).
 */
export function deleteCategory(ctx: UseCaseContext, input: DeleteCategoryInput): void {
  const parsed = parseInput(deleteCategoryInput, input);
  write(ctx, (tx, audit) => {
    const before = tx.categories.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Category not found");
    const at = formatInstant(ctx.clock.now());
    for (const { before: payee, originAccountId } of tx.payees.clearDefaultCategory(
      before.id,
      at,
    )) {
      audit({
        entity: "payee",
        entityId: payee.id,
        action: "update",
        before: payee,
        after: { ...payee, defaultCategoryId: null, updatedAt: at },
        ...auditScope(payee.scopePersonId, originAccountId),
      });
    }
    if (!tx.categories.softDelete(before.id, at))
      throw new AppError("NotFound", "Category not found");
    audit({ entity: "category", entityId: before.id, action: "delete", before, after: null });
  });
}

export const listCategoriesInput = z.object({}).strict();

/** `classify.listCategories`: live categories by name; household-wide. */
export function listCategories(
  ctx: UseCaseContext,
  input: z.input<typeof listCategoriesInput> = {},
): CategoryRow[] {
  parseInput(listCategoriesInput, input);
  return ctx.uow.read((repos) => repos.categories.list(ctx.viewer));
}
