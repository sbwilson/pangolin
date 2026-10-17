import { createRoute } from "@tanstack/react-router";
import { HealthStatus } from "../components/HealthStatus.tsx";
import { MascotLogo } from "../components/MascotLogo.tsx";
import { LoginView } from "../LoginView.tsx";
import { useSession } from "../session.tsx";
import { rootRoute } from "./root.tsx";

function SignInPage() {
  const { signedIn } = useSession();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="mb-4">
        <MascotLogo size="lg" />
      </div>
      <LoginView onSignedIn={signedIn} />
      <div className="mt-6 text-center text-xs text-muted-foreground">
        <HealthStatus />
      </div>
    </div>
  );
}

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInPage,
});
