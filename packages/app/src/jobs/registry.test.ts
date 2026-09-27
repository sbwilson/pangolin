import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  backoffMs,
  DEFAULT_RETRY,
  defineJobKind,
  defineSchedule,
  scheduleKey,
} from "./registry.ts";

const spec = {
  kind: "test-kind",
  schema: z.object({ n: z.number() }),
  lane: "net" as const,
  externalEffects: true,
  needsPersonWhenDead: false,
};

describe("defineJobKind", () => {
  it("fills in the default retry policy and freezes the kind", () => {
    const kind = defineJobKind(spec);
    expect(kind.retry).toEqual(DEFAULT_RETRY);
    expect(Object.isFrozen(kind)).toBe(true);
    expect(defineJobKind({ ...spec, retry: { maxAttempts: 2 } }).retry.maxAttempts).toBe(2);
  });

  it.each([
    [{ ...spec, kind: "Bad.Kind" }],
    [{ ...spec, kind: "" }],
    [{ ...spec, lane: "gpu" }],
    [{ ...spec, retry: { maxAttempts: 0 } }],
    [{ ...spec, retry: { baseDelayMs: -1 } }],
    [{ ...spec, retry: { maxDelayMs: 1.5 } }],
  ])("rejects %j", (bad) => {
    expect(() => defineJobKind(bad as never)).toThrow(TypeError);
  });
});

describe("backoffMs", () => {
  it("doubles from the base and stops at the maximum", () => {
    const retry = { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 5000 };
    expect([1, 2, 3, 4, 5].map((n) => backoffMs(retry, n))).toEqual([1000, 2000, 4000, 5000, 5000]);
  });
});

describe("defineSchedule", () => {
  const kind = defineJobKind(spec);
  const next = (after: Temporal.Instant) => after.add({ hours: 1 });

  it("keeps the schedule and names its dedupe key", () => {
    const schedule = defineSchedule({ name: "hourly", kind, payload: { n: 1 }, next });
    expect(schedule.name).toBe("hourly");
    expect(scheduleKey("hourly")).toBe("schedule:hourly");
  });

  it("rejects a bad name or a payload that fails the kind's schema", () => {
    expect(() => defineSchedule({ name: "Hourly!", kind, payload: { n: 1 }, next })).toThrow(
      TypeError,
    );
    expect(() =>
      defineSchedule({ name: "hourly", kind, payload: { n: "x" } as never, next }),
    ).toThrow(TypeError);
  });

  it("accepts any instant function", () => {
    const schedule = defineSchedule({ name: "hourly", kind, payload: { n: 1 }, next });
    expect(schedule.next(Temporal.Instant.from("2026-01-01T00:00:00Z")).toString()).toBe(
      "2026-01-01T01:00:00Z",
    );
  });
});
