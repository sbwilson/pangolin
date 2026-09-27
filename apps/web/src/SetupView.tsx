import { type FormEvent, useState } from "react";
import { ApiError, signUp } from "./api.ts";

/**
 * First sign-in from a one-time setup link: the account (email, password, name, colour). The
 * app then shows `EnrolView` for the passkey and TOTP, in the session sign-up starts.
 * `onSignedUp` gets the password, kept in memory only, so TOTP setup need not ask again.
 */
export function SetupView({ onSignedUp }: { onSignedUp: (password: string) => void }) {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [colour, setColour] = useState("#2563eb");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (token === "") {
    return <p role="alert">This page needs the one-time setup link you were given.</p>;
  }

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signUp({ token, email, password, displayName, colour });
      onSignedUp(password);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="setup">
      <h2 id="setup">Set up your sign-in</h2>
      <form onSubmit={createAccount}>
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
          Password (at least 12 characters)
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
          Display name
          <input
            required
            maxLength={100}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label>
          Colour
          <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>
          Create account
        </button>
      </form>
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}
