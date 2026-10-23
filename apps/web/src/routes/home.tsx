import { createRoute, Navigate, redirect } from "@tanstack/react-router";
import { rootRoute } from "./root.tsx";

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/cash-flow", replace: true });
  },
  component: () => <Navigate to="/cash-flow" replace />,
});
