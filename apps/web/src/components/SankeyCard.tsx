import { useNavigate } from "@tanstack/react-router";
import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfitAndLossReport } from "../api.ts";
import { useIsPhone } from "../hooks/useIsPhone.ts";
import { ProfitAndLossTable } from "./ProfitAndLossTable.tsx";
import {
  buildSankeyGraph,
  createSankeyOption,
  type SankeyLevel,
  type SankeyNode,
} from "./sankey-layout.ts";

export { useIsPhone } from "../hooks/useIsPhone.ts";
export type { SankeyLevel } from "./sankey-layout.ts";

export interface SankeyCardProps {
  readonly pnlGroup: ProfitAndLossReport;
  readonly pnlCategory: ProfitAndLossReport;
  readonly range: { readonly from: string; readonly to: string };
  readonly keptCents: number;
}

export type ViewMode = "sankey" | "table";

export function SankeyCard({ pnlGroup, pnlCategory, range, keptCents }: SankeyCardProps) {
  const isPhone = useIsPhone();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("sankey");
  const [level, setLevel] = useState<SankeyLevel>("groups");
  const [expandOther, setExpandOther] = useState(false);
  const [hasRenderError, setHasRenderError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  // Build nodes and links for ECharts Sankey
  const { nodes, links } = useMemo(
    () => buildSankeyGraph({ pnlGroup, pnlCategory, level, expandOther, keptCents }),
    [pnlGroup, pnlCategory, level, expandOther, keptCents],
  );

  // Initialize and update ECharts
  useEffect(() => {
    if (viewMode !== "sankey" || !containerRef.current) {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
      return;
    }

    // Check canvas support (e.g. in jsdom or headless environments without 2D canvas context)
    const testCanvas = document.createElement("canvas");
    if (!testCanvas.getContext?.("2d")) {
      setHasRenderError(true);
      return;
    }

    try {
      const width = containerRef.current.clientWidth || 800;
      const height = containerRef.current.clientHeight || 400;

      if (!chartInstanceRef.current || chartInstanceRef.current.isDisposed()) {
        chartInstanceRef.current = echarts.init(containerRef.current, null, {
          renderer: "canvas",
          width,
          height,
        });
      }

      const chart = chartInstanceRef.current;
      const option = createSankeyOption(nodes, links);
      chart.setOption(option, true);

      const handleClick = (params: unknown) => {
        const p = params as { dataType?: string; data?: SankeyNode };
        if (p.dataType !== "node" || !p.data) return;
        const node = p.data;

        if (node.kind === "other") {
          setExpandOther((prev) => !prev);
          return;
        }
        if (node.kind === "uncategorised") {
          void navigate({
            to: "/transactions",
            search: { uncategorised: "true", from: range.from, to: range.to },
          });
          return;
        }
        if (node.kind === "category" && node.id) {
          void navigate({
            to: "/transactions",
            search: { category: node.id, from: range.from, to: range.to },
          });
          return;
        }
        if (node.kind === "group" && node.id) {
          void navigate({
            to: "/transactions",
            search: { group: node.id, from: range.from, to: range.to },
          });
          return;
        }
      };

      chart.on("click", handleClick);

      const handleResize = () => {
        chart.resize();
      };
      window.addEventListener("resize", handleResize);

      return () => {
        chart.off("click", handleClick);
        window.removeEventListener("resize", handleResize);
        if (chartInstanceRef.current) {
          chartInstanceRef.current.dispose();
          chartInstanceRef.current = null;
        }
      };
    } catch {
      setHasRenderError(true);
      return undefined;
    }
  }, [viewMode, nodes, links, range, navigate]);

  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  // Phone view (< md, e.g. 375px) renders P&L table directly with no toggles
  if (isPhone) {
    return (
      <section aria-label="Profit and loss" data-testid="sankey-card-phone">
        <ProfitAndLossTable
          pnlGroup={pnlGroup}
          pnlCategory={pnlCategory}
          range={range}
          keptCents={keptCents}
        />
      </section>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-4" data-testid="sankey-card">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <h3 className="m-0 text-base font-semibold">Flow of funds</h3>

        <div className="flex flex-wrap items-center gap-2">
          {/* Level segmented control (only visible in Sankey mode) */}
          {viewMode === "sankey" ? (
            /* biome-ignore lint/a11y/useSemanticElements: a pill toggle, not a form fieldset */
            <div
              role="group"
              aria-label="Detail level"
              className="inline-flex rounded-lg border border-border bg-muted p-1"
            >
              {(
                [
                  { id: "groups", label: "Groups" },
                  { id: "categories", label: "Categories" },
                  { id: "both", label: "Both" },
                ] as const
              ).map((opt) => {
                const active = level === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setLevel(opt.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                      active
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* View mode toggle (Sankey vs Table) */}
          {/* biome-ignore lint/a11y/useSemanticElements: a pill toggle, not a form fieldset */}
          <div
            role="group"
            aria-label="View presentation"
            className="inline-flex rounded-lg border border-border bg-muted p-1"
          >
            {(
              [
                { id: "sankey", label: "Sankey" },
                { id: "table", label: "Profit & loss" },
              ] as const
            ).map((opt) => {
              const active = viewMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setViewMode(opt.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                    active
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {viewMode === "table" || hasRenderError ? (
        <div>
          {hasRenderError ? (
            <p role="alert" className="mb-3 text-xs text-muted-foreground">
              Sankey chart unavailable. Showing Profit & loss table instead.
            </p>
          ) : null}
          <ProfitAndLossTable
            pnlGroup={pnlGroup}
            pnlCategory={pnlCategory}
            range={range}
            keptCents={keptCents}
          />
        </div>
      ) : (
        <div ref={containerRef} data-testid="sankey-chart" className="w-full h-96 min-h-[384px]" />
      )}
    </div>
  );
}
