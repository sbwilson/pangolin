import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  fetchBudgets,
  fetchForecast,
  fetchForecastAssumptions,
  fetchForecastNetWorth,
  fetchMe,
  fetchPayAnchors,
  fetchRecurringSeries,
} from "../api.ts";
import { ASSUMPTIONS_QUERY_KEY, AssumptionChips } from "../components/AssumptionChips.tsx";
import { ForecastCashFlowChart, shortDayLabel } from "../components/ForecastCashFlowChart.tsx";
import { ForecastCashFlowTable } from "../components/ForecastCashFlowTable.tsx";
import {
  type ChipSource,
  ForecastContextChips,
  type PayContext,
} from "../components/ForecastContextChips.tsx";
import { ForecastNetWorthChart } from "../components/ForecastNetWorthChart.tsx";
import { ForecastNetWorthTable } from "../components/ForecastNetWorthTable.tsx";
import { formatCents, formatWholeDollars } from "../lib/money.ts";
import { type ForecastSearch, validateForecastSearch } from "../routes/search.ts";
import { ME_KEY } from "../session.tsx";

const MONTHS = [3, 6, 12] as const;
type ForecastHorizon = (typeof MONTHS)[number];
const YEARS = [1, 2, 5, 10] as const;
type ForecastYears = (typeof YEARS)[number];
type ForecastMode = "cashflow" | "networth";

const pluralYears = (years: number): string => (years === 1 ? "year" : "years");

/** The shared pressed/unpressed pill styling of the header's segmented controls. */
const pill = (pressed: boolean): string =>
  `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
    pressed
      ? "bg-card text-foreground shadow-sm font-semibold"
      : "text-muted-foreground hover:text-foreground"
  }`;

const SEGMENT = "inline-flex rounded-lg border border-border bg-muted p-0.5 m-0 border-0";

/**
 * `/planning/forecast`: a read-only projection of each visible transaction account, day by day
 * to the chosen horizon (cash flow mode), or the three low/mid/high net-worth lines over a
 * number of years (net worth mode). The mode and both horizons live in the URL. Cash flow mode
 * reads; under the card, read-only chips name what drives the projection. Net worth mode's chips
 * hold the one thing the page can edit — the stored assumptions behind the lines.
 */
