import { useState } from "react";
import { ApiError, invitePartner, resetPartner } from "../api.ts";
import { Button } from "../components/ui/button.tsx";
import { useSignedIn } from "../session.tsx";

export function PartnerSettings() {
  const { me, signOut } = useSignedIn();

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<ApiError | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetError, setResetError] = useState<ApiError | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const handleInvite = async () => {
    setIsInviting(true);
    setInviteError(null);
    try {
      const res = await invitePartner();
      setInviteLink(res.url);
    } catch (caught) {
      setInviteError(
        caught instanceof ApiError ? caught : new ApiError(0, "Internal", String(caught)),
      );
    } finally {
      setIsInviting(false);
    }
  };

  const handleReset = async () => {
    if (!me.partner) return;
    setIsResetting(true);
    setResetError(null);
    try {
      const res = await resetPartner(me.partner.personId);
      setResetLink(res.url);
    } catch (caught) {
      setResetError(
        caught instanceof ApiError ? caught : new ApiError(0, "Internal", String(caught)),
      );
    } finally {
      setIsResetting(false);
    }
  };

  const hasPartner = me.partner !== null;

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
          <h2 className="text-base font-semibold leading-tight">Partner</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {hasPartner
            ? `You and ${me.partner?.displayName} each have your own sign-in. Invites are closed now you're both in.`
            : "Invite your partner to join your household."}
        </p>
      </div>

      {hasPartner && me.partner ? (
        <div className="flex flex-col gap-4">
          <div className="border-t border-border">
            <div className="flex items-center gap-3 border-b border-border py-3 text-[13.5px]">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
              <div>
                <div className="font-medium text-foreground">{me.partner.displayName}</div>
                <small className="block text-xs text-muted-foreground">
                  Signs in with a passkey
                </small>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Help {me.partner.displayName} back in</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              If {me.partner.displayName} has lost their passkey and password, give them a one-time
              link to set up their sign-in again. They will be told in the app that you did this.
            </p>

            <div className="mt-3">
              {resetLink === null ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  disabled={isResetting}
                >
                  {isResetting ? "Creating reset link…" : "Reset partner's access"}
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    Give this link to {me.partner.displayName} yourself. It works once, for 24
                    hours, and is not shown again.
                  </p>
                  <label className="block text-xs font-semibold text-foreground">
                    Partner recovery link
                    <input
                      type="text"
                      readOnly
                      value={resetLink}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground"
                    />
                  </label>
                </div>
              )}

              {resetError?.code === "ReauthRequired" ? (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  For your security, sign in again to reset your partner&apos;s access.{" "}
                  <button type="button" onClick={signOut} className="underline">
                    Sign in again
                  </button>
                </p>
              ) : resetError !== null ? (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {resetError.message}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Invite your partner</h3>

          <div className="mt-3">
            {inviteLink === null ? (
              me.canInvite ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleInvite}
                  disabled={isInviting}
                >
                  {isInviting ? "Creating invite link…" : "Invite partner"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Invites are currently closed.</p>
              )
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Send this one-time link to your partner. It works once, for 24 hours.
                </p>
                <label className="block text-xs font-semibold text-foreground">
                  Partner setup link
                  <input
                    type="text"
                    readOnly
                    value={inviteLink}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground"
                  />
                </label>
              </div>
            )}

            {inviteError?.code === "ReauthRequired" ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                For your security, sign in again to invite your partner.{" "}
                <button type="button" onClick={signOut} className="underline">
                  Sign in again
                </button>
              </p>
            ) : inviteError !== null ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {inviteError.message}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
