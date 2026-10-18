import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ApiError,
  dismissNotice,
  fetchNotices,
  type Notice,
  revokeMyRecoveryLinks,
} from "../api.ts";

export const NOTICES_KEY = ["identity", "notices"] as const;

export function noticeText(notice: Notice): string {
  const on = notice.createdAt.slice(0, 10);
  if (notice.kind === "identity.partner-reset") {
    return `A one-time recovery link for your account was issued on ${on} by ${notice.issuedBy ?? "someone"}. If you didn't ask for this, revoke it.`;
  }
  if (notice.kind === "identity.recovery-code-used") {
    return `One of your recovery codes was used to sign in on ${on}, and your passkeys were removed. If this wasn't you, reset your password and tell your partner.`;
  }
  return notice.kind;
}

export function Notices() {
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
    <section aria-labelledby="notices" className="mb-4">
      <h2 id="notices" className="text-sm font-semibold">
        Notices
      </h2>
      <ul className="mt-2 space-y-2">
        {notices.data.map((notice) => (
          <li key={notice.id} className="rounded-lg border border-border bg-card p-3 text-xs">
            <p>
              <time dateTime={notice.createdAt}>{notice.createdAt}</time>: {noticeText(notice)}
            </p>
            <div className="mt-2 flex gap-2">
              {notice.kind === "identity.partner-reset" ? (
                <button
                  type="button"
                  onClick={() => act(revokeMyRecoveryLinks)}
                  className="font-medium underline hover:text-foreground"
                >
                  Revoke the recovery link
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => act(() => dismissNotice(notice.id))}
                className="font-medium underline hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error === null ? null : (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
