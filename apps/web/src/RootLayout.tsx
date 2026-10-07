import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { fetchMe } from "./api.ts";
import { authClient, authMessage } from "./auth-client.ts";
import { HealthStatus } from "./components/HealthStatus.tsx";
import { Button } from "./components/ui/button.tsx";
import { EnrolView } from "./EnrolView.tsx";
import { LoginView } from "./LoginView.tsx";
import { InitialRecoveryCodes } from "./RecoveryViews.tsx";
import { oneTimeLink } from "./routes/search.ts";
import { ME_KEY, SessionContext } from "./session.tsx";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/transactions", label: "Transactions" },
  { to: "/accounts", label: "Accounts" },
] as const;

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
  useEffect(() => {
    if (!link.strip) return;
    if (link.token !== "") setToken(link.token);
    if (pathname === "/setup") void navigate({ to: "/setup", search: {}, replace: true });
    else void navigate({ to: "/recover", search: {}, replace: true });
  }, [link.strip, link.token, pathname, navigate]);

  const refresh = async () => {
    await queryClient.invalidateQueries();
  };
  const signedIn = async () => {
    await navigate({ to: "/", replace: true });
    await refresh();
  };
  const signOut = async () => {
    const { error } = await authClient.signOut();
    setSignOutError(error ? authMessage(error) : null);
    // Drop everything cached for the signed-in person, and refetch who is signed in (nobody).
    await queryClient.resetQueries();
  };
  const signedUp = async (password: string) => {
    setNewPassword(password);
    await signedIn();
  };
  const enrolled = async () => {
    setNewPassword(null);
    await refresh();
  };

  const person = me.data ?? null;
  const session = { me: person, signOut, refresh, signedIn, signedUp, token };

  let body: ReactNode;
  let shell = false;
  if (me.isPending) {
    body = <HealthStatus />;
  } else if (me.isError) {
    body = <p role="alert">Could not reach the server. Reload to try again.</p>;
  } else if (pathname === "/recover" && person !== null) {
    // A recovery link opened while someone is signed in here: it is for a signed-out browser.
    body = (
      <section aria-labelledby="recover-signed-in">
        <h2 id="recover-signed-in">Use a recovery link</h2>
        <p>You are signed in as {person.displayName}. To use this recovery link, sign out first.</p>
        <button type="button" onClick={signOut}>
          Sign out and use this link
        </button>
        <button type="button" onClick={() => navigate({ to: "/", replace: true })}>
          Keep me signed in
        </button>
      </section>
    );
  } else if (pathname === "/recover") {
    body = <Outlet />;
  } else if (person !== null && person.enrolment === "incomplete") {
    body = (
      <>
        <EnrolView needs={person.needs} password={newPassword} onDone={enrolled} />
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </>
    );
  } else if (person === null && pathname === "/setup") {
    body = <Outlet />;
  } else if (person === null) {
    body = (
      <>
        <LoginView onSignedIn={signedIn} />
        <HealthStatus />
      </>
    );
  } else if (!person.demo && !person.recoveryCodes.issued) {
    // Enrolment has just completed (for the first time, or again after a reset).
    body = <InitialRecoveryCodes onDone={refresh} />;
  } else if (pathname === "/setup") {
    // A setup link opened by someone already signed in: nothing to set up.
    body = <Navigate to="/" replace />;
  } else {
    shell = true;
    body = <Outlet />;
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
