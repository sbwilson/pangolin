/**
 * Forecast display labels. Lives outside the chart modules on purpose: the cash-flow table and
 * the ForecastPage warnings read these, and importing them from a chart module would drag the
 * whole echarts runtime back into the eager entry graph.
 */

/** `2026-07-15` -> `15 Jul`, for sparse daily axis labels. */
export function shortDayLabel(isoDay: string): string {
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][Number(isoDay.slice(5, 7)) - 1];
  return `${Number(isoDay.slice(8, 10))} ${month ?? ""}`.trim();
}
