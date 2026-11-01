import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  type BudgetData,
  fetchBudgetSummaries,
  fetchCategories,
  fetchCategoryGroups,
  listAccounts,
} from "../api.ts";
import { BudgetCard } from "../components/BudgetCard.tsx";
import { BudgetEditorSheet } from "../components/BudgetEditorSheet.tsx";
import { useOptionalImport } from "../components/import/index.ts";
import { MascotIcon } from "../components/MascotLogo.tsx";
import { Button } from "../components/ui/button.tsx";
import { freshnessLabel } from "../lib/freshness.ts";
import { useSignedIn } from "../session.tsx";

export function BudgetsPage() {
  const { me } = useSignedIn();
  const importControls = useOptionalImport();

  // Scope filter: "all" | "shared" | "personal"
  const [filterScope, setFilterScope] = useState<"all" | "shared" | "personal">("all");

  // State for editor modal
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<BudgetData | null>(null);

  // Queries
  const summariesQuery = useQuery({
    queryKey: ["planning", "budgets", "summary"],
    queryFn: fetchBudgetSummaries,
  });

  const categoriesQuery = useQuery({
    queryKey: ["ledger", "categories"],
    queryFn: fetchCategories,
  });

  const categoryGroupsQuery = useQuery({
    queryKey: ["ledger", "category-groups"],
    queryFn: fetchCategoryGroups,
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
  });

  const summaries = summariesQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const categoryGroups = categoryGroupsQuery.data ?? [];

  // Map category ID and Group ID to display names
  const categoryNameMap = useMemo(() => {
    return new Map(categories.map((c) => [c.id, c.name]));
  }, [categories]);

  const groupNameMap = useMemo(() => {
    return new Map(categoryGroups.map((g) => [g.id, g.name]));
  }, [categoryGroups]);

  // Determine newest import freshness from accounts
  const freshnessText = useMemo(() => {
    const accounts = accountsQuery.data ?? [];
    let latest: { through: string; source: string; importedAt: string } | null = null;
    for (const acc of accounts) {
      if (acc.lastImport) {
        if (!latest || acc.lastImport.through > latest.through) {
          latest = acc.lastImport;
        }
      }
    }
    return latest ? freshnessLabel(latest) : "No imports yet";
  }, [accountsQuery.data]);

  // Overall counts for summary row
  const totalCount = summaries.length;
  const overCount = summaries.filter((s) => s.status === "over-budget").length;
  const headingOverCount = summaries.filter((s) => s.status === "heading-over").length;
  const onTrackCount = summaries.filter((s) => s.status === "on-track").length;

  // Filtered summaries according to filterScope
  const filteredSummaries = useMemo(() => {
    return summaries.filter((s) => {
      if (filterScope === "shared") {
        return s.budget.personId === null;
      }
      if (filterScope === "personal") {
        return s.budget.personId !== null;
      }
      return true;
    });
  }, [summaries, filterScope]);

  const handleOpenNew = () => {
    setSelectedBudget(null);
    setIsEditorOpen(true);
  };

  const handleOpenEdit = (budget: BudgetData) => {
    setSelectedBudget(budget);
    setIsEditorOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <MascotIcon size="sm" />
            <span>G’day, {me.displayName}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
          <p className="text-xs text-muted-foreground mt-1">{freshnessText}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => importControls?.openImport()}
            className="bg-primary text-primary-foreground font-semibold inline-flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
            </svg>
            Import
          </Button>
        </div>
      </div>

      {/* Summary Row + Filter Bar + New Budget Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-3">
        {/* Summary text */}
        <div className="text-xs sm:text-sm text-muted-foreground" data-testid="budget-summary-line">
          <b className="text-foreground">
            {totalCount} {totalCount === 1 ? "budget" : "budgets"}
          </b>{" "}
          you can see · <span>{overCount} over</span> · <span>{headingOverCount} heading over</span>{" "}
          · <span>{onTrackCount} on track</span>
        </div>

        {/* Filter segment + New Budget button */}
        <div className="flex items-center gap-2">
          {/* Scope Segment Filter */}
          <fieldset
            className="inline-flex rounded-lg border border-border bg-muted p-0.5 m-0 border-0"
            aria-label="Scope filter"
          >
            <legend className="sr-only">Scope filter</legend>
            <button
              type="button"
              onClick={() => setFilterScope("all")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filterScope === "all"
                  ? "bg-card text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("shared")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filterScope === "shared"
                  ? "bg-card text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Shared
            </button>
            <button
              type="button"
              onClick={() => setFilterScope("personal")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filterScope === "personal"
                  ? "bg-card text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Personal
            </button>
          </fieldset>

          <Button
            type="button"
            variant="outline"
            onClick={handleOpenNew}
            className="inline-flex items-center gap-1.5 text-xs font-semibold"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New budget
          </Button>
        </div>
      </div>

      {/* Main Budget Grid or Empty State */}
      {summariesQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-48 rounded-xl border border-border bg-card/60 animate-pulse" />
          <div className="h-48 rounded-xl border border-border bg-card/60 animate-pulse" />
        </div>
      ) : filteredSummaries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-primary mb-3">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7h16a2 2 0 0 1 2 2v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM5 7l3-3h9v3M16 13h2" />
            </svg>
          </div>
          <h3 className="font-semibold text-foreground text-base">Nothing to sniff at yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            {summaries.length === 0
              ? "Set limits on your categories or groups to track spending pace across pay cycles."
              : "No budgets match your current scope filter."}
          </p>
          {summaries.length === 0 && (
            <Button
              type="button"
              onClick={handleOpenNew}
              className="mt-4 bg-primary text-primary-foreground font-semibold inline-flex items-center gap-1.5"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create your first budget
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredSummaries.map((summary) => {
            const targetName = summary.budget.categoryId
              ? (categoryNameMap.get(summary.budget.categoryId) ?? "Category")
              : summary.budget.categoryGroupId
                ? (groupNameMap.get(summary.budget.categoryGroupId) ?? "Group")
                : "Budget";

            const ownerDisplayName =
              summary.budget.personId === me.personId ? me.displayName : "Personal";

            const ownerColour =
              summary.budget.personId === me.personId ? (me.colour ?? null) : null;

            return (
              <BudgetCard
                key={summary.budget.id}
                summary={summary}
                targetName={targetName}
                ownerDisplayName={ownerDisplayName}
                ownerColour={ownerColour}
                onEdit={() => handleOpenEdit(summary.budget)}
              />
            );
          })}
        </div>
      )}

      {/* Budget Editor Sheet */}
      <BudgetEditorSheet
        me={me}
        budget={selectedBudget}
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSaved={() => {
          void summariesQuery.refetch();
        }}
      />
    </div>
  );
}
