import { type FormEvent, useState } from "react";
import { authClient, authMessage } from "./auth-client.ts";
import { Button } from "./components/ui/button.tsx";
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

  const errorBanner =
    error === null ? null : (
      <div
        role="status"
        className="mb-4 flex items-center gap-2.5 rounded-lg bg-[var(--warning-bg,#fef3c7)] px-3 py-2 text-sm text-[var(--warning,#8a5600)]"
      >
        <b
          className="flex size-4.5 shrink-0 items-center justify-center rounded-full border border-current text-xs"
          aria-hidden="true"
        >
          !
        </b>
        <span>{error}</span>
      </div>
    );

  return (
    <section
      aria-labelledby={step === "recovery" ? undefined : "sign-in-heading"}
      aria-label={step === "recovery" ? "Sign in" : undefined}
      className="w-[380px] max-w-full rounded-xl border bg-card p-6 shadow-sm"
    >
      {step === "choose" ? (
        <>
          <h1 id="sign-in-heading" className="m-0 text-xl font-semibold">
            Sign in
          </h1>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">Use the passkey on this device.</p>
          {errorBanner}
          <Button
            type="button"
            onClick={withPasskey}
            disabled={busy}
            className="w-full justify-center py-2.5 font-semibold"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="8" cy="15" r="4" />
              <path d="M11 12l9-9M17 6l3 3M15 8l2 2" />
            </svg>
            Sign in with a passkey
          </Button>
          <div className="mt-3.5 text-center">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("password");
              }}
              disabled={busy}
              className="text-sm font-semibold text-primary hover:underline"
            >
              Use password instead
            </button>
          </div>
          <div className="mt-4 border-t border-border pt-3 text-center text-xs text-muted-foreground">
            Lost your passkey?{" "}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("recovery");
              }}
              disabled={busy}
              className="font-semibold text-primary hover:underline"
            >
              Use a recovery code
            </button>
          </div>
        </>
      ) : null}

      {step === "recovery" ? (
        <RecoveryCodeLogin
          onSignedIn={onSignedIn}
          onCancel={() => {
            setError(null);
            setStep("choose");
          }}
        />
      ) : null}

      {step === "password" ? (
        <>
          <h1 id="sign-in-heading" className="m-0 text-xl font-semibold">
            Sign in with your password
          </h1>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            You&apos;ll need your authenticator code next.
          </p>
          {errorBanner}
          <form onSubmit={withPassword} className="space-y-3">
            <label className="block text-sm font-semibold">
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block text-sm font-semibold">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <Button type="submit" disabled={busy} className="w-full justify-center font-semibold">
              Continue
            </Button>
            <div className="mt-3.5 text-center">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("choose");
                }}
                disabled={busy}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Use a passkey instead
              </button>
            </div>
          </form>
        </>
      ) : null}

      {step === "totp" ? (
        <>
          <h1 id="sign-in-heading" className="m-0 text-xl font-semibold">
            Enter your code
          </h1>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Open your authenticator app and type the 6-digit code for Pangolin.
          </p>
          {errorBanner}
          <form onSubmit={withCode} className="space-y-3">
            <label className="block text-sm font-semibold">
              Authenticator code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-center text-lg tracking-[0.35em] text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <Button type="submit" disabled={busy} className="w-full justify-center font-semibold">
              Sign in
            </Button>
            <div className="mt-3.5 text-center">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("password");
                }}
                disabled={busy}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Back
              </button>
            </div>
            <div className="mt-4 border-t border-border pt-3 text-center text-xs text-muted-foreground">
              Lost your passkey?{" "}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("recovery");
                }}
                disabled={busy}
                className="font-semibold text-primary hover:underline"
              >
                Use a recovery code
              </button>
            </div>
          </form>
        </>
      ) : null}
    </section>
  );
}
