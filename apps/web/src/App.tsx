import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { ApiError, fetchDeadJobs, fetchHealth, fetchMe, invitePartner, type Me } from "./api.ts";
import { authClient, authMessage } from "./auth-client.ts";
import { EnrolView } from "./EnrolView.tsx";
import { LoginView } from "./LoginView.tsx";
import { SetupView } from "./SetupView.tsx";

const ME_KEY = ["identity", "me"] as const;

/** A tiny router: the path, updated on back/forward and by `navigate`. */
function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Replaces the entry, so a used setup link's token does not stay in the history.
  const navigate = (next: string) => {
    window.history.replaceState(null, "", next);
    setPath(next);
  };
  return [path, navigate];
}

function HealthStatus() {
  const health = useQuery({ queryKey: ["system", "health"], queryFn: fetchHealth, retry: false });
  if (health.isPending) return <p>Checking…</p>;
  if (!health.data?.healthy) return <p role="status">Unhealthy</p>;
  return (
    <>
      <p role="status">Healthy</p>
      <p>Schema version {health.data.schemaVersion}</p>
    </>
  );
}

function DeadJobs() {
  const jobs = useQuery({ queryKey: ["system", "jobs"], queryFn: fetchDeadJobs, retry: false });
  if (jobs.isPending) return null;
  if (jobs.isError) return <p>Job status unavailable</p>;
  if (jobs.data.length === 0) return <p>No jobs need attention</p>;
  return (
    <section aria-labelledby="dead-jobs">
      <h2 id="dead-jobs">Jobs that failed</h2>
      <ul>
        {jobs.data.map((job, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a read-only list with no item state; two jobs of one kind can fail in the same millisecond, so kind and time alone collide.
          <li key={`${index}:${job.kind}@${job.failedAt}`}>
            {job.kind} — <time dateTime={job.failedAt}>{job.failedAt}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InvitePartner({ onSignOut }: { onSignOut: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const invite = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink((await invitePartner()).url);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, "Internal", String(caught)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="invite">
      <h2 id="invite">Invite your partner</h2>
      {link === null ? (
        <button type="button" onClick={invite} disabled={busy}>
          Invite partner
        </button>
      ) : (
        <>
          <p>Send this one-time link to your partner. It works once, for 24 hours.</p>
          <label>
            Partner setup link
            <input type="text" readOnly value={link} />
          </label>
        </>
      )}
      {error?.code === "ReauthRequired" ? (
        <p role="alert">
          For your security, sign in again to invite your partner.{" "}
          <button type="button" onClick={onSignOut}>
            Sign in again
          </button>
        </p>
      ) : error !== null ? (
        <p role="alert">{error.message}</p>
      ) : null}
    </section>
  );
}

function Home({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  return (
    <>
      <p>
        Signed in as <strong>{me.displayName}</strong>
        {me.demo ? " (demo)" : null}
      </p>
      <HealthStatus />
      <DeadJobs />
      {me.canInvite && !me.demo ? <InvitePartner onSignOut={onSignOut} /> : null}
      {me.demo ? null : (
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      )}
    </>
  );
}

export function App() {
  const [path, navigate] = usePath();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false });
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // The password just chosen at sign-up, in memory only, so TOTP setup need not ask again.
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries();
  };
  const signedIn = async () => {
    navigate("/");
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

  let body: ReactNode;
  if (me.isPending) {
    body = <HealthStatus />;
  } else if (me.isError) {
    body = <p role="alert">Could not reach the server. Reload to try again.</p>;
  } else if (me.data !== null && me.data.enrolment === "incomplete") {
    body = (
      <>
        <EnrolView needs={me.data.needs} password={newPassword} onDone={enrolled} />
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </>
    );
  } else if (me.data === null && path === "/setup") {
    body = <SetupView onSignedUp={signedUp} />;
  } else if (me.data === null) {
    body = (
      <>
        <LoginView onSignedIn={signedIn} />
        <HealthStatus />
      </>
    );
  } else {
    body = <Home me={me.data} onSignOut={signOut} />;
  }

  return (
    <main>
      <h1>Pangolin Money</h1>
      {signOutError === null ? null : <p role="alert">{signOutError}</p>}
      {body}
    </main>
  );
}
