import { describe, expect, it } from "vitest";
import { formatDate, parseDate } from "../temporal/index.ts";
import {
  type Cadence,
  fyOf,
  fyRange,
  nextPeriod,
  type Period,
  periodContaining,
  previousPeriod,
} from "./index.ts";

const d = parseDate;
const show = (p: Period) => [formatDate(p.start), formatDate(p.end)];

describe("financial years", () => {
  it.each(["2024-07-01", "2024-12-31", "2025-01-01", "2025-06-30"])("%s is FY2025", (date) => {
    const fy = fyOf(d(date));
    expect(fy.label).toBe("FY2025");
    expect(show(fy)).toEqual(["2024-07-01", "2025-07-01"]);
  });

  it("the day either side belongs to the neighbouring FY", () => {
    expect(fyOf(d("2024-06-30")).label).toBe("FY2024");
    expect(fyOf(d("2025-07-01")).label).toBe("FY2026");
  });

  it("fyRange labels by the ending year", () => {
    const fy = fyRange(2025);
    expect(fy.label).toBe("FY2025");
    expect(show(fy)).toEqual(["2024-07-01", "2025-07-01"]);
    // Inclusive on screen: the last day is the day before `end`.
    expect(formatDate(fy.end.subtract({ days: 1 }))).toBe("2025-06-30");
    expect(() => fyRange(2025.5)).toThrow(RangeError);
  });
});

describe("monthly cadence", () => {
  const day31: Cadence = { kind: "monthly", day: 31 };

  it("clamps the boundary to the last day of February", () => {
    const period = periodContaining(day31, d("2026-02-15"));
    expect(show(period)).toEqual(["2026-01-31", "2026-02-28"]);
    expect(show(nextPeriod(day31, period))).toEqual(["2026-02-28", "2026-03-31"]);
    expect(show(previousPeriod(day31, period))).toEqual(["2025-12-31", "2026-01-31"]);
  });

  it("starts on a leap day in a leap year", () => {
    expect(show(periodContaining(day31, d("2024-02-29")))).toEqual(["2024-02-29", "2024-03-31"]);
    expect(show(periodContaining(day31, d("2024-02-28")))).toEqual(["2024-01-31", "2024-02-29"]);
  });

  it("the boundary day starts a new period", () => {
    const day15: Cadence = { kind: "monthly", day: 15 };
    expect(show(periodContaining(day15, d("2026-03-15")))).toEqual(["2026-03-15", "2026-04-15"]);
    expect(show(periodContaining(day15, d("2026-03-14")))).toEqual(["2026-02-15", "2026-03-15"]);
  });

  it("day 1 gives calendar months, across a year end", () => {
    const day1: Cadence = { kind: "monthly", day: 1 };
    expect(show(periodContaining(day1, d("2025-12-31")))).toEqual(["2025-12-01", "2026-01-01"]);
    expect(show(periodContaining(day1, d("2026-01-01")))).toEqual(["2026-01-01", "2026-02-01"]);
  });

  it("day 30 clamps in February and recovers in March", () => {
    const day30: Cadence = { kind: "monthly", day: 30 };
    expect(show(periodContaining(day30, d("2026-03-01")))).toEqual(["2026-02-28", "2026-03-30"]);
  });

  it("walks a year of periods contiguously", () => {
    let period = periodContaining(day31, d("2026-01-01"));
    for (let i = 0; i < 24; i++) {
      const next = nextPeriod(day31, period);
      expect(next.start.equals(period.end)).toBe(true);
      expect(show(previousPeriod(day31, next))).toEqual(show(period));
      period = next;
    }
  });

  it.each([0, 32, -1, 1.5, Number.NaN])("rejects day %s", (day) => {
    expect(() => periodContaining({ kind: "monthly", day }, d("2026-01-01"))).toThrow(RangeError);
  });
});

describe("fortnightly cadence", () => {
  const cadence: Cadence = { kind: "fortnightly", anchor: d("2026-07-02") };

  it.each([
    ["2026-07-02", "2026-07-02", "2026-07-16"],
    ["2026-07-15", "2026-07-02", "2026-07-16"],
    ["2026-07-16", "2026-07-16", "2026-07-30"],
    ["2026-07-01", "2026-06-18", "2026-07-02"],
    ["2026-06-18", "2026-06-18", "2026-07-02"],
    ["2025-01-01", "2024-12-19", "2025-01-02"],
    ["2025-01-02", "2025-01-02", "2025-01-16"],
  ])("%s falls in [%s, %s)", (date, start, end) => {
    expect(show(periodContaining(cadence, d(date)))).toEqual([start, end]);
  });

  it("steps forward and back by 14 days", () => {
    const period = periodContaining(cadence, d("2026-07-10"));
    expect(show(nextPeriod(cadence, period))).toEqual(["2026-07-16", "2026-07-30"]);
    expect(show(previousPeriod(cadence, period))).toEqual(["2026-06-18", "2026-07-02"]);
  });
});
