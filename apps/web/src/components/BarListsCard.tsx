import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { MerchantsReport, ProfitAndLossReport } from "../api.ts";
import { formatCents } from "../lib/money.ts";
import { formatPercentOfIncome } from "./ProfitAndLossTable.tsx";

export interface BarListsCardProps {
  readonly pnlGroup: ProfitAndLossReport;
  readonly pnlCategory: ProfitAndLossReport;
  readonly incomeMerchants: MerchantsReport;
  readonly expenseMerchants: MerchantsReport;
  readonly range: { readonly from: string; readonly to: string };
}

type IncomeTab = "category" | "merchant";
type ExpenseTab = "group" | "category" | "merchant";

const RAMP_FILLS = [
  "fill-chart-1",
  "fill-chart-2",
  "fill-chart-3",
  "fill-chart-4",
  "fill-chart-5",
  "fill-chart-6",
  "fill-chart-7",
  "fill-chart-8",
  "fill-chart-9",
] as const;

export function BarListsCard({
  pnlGroup,
  pnlCategory,
  incomeMerchants,
  expenseMerchants,
  range,
}: BarListsCardProps) {
  const [incomeTab, setIncomeTab] = useState<IncomeTab>("category");
  const [expenseTab, setExpenseTab] = useState<ExpenseTab>("group");

  const incomeTotal = pnlGroup.income.totalCents;
  const expenseTotal = pnlGroup.expense.totalCents;

  // Income items
  const incomeItems =
    incomeTab === "category"
      ? pnlCategory.income.rows.map((r) => ({
          id: r.id,
          name: r.id === null ? "Uncategorised" : (r.name ?? "Unnamed"),
          cents: r.cents,
          isUncat: r.id === null,
          filterType: "category" as const,
        }))
      : incomeMerchants.rows.map((r) => ({
          id: r.payeeId,
          name: r.payeeId === null ? "Unknown payee" : (r.payeeName ?? "Unnamed"),
          cents: r.cents,
          isUncat: false,
          filterType: "merchant" as const,
        }));

  const maxIncomeCents =
    incomeItems.length > 0 ? Math.max(...incomeItems.map((i) => i.cents), 1) : 1;

  // Expense items
  const expenseItems =
    expenseTab === "group"
      ? pnlGroup.expense.rows.map((r, idx) => ({
          id: r.id,
          name: r.id === null ? "Uncategorised" : (r.name ?? "Unnamed"),
          cents: r.cents,
          isUncat: r.id === null,
          colorClass:
            r.id === null
              ? "fill-warning"
              : idx < RAMP_FILLS.length
                ? RAMP_FILLS[idx]
                : "fill-muted-foreground",
          filterType: "group" as const,
        }))
      : expenseTab === "category"
        ? pnlCategory.expense.rows.map((r) => ({
            id: r.id,
            name: r.id === null ? "Uncategorised" : (r.name ?? "Unnamed"),
            cents: r.cents,
            isUncat: r.id === null,
            colorClass: r.id === null ? "fill-warning" : "fill-primary",
            filterType: "category" as const,
          }))
        : expenseMerchants.rows.map((r) => ({
            id: r.payeeId,
            name: r.payeeId === null ? "Unknown payee" : (r.payeeName ?? "Unnamed"),
            cents: r.cents,
            isUncat: false,
            colorClass: "fill-primary",
            filterType: "merchant" as const,
          }));

  const maxExpenseCents =
    expenseItems.length > 0 ? Math.max(...expenseItems.map((i) => i.cents), 1) : 1;

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2" data-testid="bar-lists-card">
      {/* Income Bar List Card */}
      <div className="rounded-lg border border-border bg-card p-4" data-testid="income-bar-card">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h3 className="m-0 text-base font-semibold">Income</h3>
            <p className="m-0 text-xs text-muted-foreground">Total: {formatCents(incomeTotal)}</p>
          </div>

          {/* biome-ignore lint/a11y/useSemanticElements: a pill toggle, not a form fieldset */}
          <div
            role="group"
            aria-label="Income view"
            className="inline-flex rounded-lg border border-border bg-muted p-1"
          >
            {(
              [
                { id: "category", label: "Category" },
                { id: "merchant", label: "Merchant" },
              ] as const
            ).map((opt) => {
              const active = incomeTab === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setIncomeTab(opt.id)}
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
        </header>

        {incomeItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No income in this period</p>
        ) : (
          <div className="space-y-3">
            {incomeItems.map((item) => {
              const percentOfMax = Math.max(
                0,
                Math.min(100, Math.round((item.cents / maxIncomeCents) * 100)),
              );

              const searchParams = item.isUncat
                ? { uncategorised: "true" as const, from: range.from, to: range.to }
                : item.filterType === "category" && item.id
                  ? { category: item.id, from: range.from, to: range.to }
                  : item.filterType === "merchant" && item.id
                    ? { payee: item.id, from: range.from, to: range.to }
                    : { from: range.from, to: range.to };

              return (
                <div
                  key={`income-${item.filterType}-${item.id ?? "null"}`}
                  className="group"
                  data-testid={`income-bar-row-${item.id ?? "null"}`}
                >
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <Link
                      to="/transactions"
                      search={searchParams}
                      className="font-medium text-foreground hover:underline truncate max-w-[65%]"
                    >
                      {item.name}
                    </Link>
                    <div className="flex items-center gap-2 tabular-nums">
                      <span className="font-semibold text-foreground">
                        {formatCents(item.cents)}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {formatPercentOfIncome(item.cents, incomeTotal)}
                      </span>
                    </div>
                  </div>
                  {/* SVG progress bar avoiding inline styles */}
                  <svg
                    className="h-2 w-full rounded-full bg-muted overflow-hidden"
                    viewBox="0 0 100 8"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={percentOfMax}
                      height="8"
                      rx="4"
                      className="fill-primary"
                    />
                  </svg>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Expense Bar List Card */}
      <div className="rounded-lg border border-border bg-card p-4" data-testid="expense-bar-card">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h3 className="m-0 text-base font-semibold">Expenses</h3>
            <p className="m-0 text-xs text-muted-foreground">Total: {formatCents(expenseTotal)}</p>
          </div>

          {/* biome-ignore lint/a11y/useSemanticElements: a pill toggle, not a form fieldset */}
          <div
            role="group"
            aria-label="Expense view"
            className="inline-flex rounded-lg border border-border bg-muted p-1"
          >
            {(
              [
                { id: "group", label: "Group" },
                { id: "category", label: "Category" },
                { id: "merchant", label: "Merchant" },
              ] as const
            ).map((opt) => {
              const active = expenseTab === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setExpenseTab(opt.id)}
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
        </header>

        {expenseItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No expenses in this period
          </p>
        ) : (
          <div className="space-y-3">
            {expenseItems.map((item) => {
              const percentOfMax = Math.max(
                0,
                Math.min(100, Math.round((item.cents / maxExpenseCents) * 100)),
              );

              const searchParams = item.isUncat
                ? { uncategorised: "true" as const, from: range.from, to: range.to }
                : item.filterType === "group" && item.id
                  ? { group: item.id, from: range.from, to: range.to }
                  : item.filterType === "category" && item.id
                    ? { category: item.id, from: range.from, to: range.to }
                    : item.filterType === "merchant" && item.id
                      ? { payee: item.id, from: range.from, to: range.to }
                      : { from: range.from, to: range.to };

              return (
                <div
                  key={`expense-${item.filterType}-${item.id ?? "null"}`}
                  className="group"
                  data-testid={`expense-bar-row-${item.id ?? "null"}`}
                >
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <Link
                      to="/transactions"
                      search={searchParams}
                      className="font-medium text-foreground hover:underline truncate max-w-[65%]"
                    >
                      {item.name}
                    </Link>
                    <div className="flex items-center gap-2 tabular-nums">
                      <span className="font-semibold text-foreground">
                        {formatCents(item.cents)}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {formatPercentOfIncome(item.cents, incomeTotal)}
                      </span>
                    </div>
                  </div>
                  {/* SVG progress bar avoiding inline styles */}
                  <svg
                    className="h-2 w-full rounded-full bg-muted overflow-hidden"
                    viewBox="0 0 100 8"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={percentOfMax}
                      height="8"
                      rx="4"
                      className={item.colorClass ?? "fill-primary"}
                    />
                  </svg>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
