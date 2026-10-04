import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { dayInput, idInput } from "../accounts/inputs.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { ActivityRow, TxRepos } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { auditScope, nameInput, originInput, scopeFor } from "./scope.ts";

const budgetInput = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

function requireNameFree(
  tx: TxRepos,
  ctx: UseCaseContext,
  scopePersonId: string | null,
  name: string,
  selfId?: string,
): void {
  if (
    tx.activities
      .list(ctx.viewer)
      .some((a) => a.id !== selfId && a.scopePersonId === scopePersonId && a.name === name)
  ) {
    throw new AppError("Conflict", "An activity with this name already exists");
  }
}

function requireDatesInOrder(startsOn: string | null, endsOn: string | null): void {
  if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
    throw new AppError("Validation", "An activity cannot end before it starts");
  }
}

export const createActivityInput = z
  .object({
    name: nameInput,
    startsOn: dayInput.nullish(),
    endsOn: dayInput.nullish(),
    budgetCents: budgetInput.nullish(),
    originAccountId: originInput,
  })
  .strict();
export type CreateActivityInput = z.input<typeof createActivityInput>;

/** `classify.createActivity`: scope comes from the origin account (AD-18), never from the client. */
export function createActivity(ctx: UseCaseContext, input: CreateActivityInput): ActivityRow {
  const parsed = parseInput(createActivityInput, input);
  return write(ctx, (tx, audit) => {
    const startsOn = parsed.startsOn ?? null;
    const endsOn = parsed.endsOn ?? null;
    requireDatesInOrder(startsOn, endsOn);
    const scope = scopeFor(tx, ctx.viewer, parsed.originAccountId);
    requireNameFree(tx, ctx, scope.scopePersonId, parsed.name);
    const at = formatInstant(ctx.clock.now());
    const row: ActivityRow = {
      id: ctx.newId<"Activity">(),
      name: parsed.name,
      startsOn,
      endsOn,
      budgetCents: parsed.budgetCents ?? null,
      scopePersonId: scope.scopePersonId,
      createdAt: at,
      updatedAt: at,
    };
    tx.activities.insert(row, scope.origin);
    audit({
      entity: "activity",
      entityId: row.id,
      action: "create",
      before: null,
      after: row,
      ...auditScope(scope.scopePersonId, scope.origin),
    });
    return row;
  });
}

export const updateActivityInput = z
  .object({
    id: idInput,
    name: nameInput.optional(),
    /** Null clears the date or budget. */
    startsOn: dayInput.nullish(),
    endsOn: dayInput.nullish(),
    budgetCents: budgetInput.nullish(),
  })
  .strict();
export type UpdateActivityInput = z.input<typeof updateActivityInput>;

/** `classify.updateActivity`: another person's scoped activity is `NotFound`. Scope never changes. */
export function updateActivity(ctx: UseCaseContext, input: UpdateActivityInput): ActivityRow {
  const parsed = parseInput(updateActivityInput, input);
  return write(ctx, (tx, audit) => {
    const before = tx.activities.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Activity not found");
    const origin = tx.activities.originOf(ctx.viewer, before.id) ?? null;
    const name = parsed.name ?? before.name;
    const startsOn = parsed.startsOn === undefined ? before.startsOn : parsed.startsOn;
    const endsOn = parsed.endsOn === undefined ? before.endsOn : parsed.endsOn;
    requireDatesInOrder(startsOn, endsOn);
    requireNameFree(tx, ctx, before.scopePersonId, name, before.id);
    const after: ActivityRow = {
      ...before,
      id: before.id as Id<"Activity">,
      name,
      startsOn,
      endsOn,
      budgetCents: parsed.budgetCents === undefined ? before.budgetCents : parsed.budgetCents,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    if (!tx.activities.update(ctx.viewer, after))
      throw new AppError("NotFound", "Activity not found");
    audit({
      entity: "activity",
      entityId: before.id,
      action: "update",
      before,
      after,
      ...auditScope(before.scopePersonId, origin),
    });
    return after;
  });
}

export const deleteActivityInput = z.object({ id: idInput }).strict();
export type DeleteActivityInput = z.input<typeof deleteActivityInput>;

/** `classify.deleteActivity`: soft-deletes; another person's scoped activity is `NotFound`. */
export function deleteActivity(ctx: UseCaseContext, input: DeleteActivityInput): void {
  const parsed = parseInput(deleteActivityInput, input);
  write(ctx, (tx, audit) => {
    const before = tx.activities.find(ctx.viewer, parsed.id);
    if (before === undefined) throw new AppError("NotFound", "Activity not found");
    const origin = tx.activities.originOf(ctx.viewer, before.id) ?? null;
    const at = formatInstant(ctx.clock.now());
    if (!tx.activities.softDelete(ctx.viewer, before.id, at)) {
      throw new AppError("NotFound", "Activity not found");
    }
    audit({
      entity: "activity",
      entityId: before.id,
      action: "delete",
      before,
      after: null,
      ...auditScope(before.scopePersonId, origin),
    });
  });
}

export const listActivitiesInput = z.object({}).strict();

/** `classify.listActivities`: shared activities and the viewer's own, by name. */
export function listActivities(
  ctx: UseCaseContext,
  input: z.input<typeof listActivitiesInput> = {},
): ActivityRow[] {
  parseInput(listActivitiesInput, input);
  return ctx.uow.read((repos) => repos.activities.list(ctx.viewer));
}

export const getActivityInput = z.object({ id: idInput }).strict();

/** `classify.getActivity`: another person's scoped activity is `NotFound`. */
export function getActivity(
  ctx: UseCaseContext,
  input: z.input<typeof getActivityInput>,
): ActivityRow {
  const parsed = parseInput(getActivityInput, input);
  return ctx.uow.read((repos) => {
    const row = repos.activities.find(ctx.viewer, parsed.id);
    if (row === undefined) throw new AppError("NotFound", "Activity not found");
    return row;
  });
}
