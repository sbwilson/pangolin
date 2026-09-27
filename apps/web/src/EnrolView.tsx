import { type FormEvent, useState } from "react";
import { authClient, authMessage, totpSecret } from "./auth-client.ts";

type Step = "passkey" | "totp";

/**
 * The enrolment steps a signed-in login still lacks, in order: a passkey, then TOTP. Shown right
 * after sign-up, and again whenever a setup was left unfinished (a reload, or a password-only
 * sign-in later). Steps already done are skipped. `password` is the one just chosen, if the page
 * still has it; otherwise TOTP setup asks for it.
 */
export function EnrolView({
  needs,
  password: knownPassword,
  onDone,
}: {
  needs: readonly Step[];
  password: string | null;
  onDone: () => void;
}) {
  const [passkeyDone, setPasskeyDone] = useState(!needs.includes("passkey"));
  const [password, setPassword] = useState(knownPassword ?? "");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const startTotp = async (withPassword: string) => {
    const { data, error: failed } = await authClient.twoFactor.enable({ password: withPassword });
    if (failed || !data || !("totpURI" in data) || typeof data.totpURI !== "string") {
      setError(authMessage(failed));
      return;
    }
    setPassword("");
    setTotpUri(data.totpURI);
  };

  const addPasskey = () =>
    run(async () => {
      const result = await authClient.passkey.addPasskey();
      if (result?.error) {
        setError(authMessage(result.error));
        return;
      }
      setPasskeyDone(true);
      if (!needs.includes("totp")) onDone();
      else if (password !== "") await startTotp(password);
    });

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    return run(() => startTotp(password));
  };

  const confirmTotp = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const { error: failed } = await authClient.twoFactor.verifyTotp({ code });
      if (failed) setError(authMessage(failed));
      else onDone();
    });
  };

  return (
    <section aria-labelledby="enrol">
      <h2 id="enrol">Finish setting up your sign-in</h2>
      {!passkeyDone ? (
        <>
          <p>Add a passkey: your device's fingerprint, face or PIN.</p>
          <button type="button" onClick={addPasskey} disabled={busy}>
            Add a passkey
          </button>
        </>
      ) : totpUri === null ? (
        <form onSubmit={submitPassword}>
          <p>
            Last, add Pangolin Money to your authenticator app, as a fallback for when you have no
            passkey to hand. Confirm your password to start.
          </p>
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
          <button type="submit" disabled={busy}>
            Set up authenticator
          </button>
        </form>
      ) : (
        <form onSubmit={confirmTotp}>
          <p>Add Pangolin Money to your authenticator app, then enter the code it shows.</p>
          <label>
            Authenticator URI
            <input type="text" readOnly value={totpUri} />
          </label>
          <label>
            Secret key
            <input type="text" readOnly value={totpSecret(totpUri)} />
          </label>
          <label>
            Authenticator code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
            />
          </label>
          <button type="submit" disabled={busy}>
            Finish
          </button>
        </form>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}
