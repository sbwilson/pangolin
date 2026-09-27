import { formatDate, parseDate, Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { fixedClock, fixedClockAt, systemClock } from "./clock.ts";

describe("fixedClock", () => {
  it("returns the given date and instant", () => {
    const instant = Temporal.Instant.from("2026-07-01T23:30:00Z");
    const clock = fixedClock(parseDate("2026-07-02"), instant);
    expect(formatDate(clock.today())).toBe("2026-07-02");
    expect(clock.now().toString()).toBe("2026-07-01T23:30:00Z");
  });

  it("defaults now() to midnight UTC on the date", () => {
    const clock = fixedClock(parseDate("2026-07-02"));
    expect(clock.now().toString()).toBe("2026-07-02T00:00:00Z");
  });
});

describe("fixedClockAt", () => {
  it("stops at midnight UTC on the given date", () => {
    const clock = fixedClockAt("2026-07-15");
    expect(formatDate(clock.today())).toBe("2026-07-15");
    expect(clock.now().toString()).toBe("2026-07-15T00:00:00Z");
  });

  it("rejects a date that does not exist", () => {
    expect(() => fixedClockAt("2026-02-30")).toThrow(RangeError);
  });
});

describe("systemClock", () => {
  const at = (iso: string) => () => Temporal.Instant.from(iso);

  it("takes today in the household time zone", () => {
    // 15:00 UTC on 30 June is 01:00 on 1 July in Brisbane (UTC+10, no DST).
    const clock = systemClock("Australia/Brisbane", at("2026-06-30T15:00:00Z"));
    expect(formatDate(clock.today())).toBe("2026-07-01");
    expect(clock.now().toString()).toBe("2026-06-30T15:00:00Z");
    expect(formatDate(systemClock("UTC", at("2026-06-30T15:00:00Z")).today())).toBe("2026-06-30");
  });

  it("follows daylight saving", () => {
    // Sydney is UTC+11 in January: 13:30 UTC on 31 Dec is 00:30 on 1 Jan.
    const clock = systemClock("Australia/Sydney", at("2025-12-31T13:30:00Z"));
    expect(formatDate(clock.today())).toBe("2026-01-01");
  });

  it("rejects an unknown time zone", () => {
    expect(() => systemClock("Not/A_Zone", at("2026-01-01T00:00:00Z"))).toThrow(RangeError);
  });
});
