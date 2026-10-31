// Pay anchor use cases (AD-14, AD-22, AD-25).
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { PayAnchorRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

export const getPayAnchorInput = z
  .object({
    personId: z.string().optional(),
  })
  .strict();
export type GetPayAnchorInput = z.input<typeof getPayAnchorInput>;

export const upsertPayAnchorInput = z
  .object({
    personId: z.string().optional(),
    accountId: z.string().min(1, "Account is required"),
    cadence: z.enum(["fortnightly", "monthly"]),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    anchorDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
      .nullable()
      .optional(),
    alignment: z.enum(["calendar", "deposit"]).default("calendar"),
    expectedNetCents: z.number().int().nonnegative().nullable().optional(),
    expectedGrossCents: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.cadence === "fortnightly") {
        return !!data.anchorDate;
      }
      if (data.cadence === "monthly") {
        return data.dayOfMonth !== null && data.dayOfMonth !== undefined;
      }
      return false;
    },
    {
      message:
        "Fortnightly cadence requires anchorDate (YYYY-MM-DD); monthly cadence requires dayOfMonth (1-31)",
      path: ["cadence"],
    },
  );
export type UpsertPayAnchorInput = z.input<typeof upsertPayAnchorInput>;

/**
 * Gets a person's pay anchor.
 * Per AD-22: Partner A cannot see Partner B's private pay anchor.
 * If personId is not specified, defaults to the viewer's own personId.
 */
export function getPayAnchor(
  ctx: UseCaseContext,
  input: GetPayAnchorInput,
): PayAnchorRow | undefined {
  const parsed = parseInput(getPayAnchorInput, input);
  const targetPersonId =
    parsed.personId ?? (ctx.viewer.kind === "person" ? ctx.viewer.personId : undefined);

  if (!targetPersonId) {
    throw new AppError("Validation", "personId is required for system viewer");
  }

  // Cross-partner check (AD-22):
  if (ctx.viewer.kind === "person" && ctx.viewer.personId !== targetPersonId) {
    throw new AppError("NotFound", "Pay anchor not found");
  }

  return ctx.uow.read((repos) =>
    repos.payAnchors.findByPersonId(ctx.viewer, targetPersonId as Id<"Person">),
  );
}

/**
 * Lists pay anchors visible to the current viewer.
 */
export function listPayAnchors(
  ctx: UseCaseContext,
  _input: Record<string, never> = {},
): readonly PayAnchorRow[] {
  return ctx.uow.read((repos) => repos.payAnchors.listVisible(ctx.viewer));
}

/**
 * Upserts a person's pay anchor.
 */
export function upsertPayAnchor(ctx: UseCaseContext, input: UpsertPayAnchorInput): PayAnchorRow {
  const parsed = parseInput(upsertPayAnchorInput, input);
  const targetPersonId =
    parsed.personId ?? (ctx.viewer.kind === "person" ? ctx.viewer.personId : undefined);

  if (!targetPersonId) {
    throw new AppError("Validation", "personId is required for system viewer");
  }

  if (ctx.viewer.kind === "person" && ctx.viewer.personId !== targetPersonId) {
    throw new AppError("NotFound", "Pay anchor not found");
  }

  return write(ctx, (tx, audit) => {
    // Verify target person exists
    const persons = tx.person.listActive();
    const personExists = persons.some((p) => p.id === targetPersonId);
    if (!personExists) {
      throw new AppError("Validation", "Person does not exist");
    }

    // Verify account is visible to the viewer
    const account = tx.accounts.findVisible(ctx.viewer, parsed.accountId);
    if (!account) {
      throw new AppError("NotFound", "Deposit account not found");
    }

    const existing = tx.payAnchors.findByPersonId(ctx.viewer, targetPersonId as Id<"Person">);

    const now = formatInstant(ctx.clock.now());

    if (existing) {
      const updated: PayAnchorRow = {
        id: existing.id,
        personId: existing.personId,
        accountId: parsed.accountId as Id<"Account">,
        cadence: parsed.cadence,
        dayOfMonth: parsed.dayOfMonth ?? null,
        anchorDate: parsed.anchorDate ?? null,
        alignment: parsed.alignment,
        expectedNetCents: parsed.expectedNetCents ?? null,
        expectedGrossCents: parsed.expectedGrossCents ?? null,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      tx.payAnchors.update(updated);
      audit({
        entity: "pay_anchor",
        entityId: updated.id,
        personId: updated.personId,
        action: "update",
        before: existing,
        after: updated,
      });
      return updated;
    }

    const id = ctx.newId<"PayAnchor">();
    const created: PayAnchorRow = {
      id,
      personId: targetPersonId as Id<"Person">,
      accountId: parsed.accountId as Id<"Account">,
      cadence: parsed.cadence,
      dayOfMonth: parsed.dayOfMonth ?? null,
      anchorDate: parsed.anchorDate ?? null,
      alignment: parsed.alignment,
      expectedNetCents: parsed.expectedNetCents ?? null,
      expectedGrossCents: parsed.expectedGrossCents ?? null,
      createdAt: now,
      updatedAt: now,
    };
    tx.payAnchors.insert(created);
    audit({
      entity: "pay_anchor",
      entityId: created.id,
      personId: created.personId,
      action: "create",
      before: null,
      after: created,
    });
    return created;
  });
}
