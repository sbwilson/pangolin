import { createRoute, useNavigate } from "@tanstack/react-router";
import { RecoverView } from "../RecoveryViews.tsx";
import { useSession } from "../session.tsx";
import { rootRoute } from "./root.tsx";
import { validateTokenSearch } from "./search.ts";

function RecoverPage() {
  const { token, signedUp } = useSession();
  const navigate = useNavigate();
  return (
    <RecoverView
      token={token}
      onReEnrolled={signedUp}
      onSignInInstead={() => navigate({ to: "/", replace: true })}
    />
  );
}

export const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recover",
  validateSearch: validateTokenSearch,
  component: RecoverPage,
});
