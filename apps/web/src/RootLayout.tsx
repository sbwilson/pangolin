import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils.ts";
import { fetchMe, type Me } from "./api.ts";
import { authClient, authMessage } from "./auth-client.ts";
import { AppSidebar } from "./components/AppSidebar.tsx";
import { HealthStatus } from "./components/HealthStatus.tsx";
import { MascotIcon } from "./components/MascotLogo.tsx";
import { MobileNav } from "./components/MobileNav.tsx";
import { EnrolView } from "./EnrolView.tsx";
import { InitialRecoveryCodes } from "./RecoveryViews.tsx";
import { normalizePath, oneTimeLink } from "./routes/search.ts";
import { ME_KEY, SessionContext } from "./session.tsx";

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
  | "sign-in"
  | "sign-in-signed-in"
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
  if (person === null && path === "/sign-in") return "sign-in";
  if (person === null) return "login";
  if (!person.demo && !person.recoveryCodes.issued) return "recovery-codes";
  if (path === "/setup") return "setup-signed-in";
  if (path === "/sign-in") return "sign-in-signed-in";
  return "app";
}

/**
 * The root layout: the `me` state machine. Responsive shell layout with desktop sidebar
 * and mobile bottom tab bar reaching shipped routes.
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
    await refresh();
    await navigate({ to: "/transactions", replace: true });
  }, [navigate, refresh]);
  const signOut = useCallback(async () => {
    const { error } = await authClient.signOut();
    setSignOutError(error ? authMessage(error) : null);
    // Drop everything cached for the signed-in person, and refetch who is signed in (nobody).
    await queryClient.resetQueries();
    await navigate({ to: "/sign-in", replace: true });
  }, [navigate, queryClient]);
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
          <button
            type="button"
            onClick={() => void navigate({ to: "/transactions", replace: true })}
          >
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
    case "sign-in":
      body = <Outlet />;
      break;
    case "login":
      body = <Navigate to="/sign-in" replace />;
      break;
    case "recovery-codes":
      body = <InitialRecoveryCodes onDone={refresh} />;
      break;
    case "setup-signed-in":
      body = <Navigate to="/transactions" replace />;
      break;
    case "sign-in-signed-in":
      body = <Navigate to="/transactions" replace />;
      break;
    case "app":
      shell = true;
      body = <Outlet />;
      break;
  }

  return (
    <SessionContext.Provider value={session}>
      <div className="min-h-screen md:flex">
        {shell && person ? <AppSidebar me={person} signOut={signOut} /> : null}
        <div className={cn("flex min-w-0 flex-1 flex-col", shell && "pb-16 md:pb-0")}>
          {shell && person ? (
            <header className="border-b bg-card px-4 py-3 md:hidden">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MascotIcon size="sm" />
                <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0" aria-hidden="true">
                  <circle cx="4" cy="4" r="4" fill={person.colour || "currentColor"} />
                </svg>
                <span>G&apos;day, {person.displayName}</span>
              </div>
            </header>
          ) : null}
          <main className={cn("mx-auto w-full", shell ? "max-w-5xl p-4" : "p-4")}>
            {shell && person ? (
              <header className="mb-4">
                <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
                  <MascotIcon size="sm" />
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    className="shrink-0"
                    aria-hidden="true"
                  >
                    <circle cx="4" cy="4" r="4" fill={person.colour || "currentColor"} />
                  </svg>
                  <span>G&apos;day, {person.displayName}</span>
                </div>
                <h1 className="mt-1 text-xl font-bold">Pangolin Money</h1>
              </header>
            ) : null}
            {signOutError === null ? null : (
              <p role="alert" className="mb-4 text-sm text-destructive">
                {signOutError}
              </p>
            )}
            {body}
          </main>
        </div>
        {shell && person ? <MobileNav me={person} signOut={signOut} /> : null}
      </div>
    </SessionContext.Provider>
  );
}
