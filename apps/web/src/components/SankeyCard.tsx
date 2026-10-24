import { useNavigate } from "@tanstack/react-router";
import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfitAndLossReport } from "../api.ts";
import { formatCents } from "../lib/money.ts";
import { ProfitAndLossTable } from "./ProfitAndLossTable.tsx";

export interface SankeyCardProps {
  readonly pnlGroup: ProfitAndLossReport;
  readonly pnlCategory: ProfitAndLossReport;
  readonly range: { readonly from: string; readonly to: string };
  readonly keptCents: number;
}

export type SankeyLevel = "groups" | "categories" | "both";
export type ViewMode = "sankey" | "table";

const FALLBACK_RAMP = [
  "#c11574",
  "#155eef",
  "#00a389",
  "#f79009",
  "#7a5af8",
  "#12b76a",
  "#854d0e",
  "#0ba5ec",
  "#f04438",
];

function getChartColor(index: number): string {
  if (typeof window !== "undefined") {
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue(`--chart-${index + 1}`)
      .trim();
    if (val) return val;
  }
  return FALLBACK_RAMP[index % FALLBACK_RAMP.length] ?? "#888888";
}

function getWarningColor(): string {
  if (typeof window !== "undefined") {
    const val = getComputedStyle(document.documentElement).getPropertyValue("--warning").trim();
    if (val) return val;
  }
  return "#f79009";
}

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsPhone(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isPhone;
}

interface SankeyNode {
  name: string;
  itemStyle?: { color: string };
  id?: string;
  kind?: "income" | "group" | "category" | "uncategorised" | "kept" | "other" | "total";
}

interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

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
  const { nodes, links } = useMemo(() => {
    const nodeList: SankeyNode[] = [];
    const linkList: SankeyLink[] = [];
    const nodeNames = new Set<string>();

    const addNode = (node: SankeyNode) => {
      if (!nodeNames.has(node.name)) {
        nodeNames.add(node.name);
        nodeList.push(node);
      }
    };

    const totalIncomeName = "Total income";
    addNode({ name: totalIncomeName, kind: "total", itemStyle: { color: "#6366f1" } });

    // Collect all expense names to disambiguate income nodes if they collide
    const expenseNames = new Set<string>();
    for (const r of pnlGroup.expense.rows) {
      if (r.name) expenseNames.add(r.name);
    }
    for (const r of pnlCategory.expense.rows) {
      if (r.name) expenseNames.add(r.name);
    }

    if (level === "groups" || level === "both") {
      // Income Groups
      for (const row of pnlGroup.income.rows) {
        if (row.cents <= 0) continue;
        const isUncat = row.id === null;
        const rawName = row.name ?? "Income source";
        let name = isUncat ? "Uncategorised (In)" : rawName;
        if (!isUncat && (expenseNames.has(name) || name === totalIncomeName)) {
          name = `${name} (In)`;
        }
        addNode({
          name,
          ...(row.id ? { id: row.id } : {}),
          kind: isUncat ? "uncategorised" : "group",
          itemStyle: { color: isUncat ? getWarningColor() : "#22c55e" },
        });
        linkList.push({ source: name, target: totalIncomeName, value: row.cents });
      }

      // Expense Groups
      const categorised = pnlGroup.expense.rows.filter((r) => r.id !== null);
      const uncat = pnlGroup.expense.rows.find((r) => r.id === null);

      const top9 = categorised.slice(0, 9);
      const remaining = categorised.slice(9);

      top9.forEach((row, idx) => {
        if (row.cents <= 0) return;
        const name = row.name ?? "Expense group";
        addNode({
          name,
          ...(row.id ? { id: row.id } : {}),
          kind: "group",
          itemStyle: { color: getChartColor(idx) },
        });
        linkList.push({ source: totalIncomeName, target: name, value: row.cents });
      });

      if (remaining.length > 0) {
        if (expandOther) {
          remaining.forEach((row, idx) => {
            if (row.cents <= 0) return;
            const name = row.name ?? `Other group ${idx + 1}`;
            addNode({
              name,
              ...(row.id ? { id: row.id } : {}),
              kind: "group",
              itemStyle: { color: getChartColor((9 + idx) % 9) },
            });
            linkList.push({ source: totalIncomeName, target: name, value: row.cents });
          });
        } else {
          const otherTotal = remaining.reduce((acc, r) => acc + r.cents, 0);
          if (otherTotal > 0) {
            const otherName = `Other · ${remaining.length} groups`;
            addNode({
              name: otherName,
              kind: "other",
              itemStyle: { color: "#8e9aaf" },
            });
            linkList.push({ source: totalIncomeName, target: otherName, value: otherTotal });
          }
        }
      }

      if (uncat && uncat.cents > 0) {
        const name = "Uncategorised";
        addNode({
          name,
          kind: "uncategorised",
          itemStyle: { color: getWarningColor() },
        });
        linkList.push({ source: totalIncomeName, target: name, value: uncat.cents });
      }

      // If "both", connect expense groups to their categories (only for rendered groups)
      if (level === "both") {
        for (const cat of pnlCategory.expense.rows) {
          if (!cat.groupId || cat.cents <= 0) continue;
          const groupRow = pnlGroup.expense.rows.find((g) => g.id === cat.groupId);
          if (!groupRow) continue;
          const groupName = groupRow.name ?? "Expense group";
          if (!nodeNames.has(groupName)) continue;
          const catName = cat.name ?? "Category";
          const displayName = catName === groupName ? `${catName} (Cat)` : catName;
          addNode({
            name: displayName,
            ...(cat.id ? { id: cat.id } : {}),
            kind: "category",
            itemStyle: { color: "#94a3b8" },
          });
          linkList.push({ source: groupName, target: displayName, value: cat.cents });
        }
      }
    } else if (level === "categories") {
      // Categories mode
      for (const row of pnlCategory.income.rows) {
        if (row.cents <= 0) continue;
        const isUncat = row.id === null;
        const rawName = row.name ?? "Income category";
        let name = isUncat ? "Uncategorised (In)" : rawName;
        if (!isUncat && (expenseNames.has(name) || name === totalIncomeName)) {
          name = `${name} (In)`;
        }
        addNode({
          name,
          ...(row.id ? { id: row.id } : {}),
          kind: isUncat ? "uncategorised" : "category",
          itemStyle: { color: isUncat ? getWarningColor() : "#22c55e" },
        });
        linkList.push({ source: name, target: totalIncomeName, value: row.cents });
      }

      pnlCategory.expense.rows.forEach((row, idx) => {
        if (row.cents <= 0) return;
        const isUncat = row.id === null;
        const name = isUncat ? "Uncategorised" : (row.name ?? "Category");
        addNode({
          name,
          ...(row.id ? { id: row.id } : {}),
          kind: isUncat ? "uncategorised" : "category",
          itemStyle: { color: isUncat ? getWarningColor() : getChartColor(idx % 9) },
        });
        linkList.push({ source: totalIncomeName, target: name, value: row.cents });
      });
    }

    // Kept (Savings node)
    if (keptCents > 0) {
      const keptName = "Kept";
      addNode({
        name: keptName,
        kind: "kept",
        itemStyle: { color: "#10b981" },
      });
      linkList.push({ source: totalIncomeName, target: keptName, value: keptCents });
    }

    return { nodes: nodeList, links: linkList };
  }, [pnlGroup, pnlCategory, level, expandOther, keptCents]);

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

      const option: echarts.EChartsOption = {
        tooltip: {
          trigger: "item",
          renderMode: "richText",
          formatter: (params: unknown) => {
            const p = params as { name: string; value: number };
            return `${p.name}: ${formatCents(p.value)}`;
          },
        },
        series: [
          {
            type: "sankey",
            emphasis: { focus: "adjacency" },
            nodeAlign: "justify",
            draggable: false,
            data: nodes,
            links: links,
            lineStyle: {
              color: "source",
              opacity: 0.25,
              curveness: 0.5,
            },
            label: {
              color: "inherit",
              fontSize: 12,
            },
          },
        ],
      };

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
