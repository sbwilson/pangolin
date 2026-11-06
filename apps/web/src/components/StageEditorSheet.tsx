import { useState } from "react";
import { cn } from "@/lib/utils.ts";
import {
  type AllocationStageData,
  createStage,
  deleteStage,
  type GoalData,
  type GoalRuleData,
  setStageRules,
  updateStage,
} from "../api.ts";
import { Button } from "./ui/button.tsx";
import { Sheet } from "./ui/sheet.tsx";

export interface StageEditorSheetProps {
  /** Which pool's stages this sheet edits. */
  readonly pool: "shared" | string;
  readonly poolLabel: string;
  /** Stages of this pool, in ladder order. */
  readonly stages: ReadonlyArray<AllocationStageData>;
  /** All visible rule rows; the sheet filters them per stage. */
  readonly rules: ReadonlyArray<GoalRuleData>;
  /** All visible goals; the sheet only offers ones from this pool. */
  readonly goals: ReadonlyArray<GoalData>;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

function poolOf(goal: GoalData): string {
  return goal.personId === null ? "shared" : goal.personId;
}

const NEW = "__new__";

export function StageEditorSheet({
  pool,
  poolLabel,
  stages,
  rules,
  goals,
  isOpen,
  onClose,
  onSaved,
}: StageEditorSheetProps) {
  const [selectedId, setSelectedId] = useState<string>(stages[0]?.id ?? NEW);
  const [name, setName] = useState("");
  const [exitGoalId, setExitGoalId] = useState<string>("");
  const [fallbackPct, setFallbackPct] = useState<number>(80);
  const [policy, setPolicy] = useState<"rescale" | "buffer">("rescale");
  const [sharesPct, setSharesPct] = useState<Record<string, number>>({});

  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lastInit, setLastInit] = useState<string | null>(null);
  const initKey = isOpen ? `${pool}:${stages[0]?.id ?? NEW}` : null;
  if (initKey !== lastInit) {
    setLastInit(initKey);
    if (isOpen) {
      const first = stages[0];
      setSelectedId(first?.id ?? NEW);
      loadStage(first);
    }
  }

  function loadStage(stage: AllocationStageData | undefined) {
    if (stage) {
      setName(stage.name);
      setExitGoalId(stage.exitGoalId ?? "");
      setFallbackPct(Math.round(stage.fallbackThresholdBp / 100));
      setPolicy(stage.completedSharePolicy);
      const stageRules = rules.filter(
        (r) => r.stageId === stage.id && r.source !== "shortfall_override",
      );
      setSharesPct(Object.fromEntries(stageRules.map((r) => [r.goalId, r.shareBp / 100])));
    } else {
      setName("");
      setExitGoalId("");
      setFallbackPct(80);
      setPolicy("rescale");
      setSharesPct({});
    }
    setError(null);
    setConfirmingDelete(false);
  }

  if (!isOpen) return null;

  const stage = stages.find((s) => s.id === selectedId);
  const isEditing = stage !== undefined;
  const poolGoals = goals.filter((g) => poolOf(g) === pool);
  const shareTotal = Object.values(sharesPct).reduce((sum, pct) => sum + (pct || 0), 0);
  const bufferPct = Math.max(0, Math.round((100 - shareTotal) * 100) / 100);

  const selectStage = (id: string) => {
    setSelectedId(id);
    loadStage(stages.find((s) => s.id === id));
  };

