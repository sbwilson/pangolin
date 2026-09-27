import { idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import * as root from "./index.ts";
import { systemViewer } from "./system-viewer.ts";
import { actorOf, personViewer, type SystemActor, type SystemViewer } from "./viewer.ts";

const personId = idSchema("Person").parse("01J0000000000000000000000A");
const authAt = Temporal.Instant.from("2026-09-27T00:00:00Z");

describe("personViewer", () => {
  it("builds a frozen person viewer audited as person:<id>", () => {
    const viewer = personViewer(personId, authAt);
    expect(viewer).toEqual({ kind: "person", personId, authAt });
    expect(Object.isFrozen(viewer)).toBe(true);
    expect(actorOf(viewer)).toBe(`person:${personId}`);
  });

  it("requires authAt to be an Instant", () => {
    expect(() => personViewer(personId, "2026-09-27T00:00:00Z" as never)).toThrow(TypeError);
  });
});

describe("systemViewer", () => {
  it.each(["job:period-close", "cli:reset-user", "job:x1"] as const)("accepts %s", (actor) => {
    const viewer = systemViewer(actor);
    expect(viewer).toEqual({ kind: "system", actor });
    expect(actorOf(viewer)).toBe(actor);
  });

  it.each(["job:", "cli:", "admin:x", "job:Period", "job:a b", "job:a:b", "person:1", " job:x"])(
    "rejects %j",
    (actor) => {
      expect(() => systemViewer(actor as SystemActor)).toThrow(TypeError);
    },
  );

  it("cannot be built as an object literal", () => {
    // @ts-expect-error: SystemViewer is branded, so only the factory can build one.
    const literal: SystemViewer = { kind: "system", actor: "job:x" };
    expect(literal.kind).toBe("system");
  });

  it("is not exported from the package root", () => {
    expect(Object.keys(root)).not.toContain("systemViewer");
    expect(Object.keys(root)).toContain("personViewer");
  });
});
