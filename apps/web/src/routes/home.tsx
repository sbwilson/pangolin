import { createRoute } from "@tanstack/react-router";
import { HomePage } from "../pages/HomePage.tsx";
import { rootRoute } from "./root.tsx";

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
