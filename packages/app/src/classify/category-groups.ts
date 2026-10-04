import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { idInput } from "../accounts/inputs.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import {
  CATEGORY_GROUP_KINDS,
  type CategoryGroupRow,
  type TxRepos,
} from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { nameInput } from "./scope.ts";

const sortInput = z.int().min(0).max(1_000_000);

function requireNameFree(tx: TxRepos, ctx: UseCaseContext, name: string, selfId?: string): void {
  if (tx.categoryGroups.list(ctx.viewer).some((g) => g.id !== selfId && g.name === name)) {
    throw new AppError("Conflict", "A category group with this name already exists");
  }
}

export const createCategoryGroupInput = z
  .object({
    name: nameInput,
    kind: z.enum(CATEGORY_GROUP_KINDS),
    /** Defaults to after the last group. */
    sort: sortInput.optional(),
  })
  .strict();
export type CreateCategoryGroupInput = z.input<typeof createCategoryGroupInput>;

/** `classify.createCategoryGroup`: household-wide, so the audit row carries no scope. */
export function createCategoryGroup(
  ctx: UseCaseContext,
  input: CreateCategoryGroupInput,
): CategoryGroupRow {
  const parsed = parseInput(createCategoryGroupInput, input);
  return write(ctx, (tx, audit) => {
    requireNameFree(tx, ctx, parsed.name);
    const at = formatInstant(ctx.clock.now());
    const sort =
      parsed.sort ??
      tx.categoryGroups.list(ctx.viewer).reduce((max, g) => Math.max(max, g.sort), 0) + 1;
    const row: CategoryGroupRow = {
      id: ctx.newId<"CategoryGroup">(),
      name: parsed.name,
      kind: parsed.kind,
      sort,
      createdAt: at,
      updatedAt: at,
    };
    tx.categoryGroups.insert(row);
    audit({
      entity: "category_group",
      entityId: row.id,
      action: "create",
      before: null,
      after: row,
    });
    return row;
  });
}

export const updateCategoryGroupInput = z
  .object({
    id: idInput,
    name: nameInput.optional(),
    kind: z.enum(CATEGORY_GROUP_KINDS).optional(),
    sort: sortInput.optional(),
  })
  .strict();
export type UpdateCategoryGroupInput = z.input<typeof updateCategoryGroupInput>;

/** `classify.updateCategoryGroup`: renames, retypes or reorders; groups are never deleted. */
export function updateCategoryGroup(
  ctx: UseCaseContext,
  input: UpdateCategoryGroupInput,
): CategoryGroupRow {
  const parsed = parseInput(updateCategoryGroupInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.categoryGroups.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Category group not found");
    const name = parsed.name ?? before.name;
    requireNameFree(tx, ctx, name, before.id);
    const after: CategoryGroupRow = {
      ...before,
      id: before.id as Id<"CategoryGroup">,
      name,
      kind: parsed.kind ?? before.kind,
      sort: parsed.sort ?? before.sort,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    tx.categoryGroups.update(after);
    audit({ entity: "category_group", entityId: before.id, action: "update", before, after });
    return after;
  });
}

export const listCategoryGroupsInput = z.object({}).strict();

/** `classify.listCategoryGroups`: by sort, then name; household-wide. */
export function listCategoryGroups(
  ctx: UseCaseContext,
  input: z.input<typeof listCategoryGroupsInput> = {},
): CategoryGroupRow[] {
  parseInput(listCategoryGroupsInput, input);
  return ctx.uow.read((repos) => repos.categoryGroups.list(ctx.viewer));
}
