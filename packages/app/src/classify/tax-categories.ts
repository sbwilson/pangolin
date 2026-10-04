import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { idInput } from "../accounts/inputs.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { TaxCategoryRow, TxRepos } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

const codeInput = z.string().trim().min(1, { message: "Enter a code" }).max(20);
const labelInput = z.string().trim().min(1, { message: "Enter a label" }).max(200);
const shareInput = z.int().min(0).max(10_000);

function requireCodeFree(tx: TxRepos, ctx: UseCaseContext, code: string, selfId?: string): void {
  if (tx.taxCategories.list(ctx.viewer).some((t) => t.id !== selfId && t.code === code)) {
    throw new AppError("Conflict", "A tax category with this code already exists");
  }
}

export const createTaxCategoryInput = z
  .object({
    code: codeInput,
    label: labelInput,
    /** Basis points; defaults to 0. */
    defaultDeductibleBp: shareInput.optional(),
  })
  .strict();
export type CreateTaxCategoryInput = z.input<typeof createTaxCategoryInput>;

/** `classify.createTaxCategory`: household-wide, so the audit row carries no scope. */
export function createTaxCategory(
  ctx: UseCaseContext,
  input: CreateTaxCategoryInput,
): TaxCategoryRow {
  const parsed = parseInput(createTaxCategoryInput, input);
  return write(ctx, (tx, audit) => {
    requireCodeFree(tx, ctx, parsed.code);
    const at = formatInstant(ctx.clock.now());
    const row: TaxCategoryRow = {
      id: ctx.newId<"TaxCategory">(),
      code: parsed.code,
      label: parsed.label,
      defaultDeductibleBp: parsed.defaultDeductibleBp ?? 0,
      createdAt: at,
      updatedAt: at,
    };
    tx.taxCategories.insert(row);
    audit({ entity: "tax_category", entityId: row.id, action: "create", before: null, after: row });
    return row;
  });
}

export const updateTaxCategoryInput = z
  .object({
    id: idInput,
    code: codeInput.optional(),
    label: labelInput.optional(),
    defaultDeductibleBp: shareInput.optional(),
  })
  .strict();
export type UpdateTaxCategoryInput = z.input<typeof updateTaxCategoryInput>;

/** `classify.updateTaxCategory`: an unknown ID is `NotFound`. */
export function updateTaxCategory(
  ctx: UseCaseContext,
  input: UpdateTaxCategoryInput,
): TaxCategoryRow {
  const parsed = parseInput(updateTaxCategoryInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.taxCategories.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Tax category not found");
    const code = parsed.code ?? before.code;
    requireCodeFree(tx, ctx, code, before.id);
    const after: TaxCategoryRow = {
      ...before,
      id: before.id as Id<"TaxCategory">,
      code,
      label: parsed.label ?? before.label,
      defaultDeductibleBp: parsed.defaultDeductibleBp ?? before.defaultDeductibleBp,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    tx.taxCategories.update(after);
    audit({ entity: "tax_category", entityId: before.id, action: "update", before, after });
    return after;
  });
}

export const listTaxCategoriesInput = z.object({}).strict();

/** `classify.listTaxCategories`: by code; household-wide. */
export function listTaxCategories(
  ctx: UseCaseContext,
  input: z.input<typeof listTaxCategoriesInput> = {},
): TaxCategoryRow[] {
  parseInput(listTaxCategoriesInput, input);
  return ctx.uow.read((repos) => repos.taxCategories.list(ctx.viewer));
}
