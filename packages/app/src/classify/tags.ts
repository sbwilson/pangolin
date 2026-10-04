import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { idInput } from "../accounts/inputs.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { TagRow, TxRepos } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { auditScope, nameInput, originInput, scopeFor } from "./scope.ts";

/** A name is unique per scope among live rows; the message never mentions scope. */
function requireNameFree(
  tx: TxRepos,
  ctx: UseCaseContext,
  scopePersonId: string | null,
  name: string,
  selfId?: string,
): void {
  if (
    tx.tags
      .list(ctx.viewer)
      .some((t) => t.id !== selfId && t.scopePersonId === scopePersonId && t.name === name)
  ) {
    throw new AppError("Conflict", "A tag with this name already exists");
  }
}

export const createTagInput = z.object({ name: nameInput, originAccountId: originInput }).strict();
export type CreateTagInput = z.input<typeof createTagInput>;

/** `classify.createTag`: scope comes from the origin account (AD-18), never from the client. */
export function createTag(ctx: UseCaseContext, input: CreateTagInput): TagRow {
  const parsed = parseInput(createTagInput, input);
  return write(ctx, (tx, audit) => {
    const scope = scopeFor(tx, ctx.viewer, parsed.originAccountId);
    requireNameFree(tx, ctx, scope.scopePersonId, parsed.name);
    const at = formatInstant(ctx.clock.now());
    const row: TagRow = {
      id: ctx.newId<"Tag">(),
      name: parsed.name,
      scopePersonId: scope.scopePersonId,
      createdAt: at,
      updatedAt: at,
    };
    tx.tags.insert(row, scope.origin);
    audit({
      entity: "tag",
      entityId: row.id,
      action: "create",
      before: null,
      after: row,
      ...auditScope(scope.scopePersonId, scope.origin),
    });
    return row;
  });
}

export const updateTagInput = z.object({ id: idInput, name: nameInput.optional() }).strict();
export type UpdateTagInput = z.input<typeof updateTagInput>;

/** `classify.updateTag`: another person's scoped tag is `NotFound`. Scope never changes. */
export function updateTag(ctx: UseCaseContext, input: UpdateTagInput): TagRow {
  const parsed = parseInput(updateTagInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.tags.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Tag not found");
    const origin = tx.tags.originOf(ctx.viewer, before.id) ?? null;
    const name = parsed.name ?? before.name;
    requireNameFree(tx, ctx, before.scopePersonId, name, before.id);
    const after: TagRow = {
      ...before,
      id: before.id as Id<"Tag">,
      name,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    if (!tx.tags.update(ctx.viewer, after)) throw new AppError("NotFound", "Tag not found");
    audit({
      entity: "tag",
      entityId: before.id,
      action: "update",
      before,
      after,
      ...auditScope(before.scopePersonId, origin),
    });
    return after;
  });
}

export const deleteTagInput = z.object({ id: idInput }).strict();
export type DeleteTagInput = z.input<typeof deleteTagInput>;

/** `classify.deleteTag`: soft-deletes; another person's scoped tag is `NotFound`. */
export function deleteTag(ctx: UseCaseContext, input: DeleteTagInput): void {
  const parsed = parseInput(deleteTagInput, input);
  write(ctx, (tx, audit) => {
    const before = tx.tags.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Tag not found");
    const origin = tx.tags.originOf(ctx.viewer, before.id) ?? null;
    const at = formatInstant(ctx.clock.now());
    if (!tx.tags.softDelete(ctx.viewer, before.id, at))
      throw new AppError("NotFound", "Tag not found");
    audit({
      entity: "tag",
      entityId: before.id,
      action: "delete",
      before,
      after: null,
      ...auditScope(before.scopePersonId, origin),
    });
  });
}

export const listTagsInput = z.object({}).strict();

/** `classify.listTags`: shared tags and the viewer's own, by name. */
export function listTags(ctx: UseCaseContext, input: z.input<typeof listTagsInput> = {}): TagRow[] {
  parseInput(listTagsInput, input);
  return ctx.uow.read((repos) => repos.tags.list(ctx.viewer));
}

export const getTagInput = z.object({ id: idInput }).strict();

/** `classify.getTag`: another person's scoped tag is `NotFound`. */
export function getTag(ctx: UseCaseContext, input: z.input<typeof getTagInput>): TagRow {
  const parsed = parseInput(getTagInput, input);
  return ctx.uow.read((repos) => {
    const row = repos.tags.find(ctx.viewer, parsed.id);
    if (row === undefined) throw new AppError("NotFound", "Tag not found");
    return row;
  });
}
