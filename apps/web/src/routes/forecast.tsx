import { createRoute } from "@tanstack/react-router";
import { ForecastPage } from "../pages/ForecastPage.tsx";
import { rootRoute } from "./root.tsx";
import { validateForecastSearch } from "./search.ts";

/** `/planning/forecast`: the read-only cash-flow projection; the horizon lives in the URL. */
export const forecastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/planning/forecast",
  validateSearch: validateForecastSearch,
  component: ForecastPage,
});
