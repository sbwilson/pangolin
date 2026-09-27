import { type FormEvent, useState } from "react";
import { authClient, authMessage } from "./auth-client.ts";
import { RecoveryCodeLogin } from "./RecoveryViews.tsx";

/**
 * Passkey first; the fallback is email and password, then a TOTP code. A lost passkey can be
 * replaced by signing in with email, password and a recovery code.
 */
export function LoginView({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<"choose" | "password" | "totp" | "recovery">("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const withPasskey = () =>
    run(async () => {
      const { error: failed } = await authClient.signIn.passkey();
      if (failed) setError(authMessage(failed));
      else onSignedIn();
    });

  const withPassword = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const { data, error: failed } = await authClient.signIn.email({ email, password });
      if (failed) {
        setError(authMessage(failed));
      } else if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setPassword("");
        setStep("totp");
      } else {
        onSignedIn();
      }
    });
  };

  const withCode = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const { error: failed } = await authClient.twoFactor.verifyTotp({ code });
      if (failed) setError(authMessage(failed));
      else onSignedIn();
    });
  };

  return (
    <section aria-labelledby="sign-in">
      <h2 id="sign-in">Sign in</h2>
      {step === "choose" ? (
        <>
          <button type="button" onClick={withPasskey} disabled={busy}>
            Sign in with a passkey
          </button>
          <button type="button" onClick={() => setStep("password")} disabled={busy}>
            Use password instead
          </button>
          <button type="button" onClick={() => setStep("recovery")} disabled={busy}>
            Use a recovery code
          </button>
        </>
      ) : null}
      {step === "recovery" ? (
        <RecoveryCodeLogin onSignedIn={onSignedIn} onCancel={() => setStep("choose")} />
      ) : null}
      {step === "password" ? (
        <form onSubmit={withPassword}>
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
          <button type="submit" disabled={busy}>
            Continue
          </button>
        </form>
      ) : null}
      {step === "totp" ? (
        <form onSubmit={withCode}>
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
            Sign in
          </button>
        </form>
      ) : null}
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}
