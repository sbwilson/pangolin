import { createRoute } from "@tanstack/react-router";
import { SetupView } from "../SetupView.tsx";
import { useSession } from "../session.tsx";
import { rootRoute } from "./root.tsx";
import { validateTokenSearch } from "./search.ts";

function SetupPage() {
  const { token, signedUp } = useSession();
  return <SetupView token={token} onSignedUp={signedUp} />;
}

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  validateSearch: validateTokenSearch,
  component: SetupPage,
});
