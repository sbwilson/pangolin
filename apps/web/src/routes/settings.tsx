import { createRoute } from "@tanstack/react-router";
import { HomePage } from "../pages/HomePage.tsx";
import { rootRoute } from "./root.tsx";

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: HomePage,
});
