import * as echarts from "echarts";
import { useEffect, useRef } from "react";
import type { ForecastAccountData, ForecastDipData } from "../api.ts";
import { formatCents } from "../lib/money.ts";

/** One palette entry per projected account; thresholds reuse their account's colour. */
const ACCOUNT_COLORS = ["#A3441D", "#2563eb", "#0E7C7B", "#7C3AED", "#B45309", "#BE185D"];
const DIP_COLOR = "#D14343";

/** `2026-07-15` -> `15 Jul`, for sparse daily axis labels. */
export function shortDayLabel(isoDay: string): string {
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][Number(isoDay.slice(5, 7)) - 1];
  return `${Number(isoDay.slice(8, 10))} ${month ?? ""}`.trim();
}

export interface ForecastChartOptionInput {
  readonly accounts: readonly ForecastAccountData[];
  readonly warnings: readonly ForecastDipData[];
}

/**
 * The echarts option for the projection: one dashed line per account, and for every warned
 * account a faint threshold line plus a red dot at the dip. Pure, so the series structure is
 * testable without a canvas.
 */
export function buildForecastChartOption(input: ForecastChartOptionInput): echarts.EChartsOption {
  const dates = input.accounts[0]?.points.map((p) => p.date) ?? [];
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const colorByAccount = new Map(
    input.accounts.map((a, i) => [
      a.accountId,
      ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] ?? "#A3441D",
    ]),
  );

  const series: echarts.SeriesOption[] = input.accounts.map((account, i) => {
    const color = ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] ?? "#A3441D";
    return {
      type: "line",
      name: account.name,
      data: account.points.map((p) => [p.date, p.balanceCents]),
      showSymbol: false,
      smooth: false,
      lineStyle: { type: "dashed", color, width: 2 },
      itemStyle: { color },
    };
  });

  for (const warning of input.warnings) {
    const account = input.accounts.find((a) => a.accountId === warning.accountId);
    if (account === undefined) continue;
    const color = colorByAccount.get(warning.accountId) ?? "#A3441D";
    series.push({
      type: "line",
      name: `${warning.accountName} threshold`,
      data: dates.map((d) => [d, account.lowBalanceThresholdCents]),
      showSymbol: false,
      silent: true,
      lineStyle: { type: "solid", color, width: 1, opacity: 0.45 },
    });
    series.push({
      type: "scatter",
      name: `${warning.accountName} dip`,
      data: [[dateIndex.get(warning.date) ?? 0, warning.cents]],
      symbolSize: 10,
      itemStyle: { color: DIP_COLOR },
    });
  }

  return {
    grid: { top: 20, right: 20, bottom: 30, left: 60, containLabel: false },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? formatCents(value) : String(value ?? ""),
    },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: "var(--border, #E3D6C5)" } },
      axisLabel: {
        color: "var(--muted-foreground, #6A594B)",
        fontSize: 11,
        interval: (index: number) => index % 14 === 0,
        formatter: (value: string) => shortDayLabel(value),
      },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "var(--border, #E3D6C5)", width: 1 } },
      axisLabel: {
        color: "var(--muted-foreground, #6A594B)",
        fontSize: 11,
        formatter: (value: number) => {
          const dollars = value / 100;
          const sign = dollars < 0 ? "-" : "";
          const abs = Math.abs(dollars);
          if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
          if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
          return `${sign}$${abs}`;
        },
      },
    },
    series,
  };
}

export interface ForecastCashFlowChartProps {
  readonly accounts: readonly ForecastAccountData[];
  readonly warnings: readonly ForecastDipData[];
  readonly horizonMonths: number;
}

/** The projection canvas. jsdom has no canvas, so init is skipped there, as in the net-worth chart. */
export function ForecastCashFlowChart({
  accounts,
  warnings,
  horizonMonths,
}: ForecastCashFlowChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current || accounts.length === 0) return;

    const testCanvas = document.createElement("canvas");
    let hasCanvas = false;
    try {
      hasCanvas = Boolean(testCanvas.getContext?.("2d"));
    } catch {
      hasCanvas = false;
    }
    if (!hasCanvas) return;

    let handleResize: (() => void) | undefined;
    try {
      const width = containerRef.current.clientWidth || 800;
      const height = containerRef.current.clientHeight || 280;
      if (!chartInstanceRef.current || chartInstanceRef.current.isDisposed()) {
        chartInstanceRef.current = echarts.init(containerRef.current, null, {
          renderer: "canvas",
          width,
          height,
        });
      }
      chartInstanceRef.current.setOption(buildForecastChartOption({ accounts, warnings }), true);
      handleResize = () => chartInstanceRef.current?.resize();
      window.addEventListener("resize", handleResize);
    } catch {
      // Ignore canvas errors in unsupported environments
    }

    return () => {
      if (handleResize) window.removeEventListener("resize", handleResize);
    };
  }, [accounts, warnings]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  const names = accounts.map((a) => a.name).join(", ");
  return (
    <div
      ref={containerRef}
      className="h-72 w-full"
      role="img"
      aria-label={`Projected balance over the next ${horizonMonths} months for ${names}`}
      data-testid="forecast-chart"
    />
  );
}
