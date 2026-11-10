import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { fetchForecast } from "../api.ts";
import { ForecastCashFlowChart, shortDayLabel } from "../components/ForecastCashFlowChart.tsx";
import { formatCents } from "../lib/money.ts";
import { type ForecastSearch, validateForecastSearch } from "../routes/search.ts";

const HORIZONS = [3, 6, 12] as const;
type ForecastHorizon = (typeof HORIZONS)[number];

/**
 * `/planning/forecast`: a read-only projection of each visible transaction account, day by day
 * to the chosen horizon. A dashed line per account; each account projected below its own
 * low-balance threshold gets a callout naming the account, the amount and the date. Nothing here
 * writes to the plan — the whole picture is derived on read.
 */
export function ForecastPage() {
  // The route's search is merged over the raw URL's, so read it through the validator again.
  const rawSearch = useSearch({ from: "/planning/forecast" });
  const search = useMemo(() => validateForecastSearch(rawSearch), [rawSearch]);
  const navigate = useNavigate({ from: "/planning/forecast" });
  const horizon = (search.horizon === undefined ? 3 : Number(search.horizon)) as ForecastHorizon;

  const forecast = useQuery({
    queryKey: ["planning", "forecast", horizon],
    queryFn: () => fetchForecast(horizon),
    retry: false,
  });

  const setHorizon = (next: ForecastHorizon) =>
    void navigate({
      search: { horizon: String(next) as NonNullable<ForecastSearch["horizon"]> },
    });

  const report = forecast.data;

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

        <fieldset
          className="inline-flex rounded-lg border border-border bg-muted p-0.5 m-0 border-0"
          aria-label="Forecast horizon"
        >
          <legend className="sr-only">Forecast horizon</legend>
          {HORIZONS.map((months) => (
            <button
              key={months}
              type="button"
              aria-pressed={horizon === months}
              onClick={() => setHorizon(months)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                horizon === months
                  ? "bg-card text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {months} months
            </button>
          ))}
        </fieldset>
      </div>

      {forecast.isPending ? <p className="text-muted-foreground">Loading forecast…</p> : null}
      {forecast.isError ? (
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
          <ForecastCashFlowChart
            accounts={report.accounts}
            warnings={report.warnings}
            horizonMonths={report.horizonMonths}
          />
        </div>
      ) : null}
    </div>
  );
}