export function ForecastPage() {
  // The route's search is merged over the raw URL's, so read it through the validator again.
  const rawSearch = useSearch({ from: "/planning/forecast" });
  const search = useMemo(() => validateForecastSearch(rawSearch), [rawSearch]);
  const navigate = useNavigate({ from: "/planning/forecast" });
  const mode: ForecastMode = search.mode === "networth" ? "networth" : "cashflow";
  const horizon = (search.horizon === undefined ? 3 : Number(search.horizon)) as ForecastHorizon;
  const years = (search.years === undefined ? 2 : Number(search.years)) as ForecastYears;

  // Each control updates only its own param; the other mode's horizon stays in the URL.
  const setSearch = (patch: Partial<ForecastSearch>) =>
    void navigate({ search: { ...search, ...patch } });

  const cashFlow = useQuery({
    queryKey: ["planning", "forecast", "cashflow", horizon],
    queryFn: () => fetchForecast(horizon),
    enabled: mode === "cashflow",
    retry: false,
  });
  const netWorth = useQuery({
    queryKey: ["planning", "forecast", "networth", years],
    queryFn: () => fetchForecastNetWorth(years),
    enabled: mode === "networth",
    retry: false,
  });

  // The read-only context chips of cash-flow mode, assembled client-side from what already exists.
  const cashflowOnly = mode === "cashflow";
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, enabled: cashflowOnly, retry: false });
  const payAnchors = useQuery({
    queryKey: ["planning", "pay-anchors"],
    queryFn: fetchPayAnchors,
    enabled: cashflowOnly,
    retry: false,
  });
  const confirmedBills = useQuery({
    queryKey: ["planning", "recurring-bills", "confirmed"],
    queryFn: () => fetchRecurringSeries({ status: "confirmed" }),
    enabled: cashflowOnly,
    retry: false,
  });
  const budgets = useQuery({
    queryKey: ["planning", "budgets"],
    queryFn: fetchBudgets,
    enabled: cashflowOnly,
    retry: false,
  });

  // The editable assumption chips of net-worth mode; the PUTs land back in this cache.
  const assumptions = useQuery({
    queryKey: ASSUMPTIONS_QUERY_KEY,
    queryFn: fetchForecastAssumptions,
    enabled: mode === "networth",
    retry: false,
  });

  const [cashflowView, setCashflowView] = useState<"chart" | "table">("chart");
  const [networthView, setNetworthView] = useState<"chart" | "table">("chart");

  const report = cashFlow.data;
  const projection = netWorth.data;
  const finalCents = (line: { points: readonly { netWorthCents: number }[] }): number =>
    line.points[line.points.length - 1]?.netWorthCents ?? 0;
  // Display-only rounding of fetched points; the web never adds money up.
  const figures =
    projection === undefined
      ? null
      : {
          today: formatWholeDollars(projection.lines.low.points[0]?.netWorthCents ?? 0),
          mid: formatWholeDollars(finalCents(projection.lines.mid)),
          low: formatWholeDollars(finalCents(projection.lines.low)),
          high: formatWholeDollars(finalCents(projection.lines.high)),
        };

  // Each context chip reads its source once settled; a failed source keeps its chip out.
  const paySource: ChipSource<PayContext> =
    me.isPending || payAnchors.isPending
      ? { state: "loading" }
      : me.isError || payAnchors.isError
        ? { state: "failed" }
        : { state: "ready", value: { me: me.data ?? null, anchors: payAnchors.data ?? [] } };
  const billsSource: ChipSource<number> = confirmedBills.isPending
    ? { state: "loading" }
    : confirmedBills.isError
      ? { state: "failed" }
      : {
          state: "ready",
          value: (confirmedBills.data ?? []).filter((s) => s.direction === "bill").length,
        };
  const budgetsSource: ChipSource<number> = budgets.isPending
    ? { state: "loading" }
    : budgets.isError
      ? { state: "failed" }
      : { state: "ready", value: budgets.data?.length ?? 0 };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Forecast</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Your projected balances ahead of you — pay days, confirmed bills and budgeted spend,
            read from today. Nothing here is recorded.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <fieldset className={SEGMENT} aria-label="Forecast mode">
            <legend className="sr-only">Forecast mode</legend>
            <button
              type="button"
              aria-pressed={mode === "cashflow"}
              onClick={() => setSearch({ mode: "cashflow" })}
              className={pill(mode === "cashflow")}
            >
              Cash flow
            </button>
            <button
              type="button"
              aria-pressed={mode === "networth"}
              onClick={() => setSearch({ mode: "networth" })}
              className={pill(mode === "networth")}
            >
              Net worth
            </button>
          </fieldset>

          {mode === "cashflow" ? (
            <fieldset className={SEGMENT} aria-label="Forecast horizon">
              <legend className="sr-only">Forecast horizon</legend>
              {MONTHS.map((months) => (
                <button
                  key={months}
                  type="button"
                  aria-pressed={horizon === months}
                  onClick={() => setSearch({ horizon: String(months) as "3" | "6" | "12" })}
                  className={pill(horizon === months)}
                >
                  {months} months
                </button>
              ))}
            </fieldset>
          ) : (
            <fieldset className={SEGMENT} aria-label="Forecast horizon">
              <legend className="sr-only">Forecast horizon</legend>
              {YEARS.map((y) => (
                <button
                  key={y}
                  type="button"
                  aria-pressed={years === y}
                  onClick={() => setSearch({ years: String(y) as "1" | "2" | "5" | "10" })}
                  className={pill(years === y)}
                >
                  {y} {y === 1 ? "yr" : "yrs"}
                </button>
              ))}
            </fieldset>
          )}
        </div>
      </div>

      {mode === "cashflow" ? (
        <>
          {cashFlow.isPending ? <p className="text-muted-foreground">Loading forecast…</p> : null}
          {cashFlow.isError ? (
            <p role="alert" className="text-destructive">
              The forecast is currently unavailable. Please reload to try again.
            </p>
          ) : null}

          {report !== undefined && report.warnings.length > 0 ? (
            <ul className="space-y-2" aria-label="Low-balance warnings">
              {report.warnings.map((w) => (
                <li
                  key={`${w.accountId}-${w.date}`}
                  data-testid="forecast-warning"
                  className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
                >
                  <span className="font-semibold">{w.accountName}</span> could dip to{" "}
                  <span className="font-semibold">{formatCents(w.cents)}</span> on{" "}
                  {shortDayLabel(w.date)}.
                </li>
              ))}
            </ul>
          ) : null}

          {report !== undefined ? (
            <div className="rounded-xl border border-border bg-card p-4">
              {cashflowView === "chart" ? (
                <ForecastCashFlowChart
                  accounts={report.accounts}
                  warnings={report.warnings}
                  horizonMonths={report.horizonMonths}
                />
              ) : (
                <ForecastCashFlowTable accounts={report.accounts} />
              )}
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => setCashflowView(cashflowView === "chart" ? "table" : "chart")}
                  className="text-primary text-sm font-semibold hover:underline cursor-pointer"
                  data-testid="cashflow-view-toggle"
                >
                  {cashflowView === "chart" ? "View as table" : "View as chart"}
                </button>
              </div>
            </div>
          ) : null}

          {report !== undefined ? (
            <ForecastContextChips
              pay={paySource}
              bills={billsSource}
              budgets={budgetsSource}
              thresholds={{
                state: "ready",
                value: report.accounts.map((account) => ({
                  name: account.name,
                  thresholdCents: account.lowBalanceThresholdCents,
                })),
              }}
            />
          ) : null}
        </>
      ) : null}

      {mode === "networth" ? (
        <>
          {netWorth.isPending ? (
            <p className="text-muted-foreground">Loading net worth projection…</p>
          ) : null}
          {netWorth.isError ? (
            <p role="alert" className="text-destructive">
              The net worth projection is currently unavailable. Please reload to try again.
            </p>
          ) : null}

          {projection !== undefined && figures !== null ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="pb-2">
                <h3 className="text-base font-semibold">
                  Where will we be in {years} {pluralYears(years)}?
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {`Starting from today’s ${figures.today}. Estimates, not advice.`}
                </p>
              </div>

              <div className="mb-4" data-testid="forecast-networth-headline">
                <div className="text-xs text-muted-foreground font-medium">
                  {`In ${years} ${pluralYears(years)}`}
                </div>
                <div className="mt-1 text-3xl font-semibold tabular-nums text-primary">
                  {`about ${figures.mid}`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {`mid estimate · low ${figures.low} · high ${figures.high}`}
                </div>
              </div>

              {networthView === "chart" ? (
                <ForecastNetWorthChart report={projection} years={years} />
              ) : (
                <ForecastNetWorthTable report={projection} />
              )}
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => setNetworthView(networthView === "chart" ? "table" : "chart")}
                  className="text-primary text-sm font-semibold hover:underline cursor-pointer"
                  data-testid="networth-view-toggle"
                >
                  {networthView === "chart" ? "View as table" : "View as chart"}
                </button>
              </div>
            </div>
          ) : null}

          {assumptions.isError ? (
            <p role="alert" className="text-destructive">
              The forecast assumptions are currently unavailable. Please reload to try again.
            </p>
          ) : null}

          {assumptions.data !== undefined ? (
            <AssumptionChips assumptions={assumptions.data} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
