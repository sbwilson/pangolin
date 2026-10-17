import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient, authMessage } from "../auth-client.ts";
import { Button } from "../components/ui/button.tsx";
import { useSignedIn } from "../session.tsx";

export interface DeviceSession {
  readonly id: string;
  readonly userId: string;
  readonly token: string;
  readonly expiresAt: Date | string;
  readonly createdAt: Date | string;
  readonly updatedAt?: Date | string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface ParsedUserAgent {
  readonly device: string;
  readonly browser: string;
  readonly isMobile: boolean;
}

export function parseUserAgent(ua?: string | null): ParsedUserAgent {
  if (!ua) {
    return { device: "Unknown device", browser: "Browser", isMobile: false };
  }

  let device = "Unknown device";
  let isMobile = false;

  if (/iPhone/i.test(ua)) {
    device = "iPhone";
    isMobile = true;
  } else if (/iPad/i.test(ua)) {
    device = "iPad";
    isMobile = true;
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    device = "Mac";
  } else if (/Windows/i.test(ua)) {
    device = "Windows";
  } else if (/Android/i.test(ua)) {
    device = "Android";
    isMobile = true;
  } else if (/Linux/i.test(ua)) {
    device = "Linux";
  }

  let browser = "Browser";
  if (/Edg/i.test(ua)) {
    browser = "Edge";
  } else if (/Chrome|CriOS/i.test(ua)) {
    browser = "Chrome";
  } else if (/Firefox|FxiOS/i.test(ua)) {
    browser = "Firefox";
  } else if (/Safari/i.test(ua)) {
    browser = "Safari";
  }

  return { device, browser, isMobile };
}

function formatSessionTime(dateValue?: Date | string | null): string {
  if (!dateValue) return "recently";
  try {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return String(dateValue);
    return d.toLocaleString("en-AU", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return String(dateValue);
  }
}

export function SignedInDevices() {
  const queryClient = useQueryClient();
  const { signOut } = useSignedIn();
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentSessionQuery = useQuery({
    queryKey: ["auth", "current-session"],
    queryFn: async () => {
      const res = await authClient.getSession();
      return res.data;
    },
    retry: false,
  });

  const sessionsQuery = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async () => {
      const res = await authClient.listSessions();
      if (res.error) {
        throw new Error(authMessage(res.error));
      }
      return (res.data ?? []) as unknown as DeviceSession[];
    },
    retry: false,
  });

  const currentSessionId = currentSessionQuery.data?.session?.id;
  const currentSessionToken = currentSessionQuery.data?.session?.token;
  const isPending = sessionsQuery.isPending || currentSessionQuery.isPending;
  const isActionBusy = isSigningOut || revokingToken !== null;

  const handleSignOut = async (session: DeviceSession, isCurrent: boolean) => {
    setActionError(null);
    if (isCurrent) {
      setIsSigningOut(true);
      try {
        await signOut();
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "Failed to sign out");
        setIsSigningOut(false);
      }
      return;
    }

    setRevokingToken(session.token);
    try {
      const res = await authClient.revokeSession({ token: session.token });
      if (res.error) {
        setActionError(authMessage(res.error));
      } else {
        await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Failed to revoke session");
    } finally {
      setRevokingToken(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
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
          <h3 className="text-base font-semibold leading-tight">Signed-in devices</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Where you&apos;re signed in right now. Signing out one doesn&apos;t touch the others.
        </p>
      </div>

      {sessionsQuery.isError ? (
        <div role="alert" className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          Failed to load signed-in devices: {sessionsQuery.error?.message}
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}

      {isPending ? <p className="py-2.5 text-xs text-muted-foreground">Loading devices…</p> : null}

      {!isPending && !sessionsQuery.isError && sessionsQuery.data?.length === 0 ? (
        <p className="py-2.5 text-xs text-muted-foreground">No active sessions</p>
      ) : null}

      {!isPending && sessionsQuery.data && sessionsQuery.data.length > 0 ? (
        <div className="border-t border-border">
          {sessionsQuery.data.map((session) => {
            const isCurrent =
              (currentSessionId !== undefined && session.id === currentSessionId) ||
              (currentSessionToken !== undefined && session.token === currentSessionToken) ||
              (sessionsQuery.data?.length === 1 && currentSessionQuery.data?.session !== undefined);

            const { device, browser, isMobile } = parseUserAgent(session.userAgent);
            const isCurrentRevoking = revokingToken === session.token;
            const isCurrentSigningOut = isCurrent && isSigningOut;
            const isItemBusy = isCurrentRevoking || isCurrentSigningOut;

            return (
              <div
                key={session.id}
                className="flex items-center gap-3 border-b border-border py-3 text-[13.5px]"
              >
                <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
                  {isMobile ? (
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
                      <rect x="7" y="2" width="10" height="20" rx="2" />
                      <path d="M11 18h2" />
                    </svg>
                  ) : (
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
                      <rect x="4" y="5" width="16" height="11" rx="1.5" />
                      <path d="M2 19h20" />
                    </svg>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {device} · {browser}
                    </span>
                    {isCurrent ? (
                      <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[11.5px] font-semibold text-primary">
                        This device
                      </span>
                    ) : null}
                  </div>
                  <small className="block text-xs text-muted-foreground">
                    {session.ipAddress ? `${session.ipAddress} · ` : ""}
                    {isCurrent
                      ? "active now"
                      : `last used ${formatSessionTime(session.updatedAt ?? session.createdAt)}`}
                  </small>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isActionBusy}
                    onClick={() => void handleSignOut(session, isCurrent)}
                  >
                    {isItemBusy ? "Signing out…" : "Sign out"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
