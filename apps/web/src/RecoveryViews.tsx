import { type FormEvent, useState } from "react";
import {
  ApiError,
  issueInitialRecoveryCodes,
  recoverWithCode,
  reEnrol,
  regenerateRecoveryCodes,
} from "./api.ts";

function messageOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : "Something went wrong. Try again.";
}

/**
 * Codes shown once, with a confirmation that they were saved before `onSaved` lets the page
 * move on. They are never shown again.
 */
export function RecoveryCodeList({
  codes,
  onSaved,
}: {
  codes: readonly string[];
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <>
      <p>
        Each code works once. Use one with your email and password if you lose your passkey. Store
        them somewhere safe and offline: this is the only time they are shown.
      </p>
      <ol aria-label="Recovery codes" className="codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <label className="inline">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I
        have saved these codes
      </label>
      <button type="button" onClick={onSaved} disabled={!saved}>
        Continue
      </button>
    </>
  );
}

/** The last enrolment step: the first set of recovery codes, issued and shown once. */
export function InitialRecoveryCodes({ onDone }: { onDone: () => void }) {
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = async () => {
    setBusy(true);
    setError(null);
    try {
      setCodes((await issueInitialRecoveryCodes()).codes);
    } catch (caught) {
      // Already issued (another tab, or a retry): move on to home with fresh state.
      if (caught instanceof ApiError && caught.status === 409) onDone();
      else setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="initial-codes">
      <h2 id="initial-codes">Save your recovery codes</h2>
      {codes === null ? (
        <>
          <p>Your sign-in is set up. Last, save your recovery codes.</p>
          <button type="button" onClick={show} disabled={busy}>
            Show my recovery codes
          </button>
        </>
      ) : (
        <RecoveryCodeList codes={codes} onSaved={onDone} />
      )}
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}

/** Home: replace every unused code with a new set (needs a recent sign-in). */
export function RegenerateRecoveryCodes({
  remaining,
  onSignOut,
  onDone,
}: {
  remaining: number;
  onSignOut: () => void;
  onDone: () => void;
}) {
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      setCodes((await regenerateRecoveryCodes()).codes);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, "Internal", String(caught)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="recovery-codes">
      <h2 id="recovery-codes">Recovery codes</h2>
      {codes === null ? (
        <>
          <p>{remaining} unused recovery codes left.</p>
          {remaining < 3 ? (
            <p className="warning">
              You are running out of recovery codes. Regenerate them to get a new set of 10.
            </p>
          ) : null}
          <button type="button" onClick={regenerate} disabled={busy}>
            Regenerate recovery codes
          </button>
        </>
      ) : (
        <RecoveryCodeList
          codes={codes}
          onSaved={() => {
            setCodes(null);
            onDone();
          }}
        />
      )}
      {error?.code === "ReauthRequired" ? (
        <p role="alert">
          For your security, sign in again to regenerate your codes.{" "}
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

/** Sign-in with a recovery code: email, password and the code; a new passkey follows. */
export function RecoveryCodeLogin({
  onSignedIn,
  onCancel,
}: {
  onSignedIn: () => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { signedIn } = await recoverWithCode({ email, password, code });
      if (signedIn) onSignedIn();
      else setNotSignedIn(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  if (notSignedIn) {
    return (
      <>
        <p role="status">
          Your recovery code was accepted and your old passkeys were removed, but we could not sign
          you in. Sign in with your password and an authenticator code, then add a new passkey.
        </p>
        <button type="button" onClick={onCancel}>
          Back to sign in
        </button>
      </>
    );
  }

  return (
    <form onSubmit={submit}>
      <p>Lost your passkey? Sign in with a recovery code, then add a new passkey.</p>
      <label>
        Email
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Recovery code
        <input
          autoComplete="off"
          spellCheck={false}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
        />
      </label>
      <button type="submit" disabled={busy}>
        Recover
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>
        Back
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </form>
  );
}

/**
 * `/recover?token=…`: a re-enrolment link from the partner (or the server console). `token` was
 * read from the URL once, and the URL no longer carries it. Sets a new password; the app then asks for a new passkey and TOTP. `onReEnrolled` gets the password, kept
 * in memory only, so TOTP setup need not ask again.
 */
export function RecoverView({
  token,
  onReEnrolled,
  onSignInInstead,
}: {
  token: string;
  onReEnrolled: (password: string) => void;
  onSignInInstead: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  if (token === "") {
    return <p role="alert">This page needs the one-time recovery link you were given.</p>;
  }
  if (notSignedIn) {
    return (
      <>
        <p role="status">
          Your new password is set, but we could not sign you in. Sign in with your email and new
          password to finish setting up.
        </p>
        <button type="button" onClick={onSignInInstead}>
          Go to sign in
        </button>
      </>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { signedIn } = await reEnrol({ token, newPassword: password });
      if (signedIn) onReEnrolled(password);
      else setNotSignedIn(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="recover">
      <h2 id="recover">Reset your sign-in</h2>
      <p>
        Choose a new password. You will then add a new passkey and set up your authenticator app
        again.
      </p>
      <form onSubmit={submit}>
        <label>
          New password (at least 12 characters)
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          Set new password
        </button>
      </form>
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}
