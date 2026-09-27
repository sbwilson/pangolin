import { formatInstant, Temporal } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { HouseholdSettingsRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

export type HouseholdSettings = HouseholdSettingsRow;

/**
 * A named IANA time zone, canonicalised by Temporal (`australia/brisbane` becomes
 * `Australia/Brisbane`). Fixed offsets such as `+10:00` are rejected; named zones without
 * daylight saving, such as `UTC` or `Etc/GMT-10`, are accepted.
 */
const timeZoneSchema = z.string().transform((value, ctx): string => {
  try {
    const id = Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value).timeZoneId;
    if (/^[+-]/.test(id)) throw new RangeError("offset, not a zone");
    return id;
  } catch {
    ctx.addIssue({ code: "custom", message: "Expected an IANA time zone, e.g. Australia/Sydney" });
    return z.NEVER;
  }
});

export const getHouseholdSettingsInput = z.object({}).strict();
export type GetHouseholdSettingsInput = z.input<typeof getHouseholdSettingsInput>;

/** `fyStart` is not accepted: it stays `07-01`, read-only in v1. */
export const updateHouseholdSettingsInput = z
  .object({
    baseCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/, { message: "Expected a 3-letter uppercase ISO 4217 code" })
      .optional(),
    timezone: timeZoneSchema.optional(),
    sharedAttribution: z.enum(["contribution", "even"]).optional(),
  })
  .strict();
export type UpdateHouseholdSettingsInput = z.input<typeof updateHouseholdSettingsInput>;

/** `system.getHouseholdSettings`: the household-wide settings row. */
export function getHouseholdSettings(
  ctx: UseCaseContext,
  input: GetHouseholdSettingsInput,
): HouseholdSettings {
  parseInput(getHouseholdSettingsInput, input);
  return ctx.uow.read((repos) => repos.householdSettings.get());
}

/**
 * `system.updateHouseholdSettings`: changes any of `baseCurrency`, `timezone` and
 * `sharedAttribution`, audited as one `update` of `household_settings`. A patch that changes
 * nothing writes nothing and returns the current settings.
 */
export function updateHouseholdSettings(
  ctx: UseCaseContext,
  input: UpdateHouseholdSettingsInput,
): HouseholdSettings {
  const parsed = parseInput(updateHouseholdSettingsInput, input);
  // Drop keys given as `undefined`, so spreading the patch never blanks a column.
  const patch: { -readonly [K in keyof typeof parsed]?: NonNullable<(typeof parsed)[K]> } = {};
  if (parsed.baseCurrency !== undefined) patch.baseCurrency = parsed.baseCurrency;
  if (parsed.timezone !== undefined) patch.timezone = parsed.timezone;
  if (parsed.sharedAttribution !== undefined) patch.sharedAttribution = parsed.sharedAttribution;

  return write(ctx, (tx, audit) => {
    const before = tx.householdSettings.get();
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).some(
      (key) => patch[key] !== before[key],
    );
    if (!changed) return before;
    const after: HouseholdSettings = {
      ...before,
      ...patch,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    tx.householdSettings.update(after);
    audit({ entity: "household_settings", entityId: "1", action: "update", before, after });
    return after;
  });
}
