import { describe, expect, it } from "vitest";
import { fyToDateRange, localDay, quarterRange, rangeKind } from "./date-range.ts";

describe("date ranges", () => {
  it("finds the quarter that holds a day, with its real last day", () => {
    expect(quarterRange("2026-10-07")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(quarterRange("2026-02-28")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(quarterRange("2026-06-30")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(quarterRange("2026-09-01")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("starts the financial year on 1 July and runs to the day", () => {
    expect(fyToDateRange("2026-10-07")).toEqual({ from: "2026-07-01", to: "2026-10-07" });
    expect(fyToDateRange("2026-07-01")).toEqual({ from: "2026-07-01", to: "2026-07-01" });
    expect(fyToDateRange("2027-03-15")).toEqual({ from: "2026-07-01", to: "2027-03-15" });
    expect(fyToDateRange("2026-06-30")).toEqual({ from: "2025-07-01", to: "2026-06-30" });
  });

  it("says which range the URL's dates are", () => {
    const today = "2026-10-07";
    expect(rangeKind(undefined, undefined, today)).toBe("none");
    expect(rangeKind("2026-10-01", "2026-12-31", today)).toBe("quarter");
    expect(rangeKind("2026-07-01", "2026-10-07", today)).toBe("fy");
    expect(rangeKind("2026-07-01", undefined, today)).toBe("custom");
    expect(rangeKind("2026-10-01", "2026-12-30", today)).toBe("custom");
  });

  it("reads a local calendar day", () => {
    expect(localDay(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07");
    expect(localDay(new Date(2026, 0, 2))).toBe("2026-01-02");
  });
});
