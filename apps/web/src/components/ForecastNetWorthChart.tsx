import * as echarts from "echarts";
import { useEffect, useRef } from "react";
import type { ForecastNetWorthLine, ForecastNetWorthReport } from "../api.ts";
import { formatWholeDollars } from "../lib/money.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2027-04-15` -> `Apr 2027`, for sparse monthly axis labels. */
export function monthYearLabel(isoDay: string): string {
  const month = MONTHS[Number(isoDay.slice(5, 7)) - 1];
  return `${month ?? ""} ${isoDay.slice(0, 4)}`.trim();
}

/** DESIGN § Forecast chart: mid in `{colors.primary}` bold, low and high muted. The canvas
 * renderer never resolves CSS variables, so read the tokens as `sankey-layout.ts` does. */
function getPrimaryColor(): string {
  if (typeof window !== "undefined") {
    const val = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    if (val) return val;
  }
  return "#A3441D";
}

function getMutedForegroundColor(): string {
  if (typeof window !== "undefined") {
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue("--muted-foreground")
      .trim();
    if (val) return val;
  }
  return "#6A594B";
}

const lastCents = (line: ForecastNetWorthLine): number =>
  line.points[line.points.length - 1]?.netWorthCents ?? 0;

function lineSeries(
  name: string,
  line: ForecastNetWorthLine,
  color: string,
  width: number,
): echarts.SeriesOption {
  const endLabel = `${name} ${formatWholeDollars(lastCents(line))}`;
  return {
    type: "line",
    name,
    data: line.points.map((p) => p.netWorthCents),
    showSymbol: false,
    smooth: false,
    lineStyle: { color, width },
    itemStyle: { color },
    // Low and high share a colour, so each line names itself at its end.
    endLabel: { show: true, color, fontSize: 11, formatter: () => endLabel },
  };
}

/**
 * The echarts option for the net-worth projection: low/mid/high monthly lines over one
 * category axis. Point 0 is today on all three. Pure, so the series structure is testable
 * without a canvas.
 */
export function buildNetWorthChartOption(report: ForecastNetWorthReport): echarts.EChartsOption {
  const dates = report.lines.mid.points.map((p) => p.date);

  return {
    grid: { top: 20, right: 90, bottom: 30, left: 60, containLabel: false },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const items = Array.isArray(params) ? params : [params];
        const first = items[0] as { dataIndex?: number } | undefined;
        const date = dates[first?.dataIndex ?? -1];
        if (date === undefined) return "";
        const rows = (items as { marker?: string; seriesName?: string; value?: unknown }[])
          .map(
            (item) =>
              `${item.marker ?? ""}${item.seriesName ?? ""}: <b>${formatWholeDollars(Number(item.value ?? 0))}</b>`,
          )
          .join("<br/>");
        return `${date}<br/>${rows}`;
      },
    },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: "var(--border, #E3D6C5)" } },
      axisLabel: {
        color: "var(--muted-foreground, #6A594B)",
        fontSize: 11,
        interval: (index: number) => index === 0 || index % 6 === 0,
        formatter: (value: string, index: number) =>
          index === 0 ? "Today" : monthYearLabel(value),
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
    series: [
      lineSeries("Low", report.lines.low, getMutedForegroundColor(), 1.5),
      lineSeries("Mid", report.lines.mid, getPrimaryColor(), 2.5),
      lineSeries("High", report.lines.high, getMutedForegroundColor(), 1.5),
    ],
  };
}

export interface ForecastNetWorthChartProps {
  readonly report: ForecastNetWorthReport;
  readonly years: number;
}

/** The projection canvas. jsdom has no canvas, so init is skipped there, as in the other charts. */
export function ForecastNetWorthChart({ report, years }: ForecastNetWorthChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

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
      chartInstanceRef.current.setOption(buildNetWorthChartOption(report), true);
      handleResize = () => chartInstanceRef.current?.resize();
      window.addEventListener("resize", handleResize);
    } catch {
      // Ignore canvas errors in unsupported environments
    }

    return () => {
      if (handleResize) window.removeEventListener("resize", handleResize);
    };
  }, [report]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  const label = `Net worth in ${years} ${years === 1 ? "year" : "years"}: low ${formatWholeDollars(
    lastCents(report.lines.low),
  )}, mid ${formatWholeDollars(lastCents(report.lines.mid))}, high ${formatWholeDollars(
    lastCents(report.lines.high),
  )}`;
  return (
    <div
      ref={containerRef}
      className="h-72 w-full"
      role="img"
      aria-label={label}
      data-testid="forecast-networth-chart"
    />
  );
}
