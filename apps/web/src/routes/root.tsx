import { createRootRoute, Navigate } from "@tanstack/react-router";
import { RootLayout } from "../RootLayout.tsx";

/** The layout every page renders inside; later pages add a route whose parent is this one. */
export const rootRoute = createRootRoute({
  component: RootLayout,
  // An unknown path shows Home, as the hand-rolled router did.
  notFoundComponent: () => <Navigate to="/" replace />,
});
