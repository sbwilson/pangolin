import type * as echarts from "echarts";
import type { ProfitAndLossReport } from "../api.ts";
import { formatCents } from "../lib/money.ts";

export type SankeyLevel = "groups" | "categories" | "both";

export const FALLBACK_RAMP = [
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

export function getChartColor(index: number): string {
  if (typeof window !== "undefined") {
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue(`--chart-${index + 1}`)
      .trim();
    if (val) return val;
  }
  return FALLBACK_RAMP[index % FALLBACK_RAMP.length] ?? "#888888";
}

export function getWarningColor(): string {
  if (typeof window !== "undefined") {
    const val = getComputedStyle(document.documentElement).getPropertyValue("--warning").trim();
    if (val) return val;
  }
  return "#f79009";
}

export interface SankeyNode {
  name: string;
  itemStyle?: { color: string };
  id?: string;
  kind?: "income" | "group" | "category" | "uncategorised" | "kept" | "other" | "total";
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface BuildSankeyGraphParams {
  readonly pnlGroup: ProfitAndLossReport;
  readonly pnlCategory: ProfitAndLossReport;
  readonly level: SankeyLevel;
  readonly expandOther: boolean;
  readonly keptCents: number;
}

export function buildSankeyGraph({
  pnlGroup,
  pnlCategory,
  level,
  expandOther,
  keptCents,
}: BuildSankeyGraphParams): { nodes: SankeyNode[]; links: SankeyLink[] } {
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
}

export function createSankeyOption(
  nodes: readonly SankeyNode[],
  links: readonly SankeyLink[],
): echarts.EChartsOption {
  return {
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
    ] as unknown as echarts.SeriesOption[],
  };
}
