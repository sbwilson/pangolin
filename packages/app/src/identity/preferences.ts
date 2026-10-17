import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import {
  THEME_MODES,
  THEME_NAMES,
  type ThemeMode,
  type ThemeName,
} from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

export interface Preferences {
  readonly theme: ThemeName;
  readonly mode: ThemeMode;
}

export const getPreferencesInput = z.object({}).strict();
export type GetPreferencesInput = z.input<typeof getPreferencesInput>;

export const updatePreferencesInput = z
  .object({
    theme: z.enum(THEME_NAMES).optional(),
    mode: z.enum(THEME_MODES).optional(),
  })
  .strict();
export type UpdatePreferencesInput = z.input<typeof updatePreferencesInput>;

/** `identity.getPreferences`: gets the signed-in person's preferences, defaulting to clay-linen / system. */
export function getPreferences(
  ctx: UseCaseContext,
  input: GetPreferencesInput = {},
): Preferences {
  parseInput(getPreferencesInput, input);
  const viewer = ctx.viewer;
  if (viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");

  return ctx.uow.read((repos) => {
    const row = repos.personPreferences.get(viewer.personId);
    if (row === undefined) {
      return { theme: "clay-linen", mode: "system" };
    }
    return { theme: row.theme, mode: row.mode };
  });
}

/** `identity.updatePreferences`: updates theme/mode preferences for the signed-in person, audited. */
export function updatePreferences(
  ctx: UseCaseContext,
  input: UpdatePreferencesInput,
): Preferences {
  const parsed = parseInput(updatePreferencesInput, input);
  const viewer = ctx.viewer;
  if (viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");

  return write(ctx, (tx, audit) => {
    const existing = tx.personPreferences.get(viewer.personId);
    const before = existing ? { theme: existing.theme, mode: existing.mode } : null;
    const theme = parsed.theme ?? existing?.theme ?? "clay-linen";
    const mode = parsed.mode ?? existing?.mode ?? "system";
    const now = formatInstant(ctx.clock.now());
    const createdAt = existing?.createdAt ?? now;

    tx.personPreferences.upsert({
      personId: viewer.personId,
      theme,
      mode,
      createdAt,
      updatedAt: now,
    });

    const after: Preferences = { theme, mode };

    audit({
      entity: "person_preference",
      entityId: viewer.personId,
      personId: viewer.personId,
      action: "update",
      before,
      after,
    });

    return after;
  });
}