  const handleSave = async () => {
    setError(null);
    if (name.trim() === "") {
      setError("Please name the stage.");
      return;
    }
    if (shareTotal > 100) {
      setError(`Shares sum to ${shareTotal}%; a stage's shares must total at most 100%.`);
      return;
    }
    const ruleInputs = poolGoals
      .map((g) => ({ goalId: g.id, shareBp: Math.round((sharesPct[g.id] ?? 0) * 100) }))
      .filter((r) => r.shareBp > 0);

    setSaving(true);
    try {
      let stageId: string;
      if (isEditing && stage) {
        const updated = await updateStage(stage.id, {
          name: name.trim(),
          exitGoalId: exitGoalId === "" ? null : exitGoalId,
          fallbackThresholdBp: Math.round(fallbackPct * 100),
          completedSharePolicy: policy,
        });
        stageId = updated.id;
      } else {
        const created = await createStage({
          name: name.trim(),
          pool: pool === "shared" ? null : pool,
          ...(exitGoalId === "" ? {} : { exitGoalId }),
          fallbackThresholdBp: Math.round(fallbackPct * 100),
          completedSharePolicy: policy,
        });
        stageId = created.id;
      }
      await setStageRules(stageId, ruleInputs);
      onSaved();
      onClose();
    } catch (err: unknown) {
      // The stage (and maybe its rules) may already be committed by the first
      // call — refetch either way so the UI reflects what was written.
      onSaved();
      setError(err instanceof Error ? err.message : "Failed to save stage");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!stage) return;
    setSaving(true);
    try {
      await deleteStage(stage.id);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete stage");
    } finally {
      setSaving(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Sheet
      title="Allocation stages"
      description={`Each stage decides how the savings pot is shared for ${poolLabel}.`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-5 py-2">
        {error && (
          <div className="rounded-lg bg-warning-bg p-3 text-xs text-warning font-medium">
            {error}
          </div>
        )}

        {/* Stage picker */}
        <div className="flex flex-wrap items-center gap-1.5">
          {stages.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => selectStage(s.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors border",
                s.id === selectedId
                  ? "bg-card text-foreground border-border shadow-sm font-semibold"
                  : "bg-muted text-muted-foreground border-transparent hover:text-foreground",
              )}
            >
              {s.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => selectStage(NEW)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors border",
              selectedId === NEW
                ? "bg-card text-foreground border-border shadow-sm font-semibold"
                : "bg-muted text-muted-foreground border-transparent hover:text-foreground",
            )}
          >
            Add a stage
          </button>
        </div>

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="stage-name-input" className="text-xs font-semibold text-foreground">
            Stage name
          </label>
          <input
            id="stage-name-input"
            type="text"
            placeholder="Debt first"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Exit goal */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="stage-exit-goal-select" className="text-xs font-semibold text-foreground">
            Ends when
          </label>
          <select
            id="stage-exit-goal-select"
            value={exitGoalId}
            onChange={(e) => setExitGoalId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">No exit goal</option>
            {poolGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} is reached
              </option>
            ))}
          </select>
        </div>

        {/* Fallback threshold */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="stage-fallback-input" className="text-xs font-semibold text-foreground">
            Fallback at (%)
          </label>
          <input
            id="stage-fallback-input"
            type="number"
            min={0}
            max={100}
            value={fallbackPct}
            onChange={(e) => setFallbackPct(Number(e.target.value))}
            className="flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm tabular-nums text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">
            If a goal misses its share at this point, what&#8217;s left goes to the buffer.
          </span>
        </div>

        {/* Completed-share policy */}
        <fieldset
          className="flex flex-col gap-1.5 m-0 border-0 p-0"
          aria-label="When a goal completes"
        >
          <legend className="text-xs font-semibold text-foreground">When a goal completes</legend>
          <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setPolicy("rescale")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                policy === "rescale"
                  ? "bg-card text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Rescale the rest
            </button>
            <button
              type="button"
              onClick={() => setPolicy("buffer")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                policy === "buffer"
                  ? "bg-card text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Add to buffer
            </button>
          </div>
        </fieldset>

        {/* Per-goal shares */}
        <fieldset className="flex flex-col gap-2 m-0 border-0 p-0">
          <legend className="text-xs font-semibold text-foreground">
            Share of each pay period
          </legend>
          {poolGoals.length === 0 && (
            <span className="text-xs text-muted-foreground">No goals in this pool yet.</span>
          )}
          {poolGoals.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-3">
              <span className="text-xs text-foreground truncate">{g.name}</span>
              <div className="relative flex items-center">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  aria-label={`${g.name} share percent`}
                  value={sharesPct[g.id] ?? 0}
                  onChange={(e) =>
                    setSharesPct((prev) => ({ ...prev, [g.id]: Number(e.target.value) }))
                  }
                  className="flex h-8 w-20 rounded-md border border-border bg-card px-2 py-1 text-right text-sm tabular-nums text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="ml-1 text-xs text-muted-foreground">%</span>
              </div>
            </div>
          ))}
          <div
            className={cn(
              "text-xs",
              shareTotal > 100 ? "text-warning font-semibold" : "text-muted-foreground",
            )}
          >
            Goals take {shareTotal}% &middot; buffer keeps {bufferPct}%
          </div>
        </fieldset>

        {/* Sheet Actions */}
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          {isEditing && confirmingDelete && stages.length === 1 && (
            <p className="text-xs text-warning font-medium">
              This is the only stage. Allocations stop until you add one back.
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            {isEditing ? (
              confirmingDelete ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving}
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {saving ? "Deleting..." : "Confirm delete"}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setConfirmingDelete(true)}
                  className="text-destructive hover:bg-destructive/10"
                >
                  Delete stage
                </Button>
              )
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="bg-primary text-primary-foreground font-semibold"
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
