import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils.ts";
import {
  type BudgetData,
  createBudget,
  deleteBudget,
  fetchCategories,
  fetchCategoryGroups,
  fetchSuggestedLimit,
  type Me,
  updateBudget,
} from "../api.ts";
import { formatCents, parseCents } from "../lib/money.ts";
import { Button } from "./ui/button.tsx";
import { Sheet } from "./ui/sheet.tsx";

export interface BudgetEditorSheetProps {
  readonly me: Me;
  readonly budget: BudgetData | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function BudgetEditorSheet({
  me,
  budget,
  isOpen,
  onClose,
  onSaved,
}: BudgetEditorSheetProps) {
  const isEditing = budget !== null;

  // Scope: 'shared' or personId
  const [scope, setScope] = useState<"shared" | string>("shared");
  // Target type: category or categoryGroup
  const [targetType, setTargetType] = useState<"category" | "group">("category");
  const [targetId, setTargetId] = useState<string>("");
  // Cadence
  const [cadence, setCadence] = useState<"fortnight" | "month">("fortnight");
  // Limit dollars text
  const [limitInput, setLimitInput] = useState<string>("");
  // Rollover switch
  const [rollover, setRollover] = useState<boolean>(false);

  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Queries for categories and groups
  const categoriesQuery = useQuery({
    queryKey: ["ledger", "categories"],
    queryFn: fetchCategories,
  });

  const categoryGroupsQuery = useQuery({
    queryKey: ["ledger", "category-groups"],
    queryFn: fetchCategoryGroups,
  });

  // Reset form when budget changes or modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (budget) {
      setScope(budget.personId === null ? "shared" : budget.personId);
      if (budget.categoryId) {
        setTargetType("category");
        setTargetId(budget.categoryId);
      } else if (budget.categoryGroupId) {
        setTargetType("group");
        setTargetId(budget.categoryGroupId);
      }
      setCadence(budget.cadence);
      setLimitInput((budget.limitCents / 100).toFixed(0));
      setRollover(budget.rollover);
      setError(null);
    } else {
      setScope("shared");
      setTargetType("category");
      setTargetId("");
      setCadence("fortnight");
      setLimitInput("");
      setRollover(false);
      setError(null);
    }
  }, [isOpen, budget]);

  // Suggested limit query
  const canFetchSuggestion = Boolean(targetId && cadence);
  const suggestedLimitQuery = useQuery({
    queryKey: [
      "planning",
      "budgets",
      "suggested-limit",
      budget?.id,
      scope,
      targetType,
      targetId,
      cadence,
    ],
    queryFn: () => {
      const input: {
        id?: string;
        personId: string | null;
        categoryId: string | null;
        categoryGroupId: string | null;
        cadence: "fortnight" | "month";
      } = {
        personId: scope === "shared" ? null : scope,
        categoryId: targetType === "category" ? targetId : null,
        categoryGroupId: targetType === "group" ? targetId : null,
        cadence,
      };
      if (budget?.id) {
        input.id = budget.id;
      }
      return fetchSuggestedLimit(input);
    },
    enabled: isOpen && canFetchSuggestion,
  });

  const suggestedCents = suggestedLimitQuery.data;

  // Prefill limit when suggestedCents is available and input is currently empty or untouched
  const handleApplySuggestion = () => {
    if (suggestedCents != null) {
      setLimitInput((suggestedCents / 100).toFixed(0));
    }
  };

  // If user picks a category for a new budget and hasn't typed a limit, auto-prefill once loaded
  useEffect(() => {
    if (!isEditing && limitInput === "" && suggestedCents != null && suggestedCents > 0) {
      setLimitInput((suggestedCents / 100).toFixed(0));
    }
  }, [isEditing, suggestedCents, limitInput]);

  if (!isOpen) return null;

  const categories = categoriesQuery.data ?? [];
  const groups = categoryGroupsQuery.data ?? [];

  const handleSave = async () => {
    setError(null);
    if (!targetId) {
      setError("Please select a category or group.");
      return;
    }

    const cents = parseCents(limitInput);
    if (cents === undefined || cents <= 0) {
      setError("Please enter a valid limit greater than zero.");
      return;
    }

    setSaving(true);
    try {
      if (isEditing && budget) {
        await updateBudget(budget.id, {
          categoryId: targetType === "category" ? targetId : null,
          categoryGroupId: targetType === "group" ? targetId : null,
          cadence,
          limitCents: cents,
          rollover,
        });
      } else {
        await createBudget({
          personId: scope === "shared" ? null : scope,
          categoryId: targetType === "category" ? targetId : null,
          categoryGroupId: targetType === "group" ? targetId : null,
          cadence,
          limitCents: cents,
          rollover,
        });
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save budget");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!budget) return;
    setSaving(true);
    try {
      await deleteBudget(budget.id);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete budget");
    } finally {
      setSaving(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Sheet
      title={isEditing ? "Edit budget" : "New budget"}
      description="Shared budgets show for both of you. Personal ones are just for you."
      onClose={onClose}
    >
      <div className="flex flex-col gap-5 py-2">
        {error && (
          <div className="rounded-lg bg-warning-bg p-3 text-xs text-warning font-medium">
            {error}
          </div>
        )}

        {/* Target Entity Selection: Category vs Group */}
        <fieldset className="flex flex-col gap-1.5 m-0 border-0 p-0">
          <legend className="text-xs font-semibold text-foreground">Target type</legend>
          <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
            <button
              type="button"
              onClick={() => {
                setTargetType("category");
                setTargetId("");
              }}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                targetType === "category"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Category
            </button>
            <button
              type="button"
              onClick={() => {
                setTargetType("group");
                setTargetId("");
              }}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                targetType === "group"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Category Group
            </button>
          </div>
        </fieldset>

        {/* Target Selector Dropdown */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="budget-target-select" className="text-xs font-semibold text-foreground">
            {targetType === "category" ? "Category" : "Category Group"}
          </label>
          <select
            id="budget-target-select"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="" disabled>
              Select a {targetType === "category" ? "category" : "group"}...
            </option>
            {targetType === "category"
              ? categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} ({cat.groupName || "Unassigned"})
                  </option>
                ))
              : groups.map((grp) => (
                  <option key={grp.id} value={grp.id}>
                    {grp.name}
                  </option>
                ))}
          </select>
        </div>

        {/* Who it's for: Scope Toggle (Shared / Person) */}
        {!isEditing && (
          <fieldset className="flex flex-col gap-1.5 m-0 border-0 p-0" aria-label="Scope">
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

        {/* Cadence: Fortnight / Month */}
        <fieldset className="flex flex-col gap-1.5 m-0 border-0 p-0" aria-label="Period">
          <legend className="text-xs font-semibold text-foreground">Period</legend>
          <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setCadence("fortnight")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                cadence === "fortnight"
                  ? "bg-card text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Fortnight
            </button>
            <button
              type="button"
              onClick={() => setCadence("month")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                cadence === "month"
                  ? "bg-card text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Month
            </button>
          </div>
        </fieldset>

        {/* Limit Input with Pre-filled Suggestion */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="budget-limit-input" className="text-xs font-semibold text-foreground">
            Limit
          </label>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-sm text-muted-foreground">$</span>
            <input
              id="budget-limit-input"
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              className="flex h-9 w-full rounded-md border border-border bg-card pl-7 pr-3 py-1 text-sm tabular-nums text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Helper / Suggestion Note */}
          {suggestedLimitQuery.isLoading ? (
            <span className="text-xs text-muted-foreground">Checking spending history...</span>
          ) : suggestedCents != null ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                You&#8217;ve averaged {formatCents(suggestedCents)} a {cadence}.
              </span>
              <button
                type="button"
                onClick={handleApplySuggestion}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Use this
              </button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No spending history yet</span>
          )}
        </div>

        {/* Rollover Toggle */}
        <div className="flex items-center justify-between gap-4 pt-1 border-t border-border">
          <div>
            <div className="text-xs font-semibold text-foreground">Roll over what&#8217;s left</div>
            <div className="text-xs text-muted-foreground">
              Unspent money carries into the next {cadence}.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={rollover}
            onClick={() => setRollover(!rollover)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              rollover ? "bg-primary" : "bg-border",
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block size-4 transform rounded-full bg-card shadow-lg ring-0 transition duration-200 ease-in-out",
                rollover ? "translate-x-4" : "translate-x-0",
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
