import { createRoute } from "@tanstack/react-router";
import { GoalsPage } from "../pages/GoalsPage.tsx";
import { rootRoute } from "./root.tsx";

/** `/planning/goals`: the goals & savings workspace UI. */
export const goalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/planning/goals",
  component: GoalsPage,
});
