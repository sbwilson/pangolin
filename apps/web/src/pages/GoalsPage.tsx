import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchGoalsSummary } from "../api.ts";
import { formatCents } from "../lib/money.ts";
import { useSignedIn } from "../session.tsx";

function policyLabel(policy: "rescale" | "buffer"): string {
  switch (policy) {
    case "rescale":
      return "Rescale remaining goals";
    case "buffer":
      return "Absorb into buffer";
    default:
      return policy;
  }
}

export function GoalsPage() {
  const { me } = useSignedIn();
  const [filterScope, setFilterScope] = useState<"all" | "shared" | "personal">("all");

  const goalsSummaryQuery = useQuery({
    queryKey: ["planning", "goals", "summary"],
    queryFn: () => fetchGoalsSummary(),
  });

  const summary = goalsSummaryQuery.data;
  const isLoading = goalsSummaryQuery.isLoading;
  const error = goalsSummaryQuery.error;

  const activeStage = summary?.activeStage ?? null;
  const rules = summary?.rules ?? [];
  const pools = summary?.pools ?? [];
  const allGoals = summary?.goals ?? [];

  // Map goal ID to active stage shareBp
  const goalShareMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!activeStage) return map;
    for (const rule of rules) {
      if (rule.stageId === activeStage.id) {
        map.set(rule.goalId, rule.shareBp);
      }
    }
    return map;
  }, [activeStage, rules]);

  const filteredGoals = useMemo(() => {
    return allGoals.filter((goal) => {
      const isPersonal = goal.pool !== "shared";
      if (filterScope === "shared") return !isPersonal;
      if (filterScope === "personal") {
        return (
          isPersonal &&
          (goal.personId === null || goal.personId === me.personId || goal.pool === me.personId)
        );
      }
      return true;
    });
  }, [allGoals, filterScope, me.personId]);

  const sharedPool = useMemo(() => {
    return pools.find((p) => p.pool === "shared");
  }, [pools]);

  const myPool = useMemo(() => {
    return pools.find(
      (p) => p.pool === me.personId || (p.pool !== "shared" && p.personId === me.personId),
    );
  }, [pools, me.personId]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading goals and savings...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <p className="font-medium">Failed to load goals</p>
          <p className="text-sm">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Goals & Savings</h1>
          <p className="text-sm text-muted-foreground">
            Staged allocations, savings pools, and emergency fund targets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Scope Filter Controls */}
          <div className="inline-flex rounded-lg border border-border p-1 bg-muted/40 text-xs">
            <button
              type="button"
              onClick={() => setFilterScope("all")}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                filterScope === "all"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("shared")}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                filterScope === "shared"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Shared
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("personal")}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                filterScope === "personal"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Personal
            </button>
          </div>
        </div>
      </div>

      {/* Active Allocation Stage Banner */}
      {activeStage ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 md:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  Active Stage
                </span>
                <h2 className="text-lg font-semibold text-foreground">{activeStage.name}</h2>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {(activeStage.fallbackThresholdBp / 100).toFixed(0)}% threshold &bull; Policy:{" "}
                {policyLabel(activeStage.completedSharePolicy)}
              </p>
            </div>
            {activeStage.exitGoalId && (
              <span className="text-xs text-muted-foreground bg-background/60 border border-border rounded-md px-2.5 py-1 self-start sm:self-auto">
                Transitions when exit goal reached
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No active allocation stage configured.
        </div>
      )}

      {/* Savings Pool Balances */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Savings Pools
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Shared Pool */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Shared Savings</span>
                <span className="inline-flex rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-semibold px-2 py-0.5">
                  Shared
                </span>
              </div>
              <div className="mt-2 text-2xl font-bold text-foreground">
                {sharedPool ? formatCents(sharedPool.totalCents) : "$0.00"}
              </div>
            </div>
            <div className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">
              {sharedPool && sharedPool.accounts.length > 0 ? (
                <span>
                  {sharedPool.accounts.length}{" "}
                  {sharedPool.accounts.length === 1 ? "account" : "accounts"} (
                  {sharedPool.accounts.map((a) => a.name).join(", ")})
                </span>
              ) : (
                <span>No savings accounts linked</span>
              )}
            </div>
          </div>

          {/* User Personal Pool */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {me.displayName}'s Savings
                </span>
                <span className="inline-flex rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold px-2 py-0.5">
                  Personal
                </span>
              </div>
              <div className="mt-2 text-2xl font-bold text-foreground">
                {myPool ? formatCents(myPool.totalCents) : "$0.00"}
              </div>
            </div>
            <div className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">
              {myPool && myPool.accounts.length > 0 ? (
                <span>
                  {myPool.accounts.length} {myPool.accounts.length === 1 ? "account" : "accounts"} (
                  {myPool.accounts.map((a) => a.name).join(", ")})
                </span>
              ) : (
                <span>No savings accounts linked</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Goals List */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Goals ({filteredGoals.length})
          </h3>
        </div>

        {filteredGoals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No goals found for the selected scope.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredGoals.map((goal) => {
              const shareBp = goalShareMap.get(goal.id);
              const sharePercent = shareBp !== undefined ? (shareBp / 100).toFixed(1) : null;

              return (
                <div
                  key={goal.id}
                  className="rounded-xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between gap-4"
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-foreground text-base">{goal.name}</h4>
                          {goal.isEmergencyFund && (
                            <span className="inline-flex items-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[11px] font-semibold">
                              Emergency Fund
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
                              goal.kind === "protected"
                                ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {goal.kind === "protected" ? "Protected" : "Flexible"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {goal.pool === "shared" ? "Shared pool" : "Personal pool"} &bull; Priority{" "}
                          {goal.priority}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-lg font-bold text-foreground">
                          {formatCents(goal.targetCents)}
                        </span>
                        <div className="text-[11px] text-muted-foreground">target</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
                    <div>
                      {goal.targetDate ? (
                        <span>Target date: {goal.targetDate}</span>
                      ) : (
                        <span>No deadline</span>
                      )}
                    </div>
                    <div>
                      {sharePercent !== null ? (
                        <span className="font-medium text-foreground">
                          Active allocation: {sharePercent}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No active allocation</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
