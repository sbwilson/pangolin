import { describe, expect, it } from "vitest";
import {
  fyToDateRange,
  isLastStep,
  localDay,
  quarterRange,
  rangeKind,
  rangeLabel,
  rangeUnit,
  stepRange,
} from "./date-range.ts";

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

  it("names the unit of a range: any aligned quarter, a whole FY or the current FY to date", () => {
    const today = "2026-10-24";
    expect(rangeUnit({ from: "2026-10-01", to: "2026-12-31" }, today)).toBe("quarter");
    expect(rangeUnit({ from: "2019-04-01", to: "2019-06-30" }, today)).toBe("quarter");
    expect(rangeUnit({ from: "2026-07-01", to: "2026-10-24" }, today)).toBe("fy");
    expect(rangeUnit({ from: "2024-07-01", to: "2025-06-30" }, today)).toBe("fy");
    // 1 July to some other day is FY to date only in the current FY, and only up to today.
    expect(rangeUnit({ from: "2026-07-01", to: "2026-10-23" }, today)).toBe("custom");
    expect(rangeUnit({ from: "2025-07-01", to: "2025-10-24" }, today)).toBe("custom");
    expect(rangeUnit({ from: "2026-10-02", to: "2026-12-31" }, today)).toBe("custom");
    expect(rangeUnit({ from: "2026-02-01", to: "2026-04-30" }, today)).toBe("custom");
  });

  it("steps a quarter by a quarter across years", () => {
    const today = "2026-10-24";
    const q = { from: "2026-01-01", to: "2026-03-31" };
    expect(stepRange(q, -1, today)).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(stepRange(q, 1, today)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(stepRange({ from: "2025-10-01", to: "2025-12-31" }, 1, today)).toEqual(q);
  });

  it("steps an FY by a full year, landing on the current FY to date", () => {
    const today = "2026-10-24";
    const current = { from: "2026-07-01", to: "2026-10-24" };
    expect(stepRange(current, -1, today)).toEqual({ from: "2025-07-01", to: "2026-06-30" });
    expect(stepRange({ from: "2025-07-01", to: "2026-06-30" }, 1, today)).toEqual(current);
    expect(stepRange({ from: "2024-07-01", to: "2025-06-30" }, -1, today)).toEqual({
      from: "2023-07-01",
      to: "2024-06-30",
    });
  });

  it("steps a custom range by its length in days", () => {
    const today = "2026-10-24";
    expect(stepRange({ from: "2026-02-03", to: "2026-03-14" }, 1, today)).toEqual({
      from: "2026-03-15",
      to: "2026-04-23",
    });
    expect(stepRange({ from: "2026-03-01", to: "2026-03-01" }, -1, today)).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
    expect(stepRange({ from: "2024-02-28", to: "2024-03-01" }, -1, today)).toEqual({
      from: "2024-02-25",
      to: "2024-02-27",
    });
  });

  it("stops the next step when it would start after today", () => {
    const today = "2026-10-24";
    expect(isLastStep({ from: "2026-10-01", to: "2026-12-31" }, today)).toBe(true);
    expect(isLastStep({ from: "2026-07-01", to: "2026-09-30" }, today)).toBe(false);
    expect(isLastStep({ from: "2026-07-01", to: "2026-10-24" }, today)).toBe(true);
    expect(isLastStep({ from: "2025-07-01", to: "2026-06-30" }, today)).toBe(false);
    expect(isLastStep({ from: "2026-10-15", to: "2026-10-24" }, today)).toBe(true);
    expect(isLastStep({ from: "2026-10-05", to: "2026-10-14" }, today)).toBe(false);
    // A range ending yesterday may still step on to one that starts today.
    expect(isLastStep({ from: "2026-10-14", to: "2026-10-23" }, today)).toBe(false);
  });

  it("labels a quarter, an FY and a custom range", () => {
    const today = "2026-10-24";
    expect(rangeLabel({ from: "2026-07-01", to: "2026-09-30" }, today)).toBe("Jul – Sep 2026");
    expect(rangeLabel({ from: "2026-02-03", to: "2026-03-14" }, today)).toBe("3 Feb – 14 Mar 2026");
    expect(rangeLabel({ from: "2025-12-03", to: "2026-01-14" }, today)).toBe(
      "3 Dec 2025 – 14 Jan 2026",
    );
    expect(rangeLabel({ from: "2026-02-03", to: "2026-02-03" }, today)).toBe("3 Feb 2026");
    expect(rangeLabel({ from: "2025-07-01", to: "2026-06-30" }, today)).toBe("FY2026");
    expect(rangeLabel({ from: "2026-07-01", to: "2026-10-24" }, today)).toBe("FY2027 to date");
  });
});
