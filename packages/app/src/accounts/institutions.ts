import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { INSTITUTION_KINDS, type InstitutionRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { idInput } from "./inputs.ts";

const nameInput = z.string().trim().min(1, { message: "Enter a name" }).max(100);
const websiteInput = z
  .url({ protocol: /^https?$/, message: "Expected an http or https address" })
  .max(500);

export const createInstitutionInput = z
  .object({
    name: nameInput,
    kind: z.enum(INSTITUTION_KINDS),
    websiteUrl: websiteInput.nullish(),
  })
  .strict();
export type CreateInstitutionInput = z.input<typeof createInstitutionInput>;

/**
 * `accounts.createInstitution`: adds a bank, broker or super fund. Institutions are
 * household-wide, so the audit row has no `accountId`. Returns the server-minted ID.
 */
export function createInstitution(
  ctx: UseCaseContext,
  input: CreateInstitutionInput,
): InstitutionRow {
  const parsed = parseInput(createInstitutionInput, input);
  return write(ctx, (tx, audit) => {
    const at = formatInstant(ctx.clock.now());
    const row: InstitutionRow = {
      id: ctx.newId<"Institution">(),
      name: parsed.name,
      kind: parsed.kind,
      websiteUrl: parsed.websiteUrl ?? null,
      createdAt: at,
      updatedAt: at,
    };
    tx.institutions.insert(row);
    audit({ entity: "institution", entityId: row.id, action: "create", before: null, after: row });
    return row;
  });
}

export const updateInstitutionInput = z
  .object({
    id: idInput,
    name: nameInput.optional(),
    kind: z.enum(INSTITUTION_KINDS).optional(),
    /** Null clears the address. */
    websiteUrl: websiteInput.nullish(),
  })
  .strict();
export type UpdateInstitutionInput = z.input<typeof updateInstitutionInput>;

/** `accounts.updateInstitution`: renames or retypes an institution; an unknown ID is `NotFound`. */
export function updateInstitution(
  ctx: UseCaseContext,
  input: UpdateInstitutionInput,
): InstitutionRow {
  const parsed = parseInput(updateInstitutionInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.institutions.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Institution not found");
    const after: InstitutionRow = {
      ...before,
      id: before.id as Id<"Institution">,
      name: parsed.name ?? before.name,
      kind: parsed.kind ?? before.kind,
      websiteUrl: parsed.websiteUrl === undefined ? before.websiteUrl : parsed.websiteUrl,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    tx.institutions.update(after);
    audit({ entity: "institution", entityId: before.id, action: "update", before, after });
    return after;
  });
}

export const listInstitutionsInput = z.object({}).strict();

/** `accounts.listInstitutions`: every institution by name; household-wide. */
export function listInstitutions(
  ctx: UseCaseContext,
  input: z.input<typeof listInstitutionsInput> = {},
): InstitutionRow[] {
  parseInput(listInstitutionsInput, input);
  return ctx.uow.read((repos) => repos.institutions.list(ctx.viewer));
}
