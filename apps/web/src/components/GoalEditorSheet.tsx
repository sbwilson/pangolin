import { useState } from "react";
import { cn } from "@/lib/utils.ts";
import { createGoal, deleteGoal, type GoalData, type Me, updateGoal } from "../api.ts";
import { centsToText, parseCents } from "../lib/money.ts";
import { Button } from "./ui/button.tsx";
import { Sheet } from "./ui/sheet.tsx";

export interface GoalEditorSheetProps {
  readonly me: Me;
  /** The goal being edited; null when creating a new one. */
  readonly goal: GoalData | null;
  /** Every visible goal, used to find the pool's existing emergency fund. */
  readonly goals: ReadonlyArray<GoalData>;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function GoalEditorSheet({
  me,
  goal,
  goals,
  isOpen,
  onClose,
  onSaved,
}: GoalEditorSheetProps) {
  const isEditing = goal !== null;

  const [scope, setScope] = useState<"shared" | string>("shared");
  const [name, setName] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [kind, setKind] = useState<"flexible" | "protected">("flexible");
  const [isEmergencyFund, setIsEmergencyFund] = useState(false);

  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One-time reset flag so the form keeps state between renders while open.
  const [lastInit, setLastInit] = useState<string | null>(null);

  const initKey = isOpen ? (goal?.id ?? "new") : null;
  if (initKey !== lastInit) {
    setLastInit(initKey);
    if (goal) {
      setScope(goal.personId === null ? "shared" : goal.personId);
      setName(goal.name);
      setTargetInput(centsToText(goal.targetCents));
      setTargetDate(goal.targetDate ?? "");
      setKind(goal.kind);
      setIsEmergencyFund(goal.isEmergencyFund);
      setError(null);
    } else if (isOpen) {
      setScope("shared");
      setName("");
      setTargetInput("");
      setTargetDate("");
      setKind("flexible");
      setIsEmergencyFund(false);
      setError(null);
    }
  }

  if (!isOpen) return null;

  // The pool's existing emergency fund, if any (never the goal being edited).
  const poolEf = goals.find(
    (g) =>
      g.isEmergencyFund &&
      (g.personId === null ? "shared" : g.personId) === scope &&
      g.id !== goal?.id,
  );
  const efSwitchDisabled = poolEf !== undefined && !isEmergencyFund;

  const handleSave = async () => {
    setError(null);
    if (name.trim() === "") {
      setError("Please give the goal a name.");
      return;
    }
    const cents = parseCents(targetInput);
    if (cents === undefined || cents <= 0) {
      setError("Please enter a target amount greater than zero.");
      return;
    }
    if (targetDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setError("Please enter the target date as YYYY-MM-DD, or leave it empty.");
      return;
    }

    setSaving(true);
    try {
      if (isEditing && goal) {
        await updateGoal(goal.id, {
          name: name.trim(),
          targetCents: cents,
          targetDate: targetDate === "" ? null : targetDate,
          kind: isEmergencyFund ? "protected" : kind,
          isEmergencyFund,
        });
      } else {
        await createGoal({
          name: name.trim(),
          targetCents: cents,
          targetDate: targetDate === "" ? null : targetDate,
          kind: isEmergencyFund ? "protected" : kind,
          isEmergencyFund,
          pool: scope === "shared" ? null : scope,
        });
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save goal");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!goal) return;
    setSaving(true);
    try {
      await deleteGoal(goal.id);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete goal");
    } finally {
      setSaving(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Sheet
      title={isEditing ? "Edit goal" : "New goal"}
      description="Goals share the savings pot. The buffer is what is left over each pay period."
      onClose={onClose}
    >
      <div className="flex flex-col gap-5 py-2">
        {error && (
          <div className="rounded-lg bg-warning-bg p-3 text-xs text-warning font-medium">
            {error}
          </div>
        )}

        {/* Who it's for: pool segmented control (new goals only) */}
        {!isEditing && (
          <fieldset className="flex flex-col gap-1.5 m-0 border-0 p-0" aria-label="Pool">
            <legend className="text-xs font-semibold text-foreground">Who it&#8217;s for</legend>
            <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
              <button
                type="button"
                onClick={() => setScope("shared")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  scope === "shared"
                    ? "bg-card text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Shared
              </button>
              <button
                type="button"
                onClick={() => setScope(me.personId)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  scope === me.personId
                    ? "bg-card text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {me.displayName}
              </button>
            </div>
          </fieldset>
        )}

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="goal-name-input" className="text-xs font-semibold text-foreground">
            Name
          </label>
          <input
            id="goal-name-input"
            type="text"
            placeholder="Holiday"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Target amount */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="goal-target-input" className="text-xs font-semibold text-foreground">
            Target
          </label>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-sm text-muted-foreground">$</span>
            <input
              id="goal-target-input"
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="flex h-9 w-full rounded-md border border-border bg-card pl-7 pr-3 py-1 text-sm tabular-nums text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Optional target date */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="goal-date-input" className="text-xs font-semibold text-foreground">
            Target date <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="goal-date-input"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm tabular-nums text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Kind toggle, hidden while the emergency-fund switch is on (it forces protected) */}
        {!isEmergencyFund && (
          <fieldset className="flex flex-col gap-1.5 m-0 border-0 p-0" aria-label="Goal type">
            <legend className="text-xs font-semibold text-foreground">Goal type</legend>
            <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
              <button
                type="button"
                onClick={() => setKind("flexible")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === "flexible"
                    ? "bg-card text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Flexible
              </button>
              <button
                type="button"
                onClick={() => setKind("protected")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === "protected"
                    ? "bg-card text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Protected
              </button>
            </div>
          </fieldset>
        )}

        {/* Emergency fund switch */}
        <div className="flex items-center justify-between gap-4 pt-1 border-t border-border">
          <div>
            <div className="text-xs font-semibold text-foreground">Emergency fund</div>
            <div className="text-xs text-muted-foreground">
              {efSwitchDisabled
                ? `${scope === "shared" ? "Shared savings" : "Your savings"} already has one: ${poolEf?.name}`
                : "Protected money you can fall back on."}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Emergency fund"
            aria-checked={isEmergencyFund}
            disabled={efSwitchDisabled}
            onClick={() => setIsEmergencyFund(!isEmergencyFund)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              isEmergencyFund ? "bg-primary" : "bg-border",
              efSwitchDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block size-4 transform rounded-full bg-card shadow-lg ring-0 transition duration-200 ease-in-out",
                isEmergencyFund ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
        </div>

        {/* Sheet Actions */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
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
                Delete
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
    </Sheet>
  );
}
