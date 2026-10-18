import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  type AccountView,
  ApiError,
  fetchInstitutions,
  leaveHousehold,
  listAccounts,
  reopenAccount,
} from "../api.ts";
import { TYPE_LABEL } from "../lib/accounts.ts";
import { localDay } from "../lib/date-range.ts";
import { useSignedIn } from "../session.tsx";
import { ReauthDialog } from "./ReauthDialog.tsx";
import { Button } from "./ui/button.tsx";

const formatCents = (cents: number, currency = "AUD") => {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
};

export function AccountSettings() {
  const queryClient = useQueryClient();
  const { signOut, me } = useSignedIn();
  const today = useMemo(() => localDay(new Date()), []);

  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);

  const isSoleMember = me?.partner === null;

  const accountsQuery = useQuery({
    queryKey: ["accounts", { includeClosed: true }],
    queryFn: () => listAccounts({ includeClosed: true }),
  });

  const institutionsQuery = useQuery({
    queryKey: ["institutions"],
    queryFn: fetchInstitutions,
  });

  const institutionsMap = useMemo(() => {
    return new Map((institutionsQuery.data ?? []).map((inst) => [inst.id, inst.name]));
  }, [institutionsQuery.data]);

  const closedAccounts = useMemo(() => {
    return (accountsQuery.data ?? []).filter(
      (a: AccountView) => a.closedOn !== null && a.closedOn <= today,
    );
  }, [accountsQuery.data, today]);

  useEffect(() => {
    if (!showLeaveConfirm) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLeaving) {
        setShowLeaveConfirm(false);
        setLeaveError(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showLeaveConfirm, isLeaving]);

  const handleReopen = async (accountId: string) => {
    setActionError(null);
    setReopeningId(accountId);
    try {
      await reopenAccount(accountId);
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["ledger", "accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["notices"] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reopen account");
    } finally {
      setReopeningId(null);
    }
  };

  const executeLeave = async () => {
    await leaveHousehold({ confirm: true });
    setShowLeaveConfirm(false);
    try {
      await signOut();
    } catch {
      // ignore
    }
    if (typeof window !== "undefined") {
      window.location.href = "/sign-in";
    }
  };

  const handleConfirmLeave = async () => {
    setIsLeaving(true);
    setLeaveError(null);
    try {
      await executeLeave();
    } catch (err) {
      if (err instanceof ApiError && err.code === "ReauthRequired") {
        setShowLeaveConfirm(false);
        setReauthRequired(true);
      } else {
        setLeaveError(err instanceof Error ? err.message : "Failed to leave household");
      }
    } finally {
      setIsLeaving(false);
    }
  };

  const handleReauthLeaveSuccess = async () => {
    await executeLeave();
    setShowLeaveConfirm(false);
    setReauthRequired(false);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
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
              <path d="M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
            </svg>
          </span>
          <h2 className="text-base font-semibold leading-tight">Accounts</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Archived closed accounts, closing balance warnings, and household membership.
        </p>
      </div>

      {actionError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg bg-[var(--warning-bg,#fef3c7)] px-3 py-2 text-xs text-[var(--warning,#8a5600)]"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Subhead: Archived closed accounts */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Archived closed accounts</h3>
        {accountsQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading accounts…</p>
        ) : accountsQuery.isError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-xs text-destructive"
          >
            Failed to load closed accounts.
          </div>
        ) : closedAccounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No closed accounts
          </div>
        ) : (
          <ul
            aria-label="Archived closed accounts"
            className="divide-y divide-border rounded-lg border border-border p-0 list-none"
          >
            {closedAccounts.map((account) => {
              const institution = account.institutionId
                ? institutionsMap.get(account.institutionId)
                : null;
              return (
                <li
                  key={account.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{account.name}</span>
                      {institution ? (
                        <span className="text-xs text-muted-foreground">({institution})</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {TYPE_LABEL[account.type] ?? account.type} · Closed on {account.closedOn}
                    </div>
                    {account.warning?.kind === "closing-balance" ? (
                      <div
                        role="status"
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-[var(--warning-bg,#fef3c7)] px-2 py-0.5 text-xs font-medium text-[var(--warning,#8a5600)]"
                      >
                        <b
                          className="flex size-3.5 items-center justify-center rounded-full border border-current text-[10px]"
                          aria-hidden="true"
                        >
                          !
                        </b>
                        <span>
                          Closed with a remaining balance of{" "}
                          {formatCents(account.warning.balanceCents, account.currency)}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center self-end sm:self-center">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleReopen(account.id)}
                      disabled={reopeningId !== null}
                    >
                      {reopeningId === account.id ? "Reopening…" : "Reopen account"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Subhead: Household membership */}
      <div className="space-y-3 pt-2 border-t border-border">
        <h3 className="text-sm font-semibold text-foreground">Household membership</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Leaving the household permanently deletes your personal private accounts, transactions,
          payees, and settings. Shared accounts remain with your partner. All active sessions and
          credentials will be revoked immediately.
        </p>
        {isSoleMember ? (
          <p className="text-xs text-muted-foreground">
            You are the sole member of this household. A sole member cannot leave the household.
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setShowLeaveConfirm(true)}
            disabled={isSoleMember}
          >
            Leave household
          </Button>
        </div>
      </div>

      {/* Leave Household Confirmation Modal */}
      {showLeaveConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close modal backdrop"
            className="fixed inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-xs"
            onClick={() => {
              if (!isLeaving) {
                setShowLeaveConfirm(false);
                setLeaveError(null);
              }
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-household-heading"
            aria-describedby="leave-household-description"
            className="relative z-10 w-full max-w-[480px] rounded-xl border border-border bg-card p-6 shadow-xl space-y-4"
          >
            <h3 id="leave-household-heading" className="text-lg font-semibold text-foreground">
              Leave household
            </h3>
            <p id="leave-household-description" className="text-sm text-muted-foreground">
              Are you sure you want to leave the household? This action is permanent and cannot be
              undone:
            </p>
            <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1.5">
              <li>
                Your private accounts and all personal transactions scoped to you will be
                permanently deleted.
              </li>
              <li>Shared accounts will remain with your partner as the sole owner.</li>
              <li>
                All active sessions, passkeys, and recovery credentials will be revoked immediately.
              </li>
              <li>Backups taken earlier keep the data.</li>
            </ul>

            {leaveError ? (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg bg-[var(--warning-bg,#fef3c7)] px-3 py-2 text-xs text-[var(--warning,#8a5600)]"
              >
                <b className="font-bold">!</b>
                <span>{leaveError}</span>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  setLeaveError(null);
                }}
                disabled={isLeaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleConfirmLeave()}
                disabled={isLeaving}
              >
                {isLeaving ? "Leaving…" : "Confirm and leave"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauthRequired}
        action="leave the household"
        onSuccess={handleReauthLeaveSuccess}
        onCancel={() => setReauthRequired(false)}
      />
    </div>
  );
}
