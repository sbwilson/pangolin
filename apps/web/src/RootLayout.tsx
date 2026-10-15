import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { fetchMe, type Me } from "./api.ts";
import { authClient, authMessage } from "./auth-client.ts";
import { HealthStatus } from "./components/HealthStatus.tsx";
import { Button } from "./components/ui/button.tsx";
import { EnrolView } from "./EnrolView.tsx";
import { LoginView } from "./LoginView.tsx";
import { InitialRecoveryCodes } from "./RecoveryViews.tsx";
import { normalizePath, oneTimeLink } from "./routes/search.ts";
import { ME_KEY, SessionContext } from "./session.tsx";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/transactions", label: "Transactions" },
  { to: "/accounts", label: "Accounts" },
] as const;

export type Gate =
  | "pending"
  | "error"
  | "recover-signed-in"
  | "recover"
  | "enrol"
  | "setup"
  | "login"
  | "recovery-codes"
  | "setup-signed-in"
  | "app";

export interface GateState {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly data?: Me | null | undefined;
}

/** Pure gate precedence selection based on `me` query state and route pathname. */
export function selectGate(me: GateState, pathname: string): Gate {
  const person = me.data ?? null;
  const path = normalizePath(pathname);
  if (me.isPending) return "pending";
  if (me.isError) return "error";
  if (path === "/recover" && person !== null) return "recover-signed-in";
  if (path === "/recover") return "recover";
  if (person !== null && person.enrolment === "incomplete") return "enrol";
  if (person === null && path === "/setup") return "setup";
  if (person === null) return "login";
  if (!person.demo && !person.recoveryCodes.issued) return "recovery-codes";
  if (path === "/setup") return "setup-signed-in";
  return "app";
}

/**
 * The root layout: the `me` state machine. The gates (loading, error, enrolment incomplete,
 * first recovery codes, a signed-out person) are guards here and never enter the URL. The outlet
 * renders only for a signed-in person with enrolment complete, except the signed-out pages
 * (`/setup`, `/recover`), which are the outlet for nobody signed in.
 */
export function RootLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false });
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // The password just chosen at sign-up, in memory only, so TOTP setup need not ask again.
  const [newPassword, setNewPassword] = useState<string | null>(null);

  // A one-time link's token: typed by the route's `validateSearch`, read once into state (only on
  // /setup and /recover), then any search is dropped from the URL with a replace so the token
  // never stays in the history.
  const search = useLocation({ select: (location) => location.search });
  const link = oneTimeLink(pathname, search);
  const [token, setToken] = useState(link.token);
  const normalizedPath = normalizePath(pathname);
  useEffect(() => {
    if (!link.strip) return;
    if (link.token !== "") setToken(link.token);
    if (normalizedPath === "/setup") void navigate({ to: "/setup", search: {}, replace: true });
    else void navigate({ to: "/recover", search: {}, replace: true });
  }, [link.strip, link.token, normalizedPath, navigate]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);
  const signedIn = useCallback(async () => {
    await navigate({ to: "/", replace: true });
    await refresh();
  }, [navigate, refresh]);
  const signOut = useCallback(async () => {
    const { error } = await authClient.signOut();
    setSignOutError(error ? authMessage(error) : null);
    // Drop everything cached for the signed-in person, and refetch who is signed in (nobody).
    await queryClient.resetQueries();
  }, [queryClient]);
  const signedUp = useCallback(
    async (password: string) => {
      setNewPassword(password);
      await signedIn();
    },
    [signedIn],
  );
  const enrolled = useCallback(async () => {
    setNewPassword(null);
    await refresh();
  }, [refresh]);

  const person = me.data ?? null;
  const session = useMemo(
    () => ({ me: person, signOut, refresh, signedIn, signedUp, token }),
    [person, signOut, refresh, signedIn, signedUp, token],
  );

  const gate = selectGate(me, pathname);
  let body: ReactNode;
  let shell = false;
  switch (gate) {
    case "pending":
      body = <HealthStatus />;
      break;
    case "error":
      body = <p role="alert">Could not reach the server. Reload to try again.</p>;
      break;
    case "recover-signed-in":
      body = (
        <section aria-labelledby="recover-signed-in">
          <h2 id="recover-signed-in">Use a recovery link</h2>
          <p>
            You are signed in as {person?.displayName}. To use this recovery link, sign out first.
          </p>
          <button type="button" onClick={signOut}>
            Sign out and use this link
          </button>
          <button type="button" onClick={() => navigate({ to: "/", replace: true })}>
            Keep me signed in
          </button>
        </section>
      );
      break;
    case "recover":
      body = <Outlet />;
      break;
    case "enrol":
      body = (
        <>
          <EnrolView needs={person?.needs ?? []} password={newPassword} onDone={enrolled} />
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </>
      );
      break;
    case "setup":
      body = <Outlet />;
      break;
    case "login":
      body = (
        <>
          <LoginView onSignedIn={signedIn} />
          <HealthStatus />
        </>
      );
      break;
    case "recovery-codes":
      body = <InitialRecoveryCodes onDone={refresh} />;
      break;
    case "setup-signed-in":
      body = <Navigate to="/" replace />;
      break;
    case "app":
      shell = true;
      body = <Outlet />;
      break;
  }

  return (
    <SessionContext.Provider value={session}>
      <div className="min-h-screen md:flex">
        {shell ? (
          <aside className="border-b bg-sidebar p-3 md:w-52 md:shrink-0 md:border-r md:border-b-0">
            <nav aria-label="Main" className="flex gap-1 md:flex-col">
              {NAV.map((item) => (
                <Button key={item.to} asChild variant="ghost" className="justify-start">
                  <Link
                    to={item.to}
                    replace
                    activeOptions={{ exact: item.to === "/" }}
                    activeProps={{ className: "bg-accent" }}
                  >
                    {item.label}
                  </Link>
                </Button>
              ))}
            </nav>
          </aside>
        ) : null}
        <main className="mx-auto w-full max-w-3xl p-4">
          <h1>Pangolin Money</h1>
          {signOutError === null ? null : <p role="alert">{signOutError}</p>}
          {body}
        </main>
      </div>
    </SessionContext.Provider>
  );
}
