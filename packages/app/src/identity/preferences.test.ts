import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { createPerson } from "./create-person.ts";
import { getPreferences, updatePreferences } from "./preferences.ts";

function setup() {
  const clock = manualClock("2026-10-17T10:00:00Z");
  const { ctx, uow } = memoryContext(systemViewer("cli:test"), clock);
  const alex = createPerson(ctx, { displayName: "Alex", colour: "#2563eb", userId: "user-a" });
  const carissa = createPerson(ctx, { displayName: "Carissa", colour: "#9c4277", userId: "user-c" });
  const alexViewer = personViewer(alex, clock.now());
  const carissaViewer = personViewer(carissa, clock.now());
  return { ctx, uow, clock, alex, carissa, alexViewer, carissaViewer };
}

describe("identity.preferences", () => {
  describe("getPreferences", () => {
    it("returns default preferences { theme: 'clay-linen', mode: 'system' } when uninitialized", () => {
      const { ctx, alexViewer } = setup();
      const prefs = getPreferences({ ...ctx, viewer: alexViewer }, {});
      expect(prefs).toEqual({ theme: "clay-linen", mode: "system" });
    });

    it("returns saved preferences for person with an existing row", () => {
      const { ctx, alexViewer, uow, alex } = setup();
      uow.state.preferences.push({
        personId: alex,
        theme: "fern-gully",
        mode: "dark",
        createdAt: "2026-10-17T09:00:00Z",
        updatedAt: "2026-10-17T09:00:00Z",
      });
      const prefs = getPreferences({ ...ctx, viewer: alexViewer }, {});
      expect(prefs).toEqual({ theme: "fern-gully", mode: "dark" });
    });

    it("throws Unauthenticated when viewer is not a person", () => {
      const { ctx } = setup();
      expect(() => getPreferences(ctx, {})).toThrow(AppError);
      try {
        getPreferences(ctx, {});
      } catch (err) {
        expect((err as AppError).code).toBe("Unauthenticated");
      }
    });
  });

  describe("updatePreferences", () => {
    it("updates preferences, persists row, and records audit log", () => {
      const { ctx, alexViewer, uow, alex } = setup();
      const updated = updatePreferences(
        { ...ctx, viewer: alexViewer },
        { theme: "galah-party", mode: "light" },
      );

      expect(updated).toEqual({ theme: "galah-party", mode: "light" });
      const row = uow.state.preferences.find((p) => p.personId === alex);
      expect(row).toBeDefined();
      expect(row?.theme).toBe("galah-party");
      expect(row?.mode).toBe("light");

      const audit = uow.state.audit.find(
        (a) => a.entity === "person_preference" && a.entityId === alex,
      );
      expect(audit).toBeDefined();
      expect(audit?.action).toBe("update");
      expect(audit?.before).toBeNull();
      expect(JSON.parse(audit?.after ?? "{}")).toEqual({ theme: "galah-party", mode: "light" });
    });

    it("supports partial update and retains existing mode", () => {
      const { ctx, alexViewer, uow, alex } = setup();
      updatePreferences(
        { ...ctx, viewer: alexViewer },
        { theme: "fern-gully", mode: "dark" },
      );
      const partial = updatePreferences(
        { ...ctx, viewer: alexViewer },
        { theme: "black-opal" },
      );

      expect(partial).toEqual({ theme: "black-opal", mode: "dark" });
      const row = uow.state.preferences.find((p) => p.personId === alex);
      expect(row?.theme).toBe("black-opal");
      expect(row?.mode).toBe("dark");

      const audits = uow.state.audit.filter(
        (a) => a.entity === "person_preference" && a.entityId === alex,
      );
      expect(audits).toHaveLength(2);
      expect(JSON.parse(audits[1]?.before ?? "{}")).toEqual({ theme: "fern-gully", mode: "dark" });
      expect(JSON.parse(audits[1]?.after ?? "{}")).toEqual({ theme: "black-opal", mode: "dark" });
    });

    it("does not leak preferences across different persons", () => {
      const { ctx, alexViewer, carissaViewer } = setup();
      updatePreferences(
        { ...ctx, viewer: alexViewer },
        { theme: "galah-party", mode: "light" },
      );
      const carissaPrefs = getPreferences({ ...ctx, viewer: carissaViewer }, {});
      expect(carissaPrefs).toEqual({ theme: "clay-linen", mode: "system" });
    });

    it("rejects invalid theme with Validation error", () => {
      const { ctx, alexViewer } = setup();
      expect(() =>
        updatePreferences({ ...ctx, viewer: alexViewer }, { theme: "neon-pink" as any }),
      ).toThrow(AppError);
      try {
        updatePreferences({ ...ctx, viewer: alexViewer }, { theme: "neon-pink" as any });
      } catch (err) {
        expect((err as AppError).code).toBe("Validation");
      }
    });

    it("rejects invalid mode with Validation error", () => {
      const { ctx, alexViewer } = setup();
      expect(() =>
        updatePreferences({ ...ctx, viewer: alexViewer }, { mode: "sunset" as any }),
      ).toThrow(AppError);
      try {
        updatePreferences({ ...ctx, viewer: alexViewer }, { mode: "sunset" as any });
      } catch (err) {
        expect((err as AppError).code).toBe("Validation");
      }
    });

    it("throws Unauthenticated when viewer is not a person", () => {
      const { ctx } = setup();
      expect(() => updatePreferences(ctx, { theme: "clay-linen" })).toThrow(AppError);
      try {
        updatePreferences(ctx, { theme: "clay-linen" });
      } catch (err) {
        expect((err as AppError).code).toBe("Unauthenticated");
      }
    });
  });
});
