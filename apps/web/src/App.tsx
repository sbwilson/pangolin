import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import {
  ApiError,
  type BackupVerification,
  dismissNotice,
  fetchBackupStatus,
  fetchDeadJobs,
  fetchHealth,
  fetchMe,
  fetchNotices,
  fetchRecoveryBundle,
  fetchTransactions,
  invitePartner,
  type Me,
  type Notice,
  resetPartner,
  revokeMyRecoveryLinks,
} from "./api.ts";
import { authClient, authMessage } from "./auth-client.ts";
import { EnrolView } from "./EnrolView.tsx";
import { LoginView } from "./LoginView.tsx";
import { InitialRecoveryCodes, RecoverView, RegenerateRecoveryCodes } from "./RecoveryViews.tsx";
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

/** The last backup: its time and restic snapshot ID, or why there is none. */
function LastBackup() {
  const backup = useQuery({
    queryKey: ["system", "backup"],
    queryFn: fetchBackupStatus,
    retry: false,
  });
  if (backup.isPending) return null;
  if (backup.isError) return <p>Backup status unavailable</p>;
  const { configured, last, stale, check, drill } = backup.data;
  if (!configured) return <p>Backups not configured</p>;
  return (
    <>
      {last === null ? (
        <p>No backup yet</p>
      ) : (
        <p>
          Last backup <time dateTime={last.pushedAt}>{last.pushedAt}</time> (snapshot{" "}
          <code title={last.snapshotId}>{last.snapshotId.slice(0, 8)}</code>)
        </p>
      )}
      {stale ? <p role="alert">Warning: no good backup in the last 48 hours</p> : null}
      <Verification label="Repository check" none="No repository check yet" result={check} />
      <Verification label="Restore drill" none="No restore drill yet" result={drill} />
    </>
  );
}

/** The recovery bundle's warning, shown until its safe storage is confirmed. */
function RecoveryBundle() {
  const bundle = useQuery({
    queryKey: ["system", "recovery-bundle"],
    queryFn: fetchRecoveryBundle,
    retry: false,
  });
  if (bundle.isPending || bundle.isError || bundle.data.confirmed) return null;
  const { bundleId } = bundle.data;
  return (
    <p role="alert">
      Warning: the recovery bundle
      {bundleId === undefined ? null : (
        <>
          {" "}
          <code>{bundleId}</code>
        </>
      )}{" "}
      is not confirmed stored safely. Store it offline, then run{" "}
      <code>sudo pangolin confirm-bundle</code> on the server.
    </p>
  );
}

