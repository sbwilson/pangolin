import { createRoute, Navigate, redirect } from "@tanstack/react-router";
import { rootRoute } from "./root.tsx";

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/transactions", replace: true });
  },
  component: () => <Navigate to="/transactions" replace />,
});
