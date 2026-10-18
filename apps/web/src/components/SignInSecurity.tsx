import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, regenerateRecoveryCodes } from "../api.ts";
import { authClient, authMessage } from "../auth-client.ts";
import { Button } from "../components/ui/button.tsx";
import { RecoveryCodeList } from "../RecoveryViews.tsx";
import { useSignedIn } from "../session.tsx";

export interface PasskeyItem {
  readonly id: string;
  readonly name?: string;
  readonly createdAt?: Date | string;
  readonly deviceType?: string;
  readonly backedUp?: boolean;
}

function formatDate(dateValue?: Date | string | null): string {
  if (!dateValue) return "recently";
  try {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return String(dateValue);
    return d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(dateValue);
  }
}

interface PasskeyErrorState {
  readonly message: string;
  readonly isReauth: boolean;
}

function isReauthError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof ApiError && err.code === "ReauthRequired") return true;
  if (typeof err === "object") {
    if ("code" in err && (err as { code?: unknown }).code === "ReauthRequired") return true;
    if (
      "status" in err &&
      ((err as { status?: unknown }).status === 401 || (err as { status?: unknown }).status === 403)
    )
      return true;
    if (
      "message" in err &&
      typeof (err as { message?: unknown }).message === "string" &&
      (err as { message: string }).message.includes("ReauthRequired")
    )
      return true;
  }
  return false;
}