/** One check or drill result: when it ran, and whether it passed or what failed. */
function Verification({
  label,
  none,
  result,
}: {
  label: string;
  none: string;
  result: BackupVerification | null;
}) {
  if (result === null) return <p>{none}</p>;
  return (
    <p role={result.ok ? undefined : "alert"}>
      {label} {result.ok ? "passed" : "failed"} <time dateTime={result.at}>{result.at}</time>:{" "}
      {result.summary}
    </p>
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

function ResetPartner({
  partner,
  onSignOut,
}: {
  partner: NonNullable<Me["partner"]>;
  onSignOut: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink((await resetPartner(partner.personId)).url);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, "Internal", String(caught)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="reset-partner">
      <h2 id="reset-partner">Help {partner.displayName} back in</h2>
      {link === null ? (
        <>
          <p>
            If {partner.displayName} has lost their passkey and password, give them a one-time link
            to set up their sign-in again. They will be told in the app that you did this.
          </p>
          <button type="button" onClick={reset} disabled={busy}>
            Reset partner's access
          </button>
        </>
      ) : (
        <>
          <p>
            Give this link to {partner.displayName} yourself. It works once, for 24 hours, and is
            not shown again.
          </p>
          <label>
            Partner recovery link
            <input type="text" readOnly value={link} />
          </label>
        </>
      )}
      {error?.code === "ReauthRequired" ? (
        <p role="alert">
          For your security, sign in again to reset your partner's access.{" "}
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

const NOTICES_KEY = ["identity", "notices"] as const;

function noticeText(notice: Notice): string {
  const on = notice.createdAt.slice(0, 10);
  if (notice.kind === "identity.partner-reset") {
    return `A one-time recovery link for your account was issued on ${on} by ${notice.issuedBy ?? "someone"}. If you didn't ask for this, revoke it.`;
  }
  if (notice.kind === "identity.recovery-code-used") {
    return `One of your recovery codes was used to sign in on ${on}, and your passkeys were removed. If this wasn't you, reset your password and tell your partner.`;
  }
  return notice.kind;
}

function Notices() {
  const queryClient = useQueryClient();
  const notices = useQuery({ queryKey: NOTICES_KEY, queryFn: fetchNotices, retry: false });
  const [error, setError] = useState<string | null>(null);
  if (notices.isPending || notices.isError || notices.data.length === 0) return null;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    }
    await queryClient.invalidateQueries({ queryKey: NOTICES_KEY });
  };

  return (
    <section aria-labelledby="notices">
      <h2 id="notices">Notices</h2>
      <ul>
        {notices.data.map((notice) => (
          <li key={notice.id}>
            <p>
              <time dateTime={notice.createdAt}>{notice.createdAt}</time>: {noticeText(notice)}
            </p>
            {notice.kind === "identity.partner-reset" ? (
              <button type="button" onClick={() => act(revokeMyRecoveryLinks)}>
                Revoke the recovery link
              </button>
            ) : null}
            <button type="button" onClick={() => act(() => dismissNotice(notice.id))}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}

const MONEY = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

/** The transactions the signed-in person may see: shared accounts and their own private ones. */
function LedgerView({ onBack }: { onBack: () => void }) {
  const ledger = useQuery({
    queryKey: ["ledger", "transactions"],
    queryFn: fetchTransactions,
    retry: false,
  });
  return (
    <section aria-labelledby="ledger">
      <h2 id="ledger">Transactions</h2>
      {ledger.isPending ? <p>Loading…</p> : null}
      {ledger.isError ? <p role="alert">Transactions unavailable</p> : null}
      {ledger.data === undefined ? null : ledger.data.length === 0 ? (
        <p>No transactions yet</p>
      ) : (
        <table aria-labelledby="ledger">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Description</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {ledger.data.map((txn) => (
              <tr key={txn.id}>
                <td>
                  <time dateTime={txn.postedOn}>{txn.postedOn}</time>
                </td>
                <td>{txn.descriptionRaw}</td>
                <td>{MONEY.format(txn.amountCents / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" onClick={onBack}>
        Back
      </button>
    </section>
  );
}

function Home({
  me,
  onSignOut,
  onChanged,
  onLedger,
}: {
  onLedger: () => void;
  me: Me;
  onSignOut: () => void;
  onChanged: () => void;
}) {
  return (
    <>
      <p>
        Signed in as <strong>{me.displayName}</strong>
        {me.demo ? " (demo)" : null}
      </p>
      <Notices />
      <button type="button" onClick={onLedger}>
        Transactions
      </button>
      <HealthStatus />
      <LastBackup />
      <RecoveryBundle />
      <DeadJobs />
      {me.canInvite && !me.demo ? <InvitePartner onSignOut={onSignOut} /> : null}
      {me.demo ? null : (
        <RegenerateRecoveryCodes
          remaining={me.recoveryCodes.remaining}
          onSignOut={onSignOut}
          onDone={onChanged}
        />
      )}
      {me.partner !== null && !me.demo ? (
        <ResetPartner partner={me.partner} onSignOut={onSignOut} />
      ) : null}
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
  // A recovery link's token, read from the URL once; the URL (and history) then drops it.
  const [recoverToken] = useState(() =>
    window.location.pathname === "/recover"
      ? (new URLSearchParams(window.location.search).get("token") ?? "")
      : "",
  );
  useEffect(() => {
    if (window.location.pathname === "/recover" && window.location.search !== "") {
      window.history.replaceState(null, "", "/recover");
    }
  }, []);

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
  } else if (path === "/recover" && me.data !== null) {
    // A recovery link opened while someone is signed in here: it is for a signed-out browser.
    body = (
      <section aria-labelledby="recover-signed-in">
        <h2 id="recover-signed-in">Use a recovery link</h2>
        <p>
          You are signed in as {me.data.displayName}. To use this recovery link, sign out first.
        </p>
        <button type="button" onClick={signOut}>
          Sign out and use this link
        </button>
        <button type="button" onClick={() => navigate("/")}>
          Keep me signed in
        </button>
      </section>
    );
  } else if (path === "/recover") {
    // The new password stays in memory so TOTP setup need not ask for it again.
    body = (
      <RecoverView
        token={recoverToken}
        onReEnrolled={signedUp}
        onSignInInstead={() => navigate("/")}
      />
    );
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
  } else if (!me.data.demo && !me.data.recoveryCodes.issued) {
    // Enrolment has just completed (for the first time, or again after a reset).
    body = <InitialRecoveryCodes onDone={refresh} />;
  } else if (path === "/ledger") {
    body = <LedgerView onBack={() => navigate("/")} />;
  } else {
    body = (
      <Home
        me={me.data}
        onSignOut={signOut}
        onChanged={refresh}
        onLedger={() => navigate("/ledger")}
      />
    );
  }

  return (
    <main>
      <h1>Pangolin Money</h1>
      {signOutError === null ? null : <p role="alert">{signOutError}</p>}
      {body}
    </main>
  );
}
