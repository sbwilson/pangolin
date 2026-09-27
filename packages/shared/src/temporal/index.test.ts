import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDate, parseDate, plainDateSchema, Temporal } from "./index.ts";

describe("shared/temporal", () => {
  it("exposes a working Temporal", () => {
    const date = Temporal.PlainDate.from({ year: 2026, month: 2, day: 28 });
    expect(date.add({ days: 1 }).toString()).toBe("2026-03-01");
  });

  it("parses YYYY-MM-DD strictly", () => {
    const date = parseDate("2024-02-29");
    expect([date.year, date.month, date.day]).toEqual([2024, 2, 29]);
  });

  it.each([
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-2-3",
    "2026-02-03T00:00",
    "20260203",
    "+002026-02-03",
    " 2026-02-03",
    "",
  ])("rejects %j", (value) => {
    expect(() => parseDate(value)).toThrow(RangeError);
  });

  it("formats as YYYY-MM-DD and round-trips", () => {
    expect(formatDate(Temporal.PlainDate.from({ year: 2026, month: 7, day: 2 }))).toBe(
      "2026-07-02",
    );
    expect(formatDate(parseDate("0999-01-01"))).toBe("0999-01-01");
  });

  it("refuses to format a year with no four-digit form", () => {
    expect(() => formatDate(Temporal.PlainDate.from({ year: 10000, month: 1, day: 1 }))).toThrow(
      RangeError,
    );
  });

  it("plainDateSchema turns a wire string into a PlainDate", () => {
    const date = plainDateSchema.parse("2026-07-02");
    expect(date.equals(Temporal.PlainDate.from("2026-07-02"))).toBe(true);
    expect(plainDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(plainDateSchema.safeParse(20260702).success).toBe(false);
  });
});

describe("Temporal selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses the native global Temporal when present", async () => {
    const sentinel = { native: true };
    vi.stubGlobal("Temporal", sentinel);
    vi.resetModules();
    const fresh = await import("./index.ts");
    expect(fresh.Temporal).toBe(sentinel);
  });

  it("falls back to temporal-polyfill without the global", async () => {
    vi.stubGlobal("Temporal", undefined);
    vi.resetModules();
    const fresh = await import("./index.ts");
    expect(fresh.Temporal).toBe(TemporalPolyfill);
  });
});
