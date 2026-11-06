import { Temporal } from "@pangolin/shared/temporal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  type AllocationStageData,
  fetchGoalsSummary,
  type GoalData,
  type GoalsSummaryData,
} from "../api.ts";
import { GoalEditorSheet } from "../components/GoalEditorSheet.tsx";
import { StageEditorSheet } from "../components/StageEditorSheet.tsx";
import { formatCents } from "../lib/money.ts";
import { useSignedIn } from "../session.tsx";

/** "2028-03-01" → "Mar 2028": arrival lines show month and year only. */
function formatMonthYear(isoDay: string): string {
  return Temporal.PlainDate.from(isoDay).toLocaleString("en-AU", {
    month: "short",
    year: "numeric",
  });
}

function formatDay(isoDay: string): string {
  return Temporal.PlainDate.from(isoDay).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

/** Percent text without trailing noise: 8000 bp → "80%", 1250 bp → "12.5%". */
function pctText(bp: number): string {
  const pct = bp / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${Math.round(pct * 10) / 10}%`;
}

function poolKeyOf(item: { pool: string; personId?: string | null }): string {
  return item.personId === null || item.personId === undefined ? "shared" : item.personId;
}

function balanceOf(goal: GoalData): number {
  return goal.currentBalance ?? 0;
}

interface StageView {
  readonly stage: AllocationStageData | null;
  readonly stageCount: number;
  readonly shareByGoal: ReadonlyMap<string, number>;
  readonly bufferBp: number;
}

/** The pool's active stage: a preferred (engine-resolved) id wins, else the first
 * whose exit goal is not yet full, then the last. */
function stageViewFor(
  pool: "shared" | string,
  summary: GoalsSummaryData,
  balanceOf: (goal: GoalData) => number,
  preferredStageId?: string | null,
): StageView {
  const stages = summary.stages
    .filter((s) => (s.personId === null ? "shared" : s.personId) === pool)
    .sort((a, b) => a.sort - b.sort);
  const balanceById = new Map(summary.goals.map((g) => [g.id, balanceOf(g)]));
  let active = preferredStageId ? (stages.find((s) => s.id === preferredStageId) ?? null) : null;
  if (active === null) {
    for (const s of stages) {
      active = s;
      const exit =
        s.exitGoalId === null ? undefined : summary.goals.find((g) => g.id === s.exitGoalId);
      if (
        s.exitGoalId === null ||
        exit === undefined ||
        (balanceById.get(exit.id) ?? 0) < exit.targetCents
      ) {
        break;
      }
    }
  }
  const shareByGoal = new Map<string, number>();
  if (active) {
    for (const rule of summary.rules) {
      if (rule.stageId === active.id && rule.source !== "shortfall_override") {
        shareByGoal.set(rule.goalId, rule.shareBp);
      }
    }
  }
  const totalShare = [...shareByGoal.values()].reduce((sum, bp) => sum + bp, 0);
  return {
    stage: active,
    stageCount: stages.length,
    shareByGoal,
    bufferBp: Math.max(0, 10000 - totalShare),
  };
}

export function GoalsPage() {
  const { me } = useSignedIn();
  const queryClient = useQueryClient();
  const [filterScope, setFilterScope] = useState<"all" | "shared" | "personal">("all");
  const [editingGoal, setEditingGoal] = useState<GoalData | null>(null);
  const [goalSheetOpen, setGoalSheetOpen] = useState(false);
  const [stageSheet, setStageSheet] = useState<{ pool: "shared" | string; label: string } | null>(
    null,
  );

  const goalsSummaryQuery = useQuery({
    queryKey: ["planning", "goals", "summary"],
    queryFn: () => fetchGoalsSummary(),
  });

  const summary = goalsSummaryQuery.data;
  const isLoading = goalsSummaryQuery.isLoading;
  const error = goalsSummaryQuery.error;

  const sharedView = useMemo(
    // The engine knows the real shared active stage (fallback included); prefer it,
    // so chips/buffer never disagree with the header's activeSharedStage.
    () => (summary ? stageViewFor("shared", summary, balanceOf, summary.activeStage?.id) : null),
    [summary],
  );
  const activeSharedStage = summary?.activeStage ?? sharedView?.stage ?? null;
  const personalView = useMemo(
    () => (summary ? stageViewFor(me.personId, summary, balanceOf) : null),
    [summary, me.personId],
  );

  const allGoals = summary?.goals ?? [];
  const filteredGoals = useMemo(() => {
    return allGoals.filter((goal) => {
      const isPersonal = goal.pool !== "shared";
      if (filterScope === "shared") return !isPersonal;
      if (filterScope === "personal") return isPersonal;
      return true;
    });
  }, [allGoals, filterScope]);

  const sharedPool = summary?.pools.find((p) => poolKeyOf(p) === "shared");
  const myPool = summary?.pools.find((p) => poolKeyOf(p) === me.personId);

  const sharedSetAside = allGoals
    .filter((g) => g.pool === "shared")
    .reduce((sum, g) => sum + balanceOf(g), 0);
  const sharedBufferCents = Math.max(0, (sharedPool?.totalCents ?? 0) - sharedSetAside);

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

  const chipFor = (goal: GoalData): string | null => {
    const view = goal.pool === "shared" ? sharedView : personalView;
    const shareBp = view?.shareByGoal.get(goal.id);
    if (view?.stage === null || view?.stage === undefined || shareBp === undefined) return null;
    return balanceOf(goal) >= goal.targetCents
      ? `${view.stage.name} · done`
      : `${view.stage.name} · ${pctText(shareBp)}`;
  };

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ["planning", "goals", "summary"] });
  };

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
            {(["all", "shared", "personal"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => setFilterScope(scope)}
                className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
                  filterScope === scope
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {scope === "all" ? "All" : scope === "shared" ? "Shared" : "Personal"}
              </button>
            ))}
          </div>
          {!me.demo && (
            <button
              type="button"
              onClick={() => {
                setEditingGoal(null);
                setGoalSheetOpen(true);
              }}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Add a goal
            </button>
          )}
        </div>
      </div>

      {/* Active allocation stage + pool tiles */}
      {(filterScope === "all" || filterScope === "shared") && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
          <div className="md:col-span-3 rounded-xl border border-border bg-card p-4 md:p-5">
            <span className="text-xs text-muted-foreground">Shared savings · active stage</span>
            {activeSharedStage ? (
              <>
                <h2 className="mt-0.5 text-lg font-semibold text-foreground">
                  {activeSharedStage.name}
                  {sharedView !== null && sharedView.stageCount > 1 && (
                    <span className="font-normal text-muted-foreground">
                      {" \u00b7 stage "}
                      {(summary?.stages ?? [])
                        .filter((s) => s.personId === null)
                        .sort((a, b) => a.sort - b.sort)
                        .findIndex((s) => s.id === activeSharedStage.id) + 1}
                      {" of "}
                      {sharedView.stageCount}
                    </span>
                  )}
                </h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(summary?.rules ?? [])
                    .filter(
                      (r) =>
                        r.stageId === activeSharedStage.id && r.source !== "shortfall_override",
                    )
                    .map((r) => {
                      const g = allGoals.find((goal) => goal.id === r.goalId);
                      if (!g) return null;
                      return (
                        <span
                          key={r.id}
                          className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {g.name}{" "}
                          <b className="ml-1 font-semibold text-foreground">{pctText(r.shareBp)}</b>
                        </span>
                      );
                    })}
                  {(sharedView?.bufferBp ?? 0) > 0 && (
                    <span className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                      Buffer{" "}
                      <b className="ml-1 font-semibold text-foreground">
                        {pctText(sharedView?.bufferBp ?? 0)}
                      </b>
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Falls back at {pctText(activeSharedStage.fallbackThresholdBp)} &bull;{" "}
                  {activeSharedStage.completedSharePolicy === "rescale"
                    ? "completed goals rescale the rest"
                    : "completed goals add to the buffer"}
                  {activeSharedStage.exitGoalId !== null &&
                    summary?.nextStageChangeDate !== null &&
                    summary?.nextStageChangeDate !== undefined &&
                    ` · ends around ${formatMonthYear(summary.nextStageChangeDate)}`}
                </p>
                {!me.demo && (
                  <button
                    type="button"
                    onClick={() => setStageSheet({ pool: "shared", label: "Shared savings" })}
                    className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    Edit stages
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">No allocation stage set.</p>
                {!me.demo && (
                  <button
                    type="button"
                    onClick={() => setStageSheet({ pool: "shared", label: "Shared savings" })}
                    className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    Add a stage
                  </button>
                )}
              </>
            )}
          </div>
          <div className="md:col-span-2 grid grid-cols-1 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">In shared savings</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {formatCents(sharedPool?.totalCents ?? 0)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Shared savings accounts, to {summary ? formatDay(summary.asOf) : ""}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Set aside for goals</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {formatCents(sharedSetAside)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                What your shared goals have banked
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Buffer</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {formatCents(sharedBufferCents)}
              </div>
              {(sharedView?.bufferBp ?? 0) > 0 && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Gets {pctText(sharedView?.bufferBp ?? 0)} of each pay period
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Personal stage strip */}
      {filterScope !== "shared" && (
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-xs text-muted-foreground">
              {me.displayName}&#8217;s savings · active stage
            </span>
            {personalView?.stage ? (
              <>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground">
                    {personalView.stage.name}
                  </span>
                  {[...personalView.shareByGoal.entries()].map(([goalId, bp]) => {
                    const g = allGoals.find((goal) => goal.id === goalId);
                    if (!g) return null;
                    return (
                      <span
                        key={goalId}
                        className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {g.name} <b className="ml-1 font-semibold text-foreground">{pctText(bp)}</b>
                      </span>
                    );
                  })}
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {formatCents(myPool?.totalCents ?? 0)} in personal savings
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No allocation stage set.</p>
            )}
          </div>
          {!me.demo && (
            <button
              type="button"
              onClick={() =>
                setStageSheet({ pool: me.personId, label: `${me.displayName}\u2019s savings` })
              }
              className="self-start sm:self-auto rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
            >
              {personalView?.stage ? "Edit stages" : "Add a stage"}
            </button>
          )}
        </div>
      )}

      {/* Goals List */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Goals ({filteredGoals.length})
        </h3>

        {filteredGoals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No goals yet.
            {!me.demo && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditingGoal(null);
                    setGoalSheetOpen(true);
                  }}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Add a goal
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredGoals.map((goal) => {
              const balance = balanceOf(goal);
              const pct =
                goal.targetCents > 0
                  ? Math.min(100, Math.round((balance / goal.targetCents) * 100))
                  : 0;
              const done = balance >= goal.targetCents;
              const chip = chipFor(goal);

              return (
                <div
                  key={goal.id}
                  className={`rounded-xl border bg-card p-5 shadow-sm flex flex-col gap-3 ${
                    done ? "border-primary/30 bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-foreground text-base">{goal.name}</h4>
                    <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {goal.pool === "shared" ? "Shared" : me.displayName}
                    </span>
                    {goal.isEmergencyFund && (
                      <span className="inline-flex items-center rounded-md bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-semibold">
                        Emergency fund
                      </span>
                    )}
                    {goal.kind === "protected" && !goal.isEmergencyFund && (
                      <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground">
                        Protected
                      </span>
                    )}
                    {chip !== null && (
                      <span className="ml-auto inline-flex items-center rounded-md bg-background border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {chip}
                      </span>
                    )}
                    {!me.demo && (
                      <button
                        type="button"
                        aria-label={`Edit ${goal.name}`}
                        onClick={() => {
                          setEditingGoal(goal);
                          setGoalSheetOpen(true);
                        }}
                        className={chip !== null ? "" : "ml-auto"}
                      >
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
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-semibold tabular-nums text-foreground">
                      {formatCents(balance)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      of {formatCents(goal.targetCents)}
                    </span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full bg-border overflow-hidden"
                    role="img"
                    aria-label={`${goal.name}: ${formatCents(balance)} of ${formatCents(goal.targetCents)}`}
                  >
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {done ? (
                      <span className="text-primary font-medium">
                        Full. Nothing more goes here unless it drops.
                      </span>
                    ) : goal.projection ? (
                      <span>
                        At the current rate, you&#8217;ll arrive by{" "}
                        <b className="text-foreground font-semibold">
                          {formatMonthYear(goal.projection.projectedCompletion)}
                        </b>
                        .
                      </span>
                    ) : (
                      <span>— Not enough history yet</span>
                    )}
                  </div>
                  {goal.targetDate !== null && (
                    <div className="text-xs text-muted-foreground">
                      Target date: {goal.targetDate}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Editors */}
      <GoalEditorSheet
        me={me}
        goal={editingGoal}
        goals={allGoals}
        isOpen={goalSheetOpen}
        onClose={() => setGoalSheetOpen(false)}
        onSaved={refetch}
      />
      {stageSheet !== null && (
        <StageEditorSheet
          key={stageSheet.pool}
          pool={stageSheet.pool}
          poolLabel={stageSheet.label}
          stages={(summary?.stages ?? [])
            .filter((s) => (s.personId === null ? "shared" : s.personId) === stageSheet.pool)
            .sort((a, b) => a.sort - b.sort)}
          rules={summary?.rules ?? []}
          goals={allGoals}
          isOpen
          onClose={() => setStageSheet(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}