export function SignInSecurity() {
  const queryClient = useQueryClient();
  const { me, signOut, refresh } = useSignedIn();

  const [passkeyError, setPasskeyError] = useState<PasskeyErrorState | null>(null);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Recovery codes regeneration state
  const [newCodes, setNewCodes] = useState<readonly string[] | null>(null);
  const [recoveryError, setRecoveryError] = useState<ApiError | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const passkeysQuery = useQuery({
    queryKey: ["auth", "passkeys"],
    queryFn: async (): Promise<readonly PasskeyItem[]> => {
      if (!authClient.$fetch) {
        return [];
      }
      const res = await authClient.$fetch<
        { data?: PasskeyItem[]; error?: { message?: string } } | PasskeyItem[]
      >("/passkey/list-user-passkeys");
      if (res && typeof res === "object" && "error" in res && res.error) {
        throw new Error(res.error.message ?? "Failed to load passkeys");
      }
      if (Array.isArray(res)) {
        return res;
      }
      if (res && typeof res === "object" && "data" in res && Array.isArray(res.data)) {
        return res.data;
      }
      return [];
    },
    retry: false,
  });

  const handleAddPasskey = async () => {
    setIsAddingPasskey(true);
    setPasskeyError(null);
    try {
      if (!authClient.passkey?.addPasskey) {
        throw new Error("Passkey addition is not supported");
      }
      const res = await authClient.passkey.addPasskey();
      if (res?.error) {
        setPasskeyError({
          message: authMessage(res.error),
          isReauth: isReauthError(res.error),
        });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["auth", "passkeys"] });
        await refresh();
      }
    } catch (caught) {
      setPasskeyError({
        message: caught instanceof Error ? caught.message : "Failed to add passkey",
        isReauth: isReauthError(caught),
      });
    } finally {
      setIsAddingPasskey(false);
    }
  };

  const handleRemovePasskey = async (id: string) => {
    setRemovingId(id);
    setPasskeyError(null);
    try {
      if (!authClient.$fetch) {
        throw new Error("Passkey deletion is not supported");
      }
      const res = await authClient.$fetch<{
        error?: { message?: string; code?: string; status?: number };
      }>("/passkey/delete-passkey", {
        method: "POST",
        body: { id },
      });
      if (res?.error) {
        setPasskeyError({
          message: res.error.message ?? "Failed to remove passkey",
          isReauth: isReauthError(res.error),
        });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["auth", "passkeys"] });
        await refresh();
      }
    } catch (caught) {
      setPasskeyError({
        message: caught instanceof Error ? caught.message : "Failed to remove passkey",
        isReauth: isReauthError(caught),
      });
    } finally {
      setRemovingId(null);
    }
  };

  const handleRegenerateCodes = async () => {
    setIsRegenerating(true);
    setRecoveryError(null);
    try {
      const { codes } = await regenerateRecoveryCodes();
      setNewCodes(codes);
    } catch (caught) {
      setRecoveryError(
        caught instanceof ApiError ? caught : new ApiError(0, "Internal", String(caught)),
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  const remaining = me.recoveryCodes.remaining;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center gap-2">
          <span className="flex text-muted-foreground" aria-hidden="true">
            <svg
              width="15"
              height="15"
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
          </span>
          <h2 className="text-base font-semibold leading-tight">Sign-in &amp; security</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Passkeys first. Your password and authenticator code are the fallback.
        </p>
      </div>

      {/* Passkeys Subheading & List */}
      <div>
        <h3 className="text-sm font-semibold">Passkeys</h3>
        {passkeyError ? (
          <div
            role="alert"
            className="mt-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive"
          >
            {passkeyError.isReauth ? (
              <>
                For your security, sign in again to manage your passkeys.{" "}
                <button type="button" onClick={signOut} className="underline">
                  Sign in again
                </button>
              </>
            ) : (
              passkeyError.message
            )}
          </div>
        ) : null}

        {passkeysQuery.isError ? (
          <div
            role="alert"
            className="mt-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive"
          >
            {passkeysQuery.error?.message || "Failed to load passkeys"}
          </div>
        ) : null}

        {passkeysQuery.isPending ? (
          <p className="py-2.5 text-xs text-muted-foreground">Loading passkeys…</p>
        ) : null}

        {!passkeysQuery.isPending &&
        !passkeysQuery.isError &&
        (!passkeysQuery.data || passkeysQuery.data.length === 0) ? (
          <p className="py-2.5 text-xs text-muted-foreground">No passkeys enrolled</p>
        ) : null}

        {!passkeysQuery.isPending &&
        !passkeysQuery.isError &&
        passkeysQuery.data &&
        passkeysQuery.data.length > 0 ? (
          <div className="mt-2 border-t border-border">
            {passkeysQuery.data.map((pk) => {
              const isRemoving = removingId === pk.id;
              return (
                <div
                  key={pk.id}
                  className="flex items-center gap-3 border-b border-border py-3 text-[13.5px]"
                >
                  <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="8" cy="15" r="4" />
                      <path d="M11 12l9-9M17 6l3 3M15 8l2 2" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{pk.name || "Passkey"}</div>
                    <small className="block text-xs text-muted-foreground">
                      Added {formatDate(pk.createdAt)}
                    </small>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemovePasskey(pk.id)}
                    disabled={isAddingPasskey || removingId !== null}
                    aria-label={`Remove passkey ${pk.name || "unnamed"}`}
                  >
                    {isRemoving ? "Removing…" : "Remove"}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="mt-3 flex justify-start">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddPasskey}
            disabled={isAddingPasskey || removingId !== null}
            className="flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add a passkey
          </Button>
        </div>
      </div>

      {/* Password & Authenticator Subheading & Row */}
      <div>
        <h3 className="text-sm font-semibold">Password and authenticator</h3>
        <div className="mt-2 border-t border-border">
          <div className="flex items-center gap-3 border-b border-border py-3 text-[13.5px]">
            <span className="flex shrink-0 text-money-in" aria-hidden="true">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12.5l3 3 5-6" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">Set up</div>
              <small className="block text-xs text-muted-foreground">
                Password configured · authenticator app linked
              </small>
            </div>
            <Button type="button" variant="outline" size="sm" disabled>
              Change
            </Button>
          </div>
        </div>
      </div>

      {/* Recovery Codes Subheading & Management */}
      <div>
        <h3 className="text-sm font-semibold">Recovery codes</h3>
        <div className="mt-2 border-t border-border">
          {newCodes === null ? (
            <div className="flex flex-col gap-2 border-b border-border py-3 text-[13.5px]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 11v6M12 7.5v.5" />
                    </svg>
                  </span>
                  <div>
                    <div className="font-medium text-foreground">
                      {remaining} unused recovery codes left.
                    </div>
                    <small className="block text-xs text-muted-foreground">
                      Each code works once. Store them somewhere safe.
                    </small>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerateCodes}
                  disabled={isRegenerating}
                >
                  {isRegenerating ? "Regenerating…" : "Regenerate recovery codes"}
                </Button>
              </div>

              {remaining < 3 ? (
                <p className="text-xs text-warning">
                  You are running out of recovery codes. Regenerate them to get a new set of 10.
                </p>
              ) : null}

              {recoveryError?.code === "ReauthRequired" ? (
                <p role="alert" className="text-xs text-destructive">
                  For your security, sign in again to regenerate your codes.{" "}
                  <button type="button" onClick={signOut} className="underline">
                    Sign in again
                  </button>
                </p>
              ) : recoveryError !== null ? (
                <p role="alert" className="text-xs text-destructive">
                  {recoveryError.message}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="border-b border-border py-3">
              <RecoveryCodeList
                codes={newCodes}
                onSaved={async () => {
                  setNewCodes(null);
                  await refresh();
                }}
              />
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Removing a passkey or making new codes asks you to confirm it&apos;s you first.
      </p>
    </div>
  );
}
