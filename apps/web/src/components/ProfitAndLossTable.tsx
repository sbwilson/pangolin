import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ProfitAndLossReport, ReportRow } from "../api.ts";
import { formatCents } from "../lib/money.ts";

export interface ProfitAndLossTableProps {
  readonly pnlGroup: ProfitAndLossReport;
  readonly pnlCategory: ProfitAndLossReport;
  readonly range: { readonly from: string; readonly to: string };
  readonly keptCents: number;
  readonly className?: string;
}

const RAMP_BG_CLASSES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
  "bg-chart-7",
  "bg-chart-8",
  "bg-chart-9",
] as const;

export function formatPercentOfIncome(cents: number, incomeTotalCents: number): string {
  if (incomeTotalCents <= 0) return "—%";
  const sign = cents < 0 ? "-" : "";
  const permille = Math.round((Math.abs(cents) / incomeTotalCents) * 1000);
  return `${sign}${Math.floor(permille / 10)}.${permille % 10}%`;
}

export function ProfitAndLossTable({
  pnlGroup,
  pnlCategory,
  range,
  keptCents,
  className = "",
}: ProfitAndLossTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const incomeTotal = pnlGroup.income.totalCents;
  const expenseTotal = pnlGroup.expense.totalCents;

  // Group categories under expense groups
  const expenseCategoriesByGroup = new Map<string, ReportRow[]>();
  for (const cat of pnlCategory.expense.rows) {
    if (cat.groupId) {
      const list = expenseCategoriesByGroup.get(cat.groupId) ?? [];
      list.push(cat);
      expenseCategoriesByGroup.set(cat.groupId, list);
    }
  }

  const incomeCategoriesByGroup = new Map<string, ReportRow[]>();
  for (const cat of pnlCategory.income.rows) {
    if (cat.groupId) {
      const list = incomeCategoriesByGroup.get(cat.groupId) ?? [];
      list.push(cat);
      incomeCategoriesByGroup.set(cat.groupId, list);
    }
  }

  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 ${className}`}
      data-testid="pnl-table"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium">
                Category / Group
              </th>
              <th scope="col" className="py-2 px-4 text-right font-medium">
                Amount
              </th>
              <th scope="col" className="py-2 pl-4 text-right font-medium">
                % of Income
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {/* Income Header */}
            <tr className="bg-muted/40 font-semibold">
              <td className="py-2.5 pr-4">Income</td>
              <td className="py-2.5 px-4 text-right tabular-nums">{formatCents(incomeTotal)}</td>
              <td className="py-2.5 pl-4 text-right tabular-nums">
                {incomeTotal <= 0 ? "—%" : "100.0%"}
              </td>
            </tr>

            {/* Income Group Rows */}
            {pnlGroup.income.rows.map((row) => {
              const isUncat = row.id === null;
              const groupId = row.id ?? "uncategorised-income";
              const isExpanded = expandedGroups.has(groupId);
              const subCats = row.id ? (incomeCategoriesByGroup.get(row.id) ?? []) : [];
              const hasSubCats = subCats.length > 0;

              return (
                <RowFragment
                  key={`income-${groupId}`}
                  row={row}
                  isUncat={isUncat}
                  isExpanded={isExpanded}
                  hasSubCats={hasSubCats}
                  subCats={subCats}
                  incomeTotal={incomeTotal}
                  range={range}
                  type="in"
                  onToggle={() => toggleGroup(groupId)}
                />
              );
            })}

            {/* Expense Header */}
            <tr className="bg-muted/40 font-semibold">
              <td className="py-2.5 pr-4">Expenses</td>
              <td className="py-2.5 px-4 text-right tabular-nums">{formatCents(expenseTotal)}</td>
              <td className="py-2.5 pl-4 text-right tabular-nums">
                {formatPercentOfIncome(expenseTotal, incomeTotal)}
              </td>
            </tr>

            {/* Expense Group Rows */}
            {pnlGroup.expense.rows.map((row, index) => {
              const isUncat = row.id === null;
              const groupId = row.id ?? "uncategorised-expense";
              const isExpanded = expandedGroups.has(groupId);
              const subCats = row.id ? (expenseCategoriesByGroup.get(row.id) ?? []) : [];
              const hasSubCats = subCats.length > 0;
              const colorClass = isUncat
                ? "bg-warning"
                : index < RAMP_BG_CLASSES.length
                  ? RAMP_BG_CLASSES[index]
                  : "bg-muted-foreground";

              return (
                <RowFragment
                  key={`expense-${groupId}`}
                  row={row}
                  isUncat={isUncat}
                  colorClass={colorClass}
                  isExpanded={isExpanded}
                  hasSubCats={hasSubCats}
                  subCats={subCats}
                  incomeTotal={incomeTotal}
                  range={range}
                  type="out"
                  onToggle={() => toggleGroup(groupId)}
                />
              );
            })}

            {/* Kept / Net Savings */}
            <tr className="bg-muted/20 font-semibold border-t-2 border-border">
              <td className="py-2.5 pr-4">Kept (Net savings)</td>
              <td className="py-2.5 px-4 text-right tabular-nums">{formatCents(keptCents)}</td>
              <td className="py-2.5 pl-4 text-right tabular-nums">
                {formatPercentOfIncome(keptCents, incomeTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface RowFragmentProps {
  readonly row: ReportRow;
  readonly isUncat: boolean;
  readonly colorClass?: string | undefined;
  readonly isExpanded: boolean;
  readonly hasSubCats: boolean;
  readonly subCats: ReportRow[];
  readonly incomeTotal: number;
  readonly range: { readonly from: string; readonly to: string };
  readonly type: "in" | "out";
  readonly onToggle: () => void;
}

function RowFragment({
  row,
  isUncat,
  colorClass,
  isExpanded,
  hasSubCats,
  subCats,
  incomeTotal,
  range,
  type,
  onToggle,
}: RowFragmentProps) {
  const rowName = isUncat ? "Uncategorised" : (row.name ?? "Unnamed");
  const searchParams = isUncat
    ? { uncategorised: "true" as const, type, from: range.from, to: range.to }
    : row.id
      ? { group: row.id, from: range.from, to: range.to }
      : { from: range.from, to: range.to };

  return (
    <>
      <tr
        className="hover:bg-muted/30 transition-colors"
        data-testid={`pnl-row-${row.id ?? "uncat"}`}
      >
        <td className="py-2 pr-4">
          <div className="flex items-center gap-2">
            {hasSubCats ? (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${rowName}`}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <span
                  aria-hidden="true"
                  className={`inline-block transition-transform text-xs ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                >
                  ▶
                </span>
              </button>
            ) : (
              <span className="w-5" aria-hidden="true" />
            )}
            {colorClass ? (
              <span
                aria-hidden="true"
                className={`inline-block h-3 w-3 shrink-0 rounded-xs ${colorClass}`}
              />
            ) : null}
            <Link
              to="/transactions"
              search={searchParams}
              className="font-medium text-foreground hover:underline"
            >
              {rowName}
            </Link>
          </div>
        </td>
        <td className="py-2 px-4 text-right tabular-nums">{formatCents(row.cents)}</td>
        <td className="py-2 pl-4 text-right tabular-nums text-muted-foreground">
          {formatPercentOfIncome(row.cents, incomeTotal)}
        </td>
      </tr>

      {/* Expanded sub-category rows */}
      {isExpanded &&
        subCats.map((cat) => (
          <tr
            key={`subcat-${cat.id ?? "uncat"}`}
            className="bg-muted/10 hover:bg-muted/20 text-xs text-muted-foreground"
            data-testid={`pnl-subrow-${cat.id}`}
          >
            <td className="py-1.5 pr-4 pl-9">
              <Link
                to="/transactions"
                search={
                  cat.id
                    ? { category: cat.id, from: range.from, to: range.to }
                    : { uncategorised: "true" as const, type, from: range.from, to: range.to }
                }
                className="hover:underline hover:text-foreground"
              >
                {cat.name ?? "Unnamed"}
              </Link>
            </td>
            <td className="py-1.5 px-4 text-right tabular-nums">{formatCents(cat.cents)}</td>
            <td className="py-1.5 pl-4 text-right tabular-nums">
              {formatPercentOfIncome(cat.cents, incomeTotal)}
            </td>
          </tr>
        ))}
    </>
  );
}
