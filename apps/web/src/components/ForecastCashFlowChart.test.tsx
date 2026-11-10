import { describe, expect, it } from "vitest";
import type { ForecastAccountData, ForecastDipData } from "../api.ts";
import { buildForecastChartOption, shortDayLabel } from "./ForecastCashFlowChart.tsx";

const account = (id: string, name: string, thresholdCents: number): ForecastAccountData => ({
  accountId: id,
  name,
  lowBalanceThresholdCents: thresholdCents,
  points: [
    { date: "2026-07-15", balanceCents: 620_000 },
    { date: "2026-07-16", balanceCents: 580_000 },
    { date: "2026-07-17", balanceCents: 610_000 },
  ],
});

const dip: ForecastDipData = {
  accountId: "acc-1",
  accountName: "Joint everyday",
  cents: 580_000,
  date: "2026-07-16",
};

/** Minimal shape access: the option's `series` is a union in echarts' types. */
interface SeriesLike {
  type: string;
  name?: string;
  data?: unknown[];
  lineStyle?: Record<string, unknown>;
}

function seriesOf(option: ReturnType<typeof buildForecastChartOption>): SeriesLike[] {
  return option.series as SeriesLike[];
}

describe("shortDayLabel", () => {
  it("renders a day-of-month and short month", () => {
    expect(shortDayLabel("2026-07-15")).toBe("15 Jul");
    expect(shortDayLabel("2027-01-01")).toBe("1 Jan");
    expect(shortDayLabel("2026-12-31")).toBe("31 Dec");
  });
});

describe("buildForecastChartOption", () => {
  it("draws one dashed line per projected account", () => {
    const option = buildForecastChartOption({
      accounts: [account("acc-1", "Joint everyday", 0), account("acc-2", "Other", 0)],
      warnings: [],
    });
    const lines = seriesOf(option).filter((s) => s.type === "line");
    expect(lines.map((s) => s.name)).toEqual(["Joint everyday", "Other"]);
    for (const line of lines) expect(line.lineStyle?.["type"]).toBe("dashed");
    expect(lines[0]!.data).toEqual([
      ["2026-07-15", 620_000],
      ["2026-07-16", 580_000],
      ["2026-07-17", 610_000],
    ]);
    expect(option.xAxis).toMatchObject({ type: "category" });
  });

  it("adds a threshold line and a dip dot for each warned account only", () => {
    const option = buildForecastChartOption({
      accounts: [account("acc-1", "Joint everyday", 600_000), account("acc-2", "Other", 0)],
      warnings: [dip],
    });
    const series = seriesOf(option);
    const threshold = series.find((s) => s.name === "Joint everyday threshold");
    const dot = series.find((s) => s.name === "Joint everyday dip");
    expect(threshold).toBeDefined();
    expect(threshold!.type).toBe("line");
    expect(threshold!.data).toEqual([
      ["2026-07-15", 600_000],
      ["2026-07-16", 600_000],
      ["2026-07-17", 600_000],
    ]);
    expect(dot).toBeDefined();
    expect(dot!.type).toBe("scatter");
    expect(dot!.data).toEqual([[1, 580_000]]); // date index of 2026-07-16
    // The un-warned account gets no extra series.
    expect(series.filter((s) => s.name?.startsWith("Other"))).toHaveLength(1);
  });

  it("tolerates an empty projection", () => {
    const option = buildForecastChartOption({ accounts: [], warnings: [] });
    expect(seriesOf(option)).toEqual([]);
    expect((option.xAxis as { data?: string[] }).data).toEqual([]);
  });
});
