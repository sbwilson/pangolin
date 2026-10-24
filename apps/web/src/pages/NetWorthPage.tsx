import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils.ts";
import { fetchNetWorth, type Me, type NetWorthAccount, type NetWorthTrendPoint } from "../api.ts";
import { useOptionalImport } from "../components/import/index.ts";
import { MascotIcon } from "../components/MascotLogo.tsx";
import { Button } from "../components/ui/button.tsx";
import { ownerLabel, showsLock, TYPE_LABEL } from "../lib/accounts.ts";
import { localDay } from "../lib/date-range.ts";
import { freshnessLabel, isStale } from "../lib/freshness.ts";
import { formatCents } from "../lib/money.ts";
import { useSignedIn } from "../session.tsx";
import { LockIcon } from "./AccountsPage.tsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatShortDate(day: string): string {
  const d = Number(day.slice(8, 10));
  const m = MONTHS[Number(day.slice(5, 7)) - 1];
  return `${d} ${m}`;
}

function formatTodayDate(today: string): string {
  const d = Number(today.slice(8, 10));
  const m = MONTHS[Number(today.slice(5, 7)) - 1];
  const y = today.slice(0, 4);
  return `${d} ${m} ${y}`;
}

function monthNameFromDate(day: string): string {
  return FULL_MONTHS[Number(day.slice(5, 7)) - 1] ?? "";
}

function monthAbbrFromDate(day: string): string {
  return MONTHS[Number(day.slice(5, 7)) - 1] ?? "";
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
                    <AccountRowItem
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
                    <AccountRowItem
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
                    <AccountRowItem
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
                    <AccountRowItem
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

function AccountRowItem({
  account,
  me,
  today,
  isLiability,
  onImport,
}: {
  readonly account: NetWorthAccount;
  readonly me: Me;
  readonly today: string;
  readonly isLiability?: boolean;
  readonly onImport: (accountId: string) => void;
}) {
  const isPrivateForMe = showsLock(account, me);
  const stale = isStale(account.lastImport?.through ?? null, today);
  const initial = (account.institutionName ?? account.name).charAt(0).toUpperCase();

  return (
    <div
      data-testid={`account-row-${account.id}`}
      className="grid grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 border-b border-border last:border-b-0 text-sm"
    >
      <span className="size-6 rounded-full bg-accent text-primary text-xs font-semibold grid place-items-center shrink-0">
        {initial}
      </span>

      <div className="min-w-0">
        <div className="font-medium text-foreground truncate flex items-center gap-1.5">
          <Link
            to="/accounts/$id"
            params={{ id: account.id }}
            className="truncate hover:underline hover:text-primary transition-colors"
          >
            {account.name}
          </Link>
          {isPrivateForMe ? <LockIcon /> : null}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {account.institutionName ? `${account.institutionName} · ` : ""}
          {TYPE_LABEL[account.type] ?? account.type}
        </div>
      </div>

      <div className="shrink-0 text-xs">
        {account.pool === "shared" ? (
          <span className="border border-border rounded px-1.5 py-0.5 text-muted-foreground">
            Shared
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0" aria-hidden="true">
              <circle
                cx="4"
                cy="4"
                r="4"
                fill={account.pool === me.personId ? me.colour : "currentColor"}
              />
            </svg>
            {ownerLabel(account, me)}
          </span>
        )}
      </div>

      <div className="text-right shrink-0">
        <div
          className={cn(
            "tabular-nums font-medium",
            isLiability ? "text-destructive" : "text-foreground",
          )}
        >
          {formatCents(account.balanceCents)}
        </div>
        <div className="text-xs">
          {stale ? (
            <span className="text-warning font-medium">
              to {account.lastImport ? formatShortDate(account.lastImport.through) : "old"} ·{" "}
              <button
                type="button"
                onClick={() => onImport(account.id)}
                className="underline font-semibold hover:opacity-80 cursor-pointer"
              >
                Import
              </button>
            </span>
          ) : account.lastImport !== null ? (
            <span className="text-muted-foreground">
              to {formatShortDate(account.lastImport.through)}
            </span>
          ) : (
            <span className="text-muted-foreground">
              No imports yet ·{" "}
              <button
                type="button"
                onClick={() => onImport(account.id)}
                className="underline font-semibold hover:opacity-80 cursor-pointer"
              >
                Import
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function NetWorthTrendChart({
  trend,
  today,
}: {
  readonly trend: readonly NetWorthTrendPoint[];
  readonly today: string;
}) {
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

function NetWorthTrendTable({ trend }: { readonly trend: readonly NetWorthTrendPoint[] }) {
  const reversedTrend = useMemo(() => [...trend].reverse(), [trend]);

  return (
    <div className="overflow-x-auto mt-4" data-testid="net-worth-table">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <th scope="col" className="py-2 pr-4 font-semibold">
              Month
            </th>
            <th scope="col" className="py-2 px-4 text-right font-semibold">
              Net worth
            </th>
            <th scope="col" className="py-2 px-4 text-right font-semibold">
              Assets
            </th>
            <th scope="col" className="py-2 pl-4 text-right font-semibold">
              Liabilities
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reversedTrend.map((point) => (
            <tr key={point.date} className="hover:bg-muted/50 transition-colors">
              <td className="py-2.5 pr-4 text-foreground font-medium">
                {`${monthNameFromDate(point.date)} ${point.date.slice(0, 4)}`}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-primary">
                {formatCents(point.netWorthCents)}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums text-foreground">
                {formatCents(point.assetsCents)}
              </td>
              <td className="py-2.5 pl-4 text-right tabular-nums text-destructive">
                {formatCents(point.liabilitiesCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
