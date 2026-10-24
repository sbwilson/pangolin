import * as echarts from "echarts";
import { useEffect, useMemo, useRef } from "react";
import type { NetWorthTrendPoint } from "../api.ts";
import { formatCents } from "../lib/money.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthAbbrFromDate(day: string): string {
  return MONTHS[Number(day.slice(5, 7)) - 1] ?? "";
}

export interface NetWorthTrendChartProps {
  readonly trend: readonly NetWorthTrendPoint[];
  readonly today: string;
}

export function NetWorthTrendChart({ trend, today }: NetWorthTrendChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  const minCents = useMemo(
    () => (trend.length > 0 ? Math.min(...trend.map((p) => p.netWorthCents)) : 0),
    [trend],
  );
  const maxCents = useMemo(
    () => (trend.length > 0 ? Math.max(...trend.map((p) => p.netWorthCents)) : 0),
    [trend],
  );

  useEffect(() => {
    if (!containerRef.current || trend.length === 0) return;

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
      const height = containerRef.current.clientHeight || 240;

      if (!chartInstanceRef.current || chartInstanceRef.current.isDisposed()) {
        chartInstanceRef.current = echarts.init(containerRef.current, null, {
          renderer: "canvas",
          width,
          height,
        });
      }
      const chart = chartInstanceRef.current;

      const xLabels = trend.map((p, idx) =>
        idx === trend.length - 1 && p.date === today ? "Today" : monthAbbrFromDate(p.date),
      );
      const dataValues = trend.map((p) => p.netWorthCents);

      const option: echarts.EChartsOption = {
        grid: {
          top: 20,
          right: 20,
          bottom: 30,
          left: 60,
          containLabel: false,
        },
        tooltip: {
          trigger: "axis",
          formatter: (params: unknown) => {
            const item = Array.isArray(params) ? params[0] : params;
            if (!item) return "";
            const p = trend[item.dataIndex as number];
            if (!p) return "";
            return `${p.date}<br/>Net worth: <b>${formatCents(p.netWorthCents)}</b><br/>Assets: ${formatCents(p.assetsCents)}<br/>Liabilities: ${formatCents(p.liabilitiesCents)}`;
          },
        },
        xAxis: {
          type: "category",
          data: xLabels,
          boundaryGap: false,
          axisLine: { lineStyle: { color: "var(--border, #E3D6C5)" } },
          axisLabel: { color: "var(--muted-foreground, #6A594B)", fontSize: 11 },
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
              if (abs >= 1_000_000) {
                return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
              }
              if (abs >= 1_000) {
                return `${sign}$${Math.round(abs / 1_000)}k`;
              }
              return `${sign}$${abs}`;
            },
          },
        },
        series: [
          {
            type: "line",
            data: dataValues,
            smooth: false,
            showSymbol: true,
            symbol: "circle",
            symbolSize: 6,
            lineStyle: {
              color: "#A3441D",
              width: 2.5,
            },
            itemStyle: {
              color: "#A3441D",
            },
          },
        ],
      };

      chart.setOption(option, true);

      handleResize = () => chart.resize();
      window.addEventListener("resize", handleResize);
    } catch {
      // Ignore canvas errors in unsupported environments
    }

    return () => {
      if (handleResize) {
        window.removeEventListener("resize", handleResize);
      }
    };
  }, [trend, today]);

  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-60 w-full"
      role="img"
      aria-label={`Net worth over the last 12 months, from ${formatCents(minCents)} to ${formatCents(maxCents)}`}
      data-testid="net-worth-chart"
    />
  );
}
