import { idSchema } from "@pangolin/shared";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import { systemViewer } from "../system-viewer.ts";
import { DEFAULT_SETTINGS, memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { getHouseholdSettings, updateHouseholdSettings } from "./household-settings.ts";

const personId = idSchema("Person").parse("01J0000000000000000000000A");
const now = Temporal.Instant.from("2026-09-27T01:02:03Z");

function context(viewer: Viewer = personViewer(personId, now)) {
  const uow = memoryUnitOfWork();
  const ctx: UseCaseContext = {
    viewer,
    clock: fixedClock(parseDate("2026-09-27"), now),
    newId: createIdGenerator({ now: () => now.epochMilliseconds, random: () => 0.5 }),
    uow,
  };
  return { ctx, uow };
}

function validationError(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError && error.code === "Validation") return error;
    throw error;
  }
  throw new Error("expected a Validation error");
}

describe("system.getHouseholdSettings", () => {
  it("returns the settings row", () => {
    const { ctx } = context();
    expect(getHouseholdSettings(ctx, {})).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects unknown input fields", () => {
    const { ctx } = context();
    validationError(() => getHouseholdSettings(ctx, { extra: 1 } as never));
  });
});

describe("system.updateHouseholdSettings", () => {
  it("updates the row and writes one audit row with before and after", () => {
    const { ctx, uow } = context();
    const result = updateHouseholdSettings(ctx, { timezone: "Australia/Brisbane" });
    const after = {
      ...DEFAULT_SETTINGS,
      timezone: "Australia/Brisbane",
      updatedAt: "2026-09-27T01:02:03.000Z",
    };
    expect(result).toEqual(after);
    expect(uow.state.settings).toEqual(after);
    expect(uow.state.audit).toHaveLength(1);
    const [row] = uow.state.audit;
    expect(row).toMatchObject({
      actor: `person:${personId}`,
      entity: "household_settings",
      entityId: "1",
      action: "update",
      at: "2026-09-27T01:02:03.000Z",
      accountId: null,
      personId: null,
    });
    expect(JSON.parse(row?.before ?? "")).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(row?.after ?? "")).toEqual(after);
  });

  it("audits a system viewer by its actor", () => {
    const { ctx, uow } = context(systemViewer("job:period-close"));
    updateHouseholdSettings(ctx, { sharedAttribution: "even" });
    expect(uow.state.audit.map((row) => row.actor)).toEqual(["job:period-close"]);
  });

  it("updates several fields at once and keeps fyStart", () => {
    const { ctx } = context();
    const result = updateHouseholdSettings(ctx, {
      baseCurrency: "NZD",
      timezone: "Pacific/Auckland",
      sharedAttribution: "even",
    });
    expect(result).toMatchObject({
      baseCurrency: "NZD",
      fyStart: "07-01",
      timezone: "Pacific/Auckland",
      sharedAttribution: "even",
    });
  });

  it("canonicalises the time zone name", () => {
    const { ctx } = context();
    expect(updateHouseholdSettings(ctx, { timezone: "australia/brisbane" }).timezone).toBe(
      "Australia/Brisbane",
    );
  });

  it("writes nothing when the patch changes nothing", () => {
    const { ctx, uow } = context();
    expect(updateHouseholdSettings(ctx, {})).toEqual(DEFAULT_SETTINGS);
    expect(updateHouseholdSettings(ctx, { timezone: "Australia/Sydney" })).toEqual(
      DEFAULT_SETTINGS,
    );
    // An explicit undefined is "not given", never a blanked column.
    expect(updateHouseholdSettings(ctx, { timezone: undefined } as never)).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(uow.state.audit).toEqual([]);
  });

  it("leaves the row unchanged when the audit append fails", () => {
    const { ctx, uow } = context();
    uow.failAudit = true;
    expect(() => updateHouseholdSettings(ctx, { timezone: "Australia/Brisbane" })).toThrow(
      "audit append failed",
    );
    expect(uow.state.settings).toEqual(DEFAULT_SETTINGS);
    expect(uow.state.audit).toEqual([]);
  });

  it.each([
    [{ timezone: "Not/A_Zone" }, ["timezone"]],
    [{ timezone: "+10:00" }, ["timezone"]],
    [{ timezone: "" }, ["timezone"]],
    [{ baseCurrency: "aud" }, ["baseCurrency"]],
    [{ baseCurrency: "AUDD" }, ["baseCurrency"]],
    [{ sharedAttribution: "half" }, ["sharedAttribution"]],
    [{ fyStart: "01-01" }, []],
    [{ colour: "red" }, []],
  ])("rejects %j as Validation with details, writing nothing", (input, path) => {
    const { ctx, uow } = context();
    const err = validationError(() => updateHouseholdSettings(ctx, input as never));
    expect(err.details).toEqual([expect.objectContaining({ path })]);
    expect(uow.state.settings).toEqual(DEFAULT_SETTINGS);
    expect(uow.state.audit).toEqual([]);
  });
});
