import { describe, expect, it } from "vitest";
import type { ForecastNetWorthLine, ForecastNetWorthReport } from "../api.ts";
import { buildNetWorthChartOption, monthYearLabel } from "./ForecastNetWorthChart.tsx";

function line(returnBps: number, start: number, step: number): ForecastNetWorthLine {
  return {
    returnBps,
    annualReturnPercent: String(returnBps / 100),
    points: Array.from({ length: 25 }, (_, month) => {
      const d = new Date(Date.UTC(2026, 10, 14));
      d.setUTCMonth(d.getUTCMonth() + month);
      return { month, date: d.toISOString().slice(0, 10), netWorthCents: start + month * step };
    }),
  };
}

const report: ForecastNetWorthReport = {
  asOf: "2026-11-14",
  horizonYears: 2,
  lines: {
    low: line(300, 33_320_534, 300_000),
    mid: line(500, 33_320_534, 400_000),
    high: line(700, 33_320_534, 500_000),
  },
};

/** Minimal shape access: the option's `series` is a union in echarts' types. */
interface SeriesLike {
  type: string;
  name?: string;
  data?: unknown[];
  lineStyle?: Record<string, unknown>;
  endLabel?: { show?: boolean; formatter?: () => string };
}

function seriesOf(option: ReturnType<typeof buildNetWorthChartOption>): SeriesLike[] {
  return option.series as SeriesLike[];
}

describe("monthYearLabel", () => {
  it("renders a short month and year", () => {
    expect(monthYearLabel("2027-04-14")).toBe("Apr 2027");
    expect(monthYearLabel("2026-12-01")).toBe("Dec 2026");
  });
});

describe("buildNetWorthChartOption", () => {
  it("draws the three named lines with mid bold and primary, low and high muted", () => {
    const lines = seriesOf(buildNetWorthChartOption(report)).filter((s) => s.type === "line");
    expect(lines.map((s) => s.name)).toEqual(["Low", "Mid", "High"]);
    expect(lines[1]?.lineStyle?.["width"]).toBe(2.5);
    expect(lines[1]?.lineStyle?.["color"]).toBe("#A3441D");
    expect(lines[0]?.lineStyle?.["width"]).toBe(1.5);
    expect(lines[2]?.lineStyle?.["width"]).toBe(1.5);
    expect(lines[0]?.lineStyle?.["color"]).toBe("#6A594B");
    expect(lines[2]?.lineStyle?.["color"]).toBe("#6A594B");
  });

  it("plots every monthly point, with today at index 0 on all three lines", () => {
    const lines = seriesOf(buildNetWorthChartOption(report));
    expect(lines[1]?.data).toHaveLength(25);
    for (const line of lines) expect(line.data?.[0]).toBe(33_320_534);
    expect(lines[1]?.data?.[1]).toBe(33_720_534);
  });

  it("labels point 0 Today, then every sixth month", () => {
    const option = buildNetWorthChartOption(report);
    const xAxis = option.xAxis as {
      type: string;
      data: string[];
      axisLabel: {
        interval: (index: number) => boolean;
        formatter: (value: string, index: number) => string;
      };
    };
    expect(xAxis.type).toBe("category");
    expect(xAxis.data[0]).toBe("2026-11-14");
    const { interval, formatter } = xAxis.axisLabel;
    expect(interval(0)).toBe(true);
    expect(interval(6)).toBe(true);
    expect(interval(12)).toBe(true);
    expect(interval(1)).toBe(false);
    expect(formatter("2026-11-14", 0)).toBe("Today");
    expect(formatter("2027-05-14", 6)).toBe("May 2027");
  });

  it("shows the date and each line's value in the tooltip", () => {
    const tooltip = buildNetWorthChartOption(report).tooltip as {
      formatter: (params: unknown) => string;
    };
    const text = tooltip.formatter([
      { seriesName: "Low", dataIndex: 2, value: 33_920_534, marker: "M" },
      { seriesName: "Mid", dataIndex: 2, value: 34_120_534, marker: "M" },
      { seriesName: "High", dataIndex: 2, value: 34_320_534, marker: "M" },
    ]);
    const d = new Date(Date.UTC(2026, 10, 14));
    d.setUTCMonth(d.getUTCMonth() + 2);
    expect(text).toContain(d.toISOString().slice(0, 10));
    expect(text).toContain("Low: <b>$339,205</b>");
    expect(text).toContain("Mid: <b>$341,205</b>");
    expect(text).toContain("High: <b>$343,205</b>");
  });

  it("names each line at its end, so the two muted lines stay distinguishable", () => {
    const lines = seriesOf(buildNetWorthChartOption(report));
    const labels = lines.map((s) => s.endLabel?.formatter?.());
    expect(labels).toEqual(["Low $405,205", "Mid $429,205", "High $453,205"]);
    for (const line of lines) expect(line.endLabel?.show).toBe(true);
  });
});
