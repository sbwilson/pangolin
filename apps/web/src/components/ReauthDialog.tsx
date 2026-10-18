import { type FormEvent, useEffect, useState } from "react";
import { authClient, authMessage } from "../auth-client.ts";
import { Button } from "./ui/button.tsx";

export interface ReauthDialogProps {
  readonly open: boolean;
  readonly action?: string;
  readonly actionDescription?: string;
  readonly onSuccess: () => Promise<void> | void;
  readonly onCancel: () => void;
  readonly onClose?: () => void;
}

export function ReauthDialog({
  open,
  action,
  actionDescription,
  onSuccess,
  onCancel,
  onClose,
}: ReauthDialogProps) {
  const [step, setStep] = useState<"passkey" | "password" | "totp">("passkey");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("passkey");
      setEmail("");
      setPassword("");
      setCode("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const closeDialog = () => {
    (onClose ?? onCancel)();
  };

  const handleAuthSuccess = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSuccess();
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        setError(authMessage(res.error));
        setBusy(false);
        return;
      }
      await handleAuthSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey sign-in failed");
      setBusy(false);
    }
  };

  const handlePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.email({ email, password });
      if (res?.error) {
        setError(authMessage(res.error));
        setBusy(false);
        return;
      }
      if (res?.data && "twoFactorRedirect" in res.data && res.data.twoFactorRedirect) {
        setPassword("");
        setStep("totp");
        setBusy(false);
        return;
      }
      await handleAuthSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  };

  const handleTotp = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res?.error) {
        setError(authMessage(res.error));
        setBusy(false);
        return;
      }
      await handleAuthSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setBusy(false);
    }
  };

  const actionText = action ?? actionDescription ?? "continue";
  const copy = actionText.toLowerCase().startsWith("confirm it's you to")
    ? actionText
    : `Confirm it's you to ${actionText}. Once you're in, the change goes through.`;

  const errorBanner =
    error === null ? null : (
      <div
        role="alert"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close modal backdrop"
        className="fixed inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-xs"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-dialog-title"
        className="relative z-10 w-full max-w-[440px] rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Close"
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="mb-3 flex size-9 items-center justify-center rounded-full border border-border bg-background text-foreground">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>

        <h2 id="reauth-dialog-title" className="mb-1.5 text-[17px] font-semibold text-foreground">
          For your security, sign in again
        </h2>
        <p className="mb-4 text-[13.5px] text-muted-foreground">{copy}</p>

        {errorBanner}

        {step === "passkey" ? (
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2">
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
            <div className="flex items-center gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handlePasskey()}
                disabled={busy}
                className="font-semibold"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="mr-1.5"
                >
                  <circle cx="8" cy="15" r="4" />
                  <path d="M11 12l9-9M17 6l3 3M15 8l2 2" />
                </svg>
                {busy ? "Signing in…" : "Sign in with passkey"}
              </Button>
            </div>
          </div>
        ) : null}

        {step === "password" ? (
          <form onSubmit={(e) => void handlePassword(e)} className="space-y-3">
            <label className="block text-sm font-semibold text-foreground">
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
            <label className="block text-sm font-semibold text-foreground">
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
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("passkey");
                }}
                disabled={busy}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Use passkey instead
              </button>
              <div className="flex items-center gap-2 ml-auto">
                <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy} className="font-semibold">
                  {busy ? "Continuing…" : "Continue"}
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        {step === "totp" ? (
          <form onSubmit={(e) => void handleTotp(e)} className="space-y-3">
            <label className="block text-sm font-semibold text-foreground">
              Authenticator code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                placeholder="123456"
                className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-center text-lg tracking-[0.35em] text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2">
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
              <div className="flex items-center gap-2 ml-auto">
                <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy} className="font-semibold">
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </div>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
