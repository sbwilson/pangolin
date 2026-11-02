import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  confirmRecurringSeries,
  deleteRecurringSeries,
  detectRecurringBills,
  fetchPayees,
  fetchRecurringSeries,
  listAccounts,
  rejectRecurringSeries,
} from "../api.ts";
import { RecurringBillCard } from "./RecurringBillCard.tsx";
import { RecurringBillEditorSheet } from "./RecurringBillEditorSheet.tsx";
import { Button } from "./ui/button.tsx";

function RefreshCwIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

function PlusIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function RecurringBillsSection() {
  const queryClient = useQueryClient();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Queries
  const seriesQuery = useQuery({
    queryKey: ["planning", "recurring-bills"],
    queryFn: () => fetchRecurringSeries(),
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
  });

  const payeesQuery = useQuery({
    queryKey: ["classify", "payees"],
    queryFn: fetchPayees,
  });

  const seriesList = seriesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const payees = payeesQuery.data ?? [];

  const accountMap = useMemo(() => {
    return new Map(accounts.map((a) => [a.id, a.name]));
  }, [accounts]);

  const payeeMap = useMemo(() => {
    return new Map(payees.map((p) => [p.id, p.name]));
  }, [payees]);

  // Separate candidates and confirmed bills
  const candidates = useMemo(() => {
    return seriesList.filter((s) => s.status === "candidate");
  }, [seriesList]);

  const confirmedBills = useMemo(() => {
    return seriesList.filter((s) => s.status === "confirmed");
  }, [seriesList]);

  // Mutations
  const detectMutation = useMutation({
    mutationFn: () => detectRecurringBills(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["planning", "recurring-bills"] });
    },
    onError: (err: unknown) => {
      setActionError(err instanceof Error ? err.message : "Failed to detect recurring bills.");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => confirmRecurringSeries(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["planning", "recurring-bills"] });
    },
    onError: (err: unknown) => {
      setActionError(err instanceof Error ? err.message : "Failed to confirm recurring bill.");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectRecurringSeries(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["planning", "recurring-bills"] });
    },
    onError: (err: unknown) => {
      setActionError(err instanceof Error ? err.message : "Failed to dismiss candidate.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRecurringSeries(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["planning", "recurring-bills"] });
    },
    onError: (err: unknown) => {
      setActionError(err instanceof Error ? err.message : "Failed to delete recurring bill.");
    },
  });

  return (
    <section
      className="space-y-6 pt-6 border-t border-border"
      aria-labelledby="recurring-bills-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2
            id="recurring-bills-heading"
            className="text-lg font-bold text-foreground tracking-tight"
          >
            Recurring bills
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Subscriptions and regular payments detected from your transaction history.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={detectMutation.isPending}
            onClick={() => {
              setActionError(null);
              detectMutation.mutate();
            }}
            className="text-xs h-8 inline-flex items-center gap-1.5"
          >
            <RefreshCwIcon className={detectMutation.isPending ? "animate-spin" : undefined} />
            {detectMutation.isPending ? "Detecting..." : "Detect bills"}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => {
              setActionError(null);
              setIsEditorOpen(true);
            }}
            className="text-xs h-8 bg-primary text-primary-foreground font-semibold inline-flex items-center gap-1.5"
          >
            <PlusIcon />
            Add bill
          </Button>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive font-medium flex items-center justify-between"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-muted-foreground hover:text-foreground text-xs font-semibold ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Candidates section if any */}
      {candidates.length > 0 && (
        <div className="space-y-3" data-testid="recurring-candidates-section">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Detected candidates ({candidates.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {candidates.map((series) => {
              const payeeName = payeeMap.get(series.payeeId) ?? "Unknown Payee";
              const accountName = accountMap.get(series.accountId) ?? "Account";
              return (
                <RecurringBillCard
                  key={series.id}
                  series={series}
                  payeeName={payeeName}
                  accountName={accountName}
                  onConfirm={() => {
                    setActionError(null);
                    confirmMutation.mutate(series.id);
                  }}
                  onDismiss={() => {
                    setActionError(null);
                    rejectMutation.mutate(series.id);
                  }}
                  isConfirming={
                    confirmMutation.isPending && confirmMutation.variables === series.id
                  }
                  isDismissing={rejectMutation.isPending && rejectMutation.variables === series.id}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmed / Active Recurring Bills */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Active bills ({confirmedBills.length})
        </h3>

        {confirmedBills.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-xs text-muted-foreground">
              {candidates.length > 0
                ? "Confirm the detected candidates above or click 'Add bill' to create one manually."
                : "No active recurring bills yet. Click 'Detect bills' to scan your transaction history or add one manually."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {confirmedBills.map((series) => {
              const payeeName = payeeMap.get(series.payeeId) ?? "Unknown Payee";
              const accountName = accountMap.get(series.accountId) ?? "Account";
              return (
                <RecurringBillCard
                  key={series.id}
                  series={series}
                  payeeName={payeeName}
                  accountName={accountName}
                  onDelete={() => {
                    if (
                      window.confirm("Are you sure you want to stop tracking this recurring bill?")
                    ) {
                      setActionError(null);
                      deleteMutation.mutate(series.id);
                    }
                  }}
                  isDeleting={deleteMutation.isPending && deleteMutation.variables === series.id}
                />
              );
            })}
          </div>
        )}
      </div>

      <RecurringBillEditorSheet
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ["planning", "recurring-bills"] });
        }}
      />
    </section>
  );
}
