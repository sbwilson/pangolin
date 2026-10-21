import { createRoute } from "@tanstack/react-router";
import { ReviewPage } from "../pages/ReviewPage.tsx";
import { rootRoute } from "./root.tsx";

/** `/review`: the Needs review inbox, one card per open item. */
export const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: ReviewPage,
});
