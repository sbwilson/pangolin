import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchNetWorth } from "../api.ts";
import { useOptionalImport } from "../components/import/index.ts";
import { MascotIcon } from "../components/MascotLogo.tsx";
import { NetWorthAccountRow } from "../components/NetWorthAccountRow.tsx";
import { NetWorthTrendChart } from "../components/NetWorthTrendChart.tsx";
import { monthNameFromDate, NetWorthTrendTable } from "../components/NetWorthTrendTable.tsx";
import { Button } from "../components/ui/button.tsx";
import { localDay } from "../lib/date-range.ts";
import { freshnessLabel } from "../lib/freshness.ts";
import { formatCents } from "../lib/money.ts";
import { useSignedIn } from "../session.tsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatTodayDate(today: string): string {
  const d = Number(today.slice(8, 10));
  const m = MONTHS[Number(today.slice(5, 7)) - 1];
  const y = today.slice(0, 4);
  return `${d} ${m} ${y}`;
}

export function NetWorthPage() {
  const { me } = useSignedIn();
  const importControls = useOptionalImport();
  const today = useMemo(() => localDay(new Date()), []);
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");

  const query = useQuery({
    queryKey: ["reports", "net-worth", today],
    queryFn: () => fetchNetWorth({ asOf: today }),
    retry: false,
  });

  const report = query.data;

  // KPI note: comparison against previous month end
  const monthDiffNote = useMemo(() => {
    if (!report || report.trend.length < 2) return "Across your visible accounts";
    const prevPoint = report.trend[report.trend.length - 2];
    if (!prevPoint) return "Across your visible accounts";
    const prevMonth = monthNameFromDate(prevPoint.date);
    const diff = report.netWorthCents - prevPoint.netWorthCents;
    if (diff > 0) return `Up ${formatCents(diff)} since ${prevMonth}.`;
    if (diff < 0) return `Down ${formatCents(Math.abs(diff))} since ${prevMonth}.`;
    return `No change since ${prevMonth}.`;
  }, [report]);

  const cashAccounts = useMemo(
    () =>
      report ? report.accounts.filter((a) => a.type === "transaction" || a.type === "offset") : [],
    [report],
  );
  const savingsAccounts = useMemo(
    () => (report ? report.accounts.filter((a) => a.type === "savings") : []),
    [report],
  );
  const loanAccounts = useMemo(
    () => (report ? report.accounts.filter((a) => a.type === "home_loan") : []),
    [report],
  );
  const cardAccounts = useMemo(
    () => (report ? report.accounts.filter((a) => a.type === "credit_card") : []),
    [report],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <MascotIcon size="sm" />
            <span>G’day, {me.displayName}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Net worth</h1>
          <p className="text-xs text-muted-foreground mt-1">
            As of today, {formatTodayDate(today)} ·{" "}
            {report?.latestImport ? freshnessLabel(report.latestImport) : "No imports yet"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => importControls?.openImport()}
            className="bg-primary text-primary-foreground font-semibold inline-flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 15V4M7 9l5-5 5 5" />
              <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
            </svg>
            <span>Import</span>
          </Button>
        </div>
      </div>

      {query.isPending ? <p className="text-muted-foreground">Loading net worth…</p> : null}
      {query.isError ? (
        <p role="alert" className="text-destructive">
          Net worth is currently unavailable. Please reload to try again.
        </p>
      ) : null}

      {report && report.accounts.length === 0 ? (
        <div
          data-testid="net-worth-empty"
          className="rounded-xl border border-border bg-card p-10 text-center"
        >
          <h3 className="text-lg font-semibold">Nothing to calculate yet</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Import a bank statement or create an account to start tracking your household net worth.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button
              type="button"
              onClick={() => importControls?.openImport()}
              className="bg-primary text-primary-foreground font-semibold"
            >
              Import statement
            </Button>
          </div>
        </div>
      ) : null}

      {report && report.accounts.length > 0 ? (
        <>
          {/* 3-up KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="net-worth-kpis">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground font-medium">Net worth</div>
              <div
                className="mt-1 text-2xl font-semibold tabular-nums text-primary"
                data-testid="kpi-net-worth"
              >
                {formatCents(report.netWorthCents)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{monthDiffNote}</div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground font-medium">Assets</div>
              <div
                className="mt-1 text-2xl font-semibold tabular-nums text-foreground"
                data-testid="kpi-assets"
              >
                {formatCents(report.assetsCents)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Cash, savings, and offset accounts
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground font-medium">Liabilities</div>
              <div
                className="mt-1 text-2xl font-semibold tabular-nums text-destructive"
                data-testid="kpi-liabilities"
              >
                {formatCents(report.liabilitiesCents)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Cards and loans</div>
            </div>
          </div>

          {/* 12-month Trend Card */}
          <div className="rounded-xl border border-border bg-card p-5" data-testid="trend-card">
            <div className="flex items-start justify-between gap-4 pb-2">
              <div>
                <h3 className="text-base font-semibold">Net worth over time</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last 12 months, from the accounts you can see.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewMode(viewMode === "chart" ? "table" : "chart")}
                className="text-primary text-sm font-semibold hover:underline cursor-pointer"
                data-testid="trend-view-toggle"
              >
                {viewMode === "chart" ? "View as table" : "View as chart"}
              </button>
            </div>

            {viewMode === "chart" ? (
              <NetWorthTrendChart trend={report.trend} today={today} />
            ) : (
              <NetWorthTrendTable trend={report.trend} />
            )}
          </div>

          {/* Assets and Liabilities Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Assets */}
            <div className="rounded-xl border border-border bg-card p-5" data-testid="assets-card">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <h3 className="text-base font-semibold">Assets</h3>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {formatCents(report.assetsCents)}
                </span>
              </div>

              {/* Cash Subgroup */}
              <div className="mt-4">
                <div className="flex items-center justify-between py-2 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Cash</span>
                  <span className="tabular-nums normal-case tracking-normal font-semibold text-foreground">
                    {formatCents(report.subtotals.cashCents)}
                  </span>
                </div>
                {cashAccounts.length > 0 ? (
                  cashAccounts.map((account) => (
                    <NetWorthAccountRow
                      key={account.id}
                      account={account}
                      me={me}
                      today={today}
                      onImport={(id) => importControls?.openImport({ accountId: id })}
                    />
                  ))
                ) : (
                  <p className="py-2 text-xs text-muted-foreground italic">No cash accounts</p>
                )}
              </div>

              {/* Savings Subgroup */}
              <div className="mt-4">
                <div className="flex items-center justify-between py-2 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Savings</span>
                  <span className="tabular-nums normal-case tracking-normal font-semibold text-foreground">
                    {formatCents(report.subtotals.savingsCents)}
                  </span>
                </div>
                {savingsAccounts.length > 0 ? (
                  savingsAccounts.map((account) => (
                    <NetWorthAccountRow
                      key={account.id}
                      account={account}
                      me={me}
                      today={today}
                      onImport={(id) => importControls?.openImport({ accountId: id })}
                    />
                  ))
                ) : (
                  <p className="py-2 text-xs text-muted-foreground italic">No savings accounts</p>
                )}
              </div>
            </div>

            {/* Liabilities */}
            <div
              className="rounded-xl border border-border bg-card p-5"
              data-testid="liabilities-card"
            >
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <h3 className="text-base font-semibold">Liabilities</h3>
                <span className="text-base font-semibold tabular-nums text-destructive">
                  {formatCents(report.liabilitiesCents)}
                </span>
              </div>

              {/* Loans Subgroup */}
              <div className="mt-4">
                <div className="flex items-center justify-between py-2 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Loans</span>
                  <span className="tabular-nums normal-case tracking-normal font-semibold text-destructive">
                    {formatCents(report.subtotals.loansCents)}
                  </span>
                </div>
                {loanAccounts.length > 0 ? (
                  loanAccounts.map((account) => (
                    <NetWorthAccountRow
                      key={account.id}
                      account={account}
                      me={me}
                      today={today}
                      isLiability
                      onImport={(id) => importControls?.openImport({ accountId: id })}
                    />
                  ))
                ) : (
                  <p className="py-2 text-xs text-muted-foreground italic">No loan accounts</p>
                )}
              </div>

              {/* Cards Subgroup */}
              <div className="mt-4">
                <div className="flex items-center justify-between py-2 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Cards</span>
                  <span className="tabular-nums normal-case tracking-normal font-semibold text-destructive">
                    {formatCents(report.subtotals.cardsCents)}
                  </span>
                </div>
                {cardAccounts.length > 0 ? (
                  cardAccounts.map((account) => (
                    <NetWorthAccountRow
                      key={account.id}
                      account={account}
                      me={me}
                      today={today}
                      isLiability
                      onImport={(id) => importControls?.openImport({ accountId: id })}
                    />
                  ))
                ) : (
                  <p className="py-2 text-xs text-muted-foreground italic">No card accounts</p>
                )}
              </div>

              <p className="text-xs text-muted-foreground mt-6">
                Loans and cards count at today’s balance.
              </p>
            </div>
          </div>

          {/* Forecast Link Card */}
          <div
            className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            data-testid="forecast-card"
          >
            <div>
              <h3 className="text-base font-semibold">Forecast</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Low, middle and high estimates from your savings rate and returns. Estimates, not
                advice.
              </p>
            </div>
            <span
              aria-disabled="true"
              className="text-sm font-semibold text-muted-foreground opacity-60 cursor-not-allowed select-none shrink-0"
            >
              Where will we be in 2 years? →
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
