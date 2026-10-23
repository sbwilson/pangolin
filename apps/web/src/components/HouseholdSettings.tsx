import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchHouseholdSettings,
  type HouseholdSettingsData,
  type SharedAttribution,
  updateSharedAttribution,
} from "../api.ts";

export const HOUSEHOLD_KEY = ["household-settings"] as const;

export const ATTRIBUTION_OPTIONS: readonly {
  readonly id: SharedAttribution;
  readonly name: string;
  readonly description: string;
}[] = [
  {
    id: "contribution",
    name: "By contribution",
    description: "Each of you bears shared spending in proportion to what you put in.",
  },
  {
    id: "even",
    name: "50/50",
    description: "Each of you bears half of shared spending, whoever paid.",
  },
];

export function HouseholdSettings() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: HOUSEHOLD_KEY,
    queryFn: fetchHouseholdSettings,
    retry: false,
  });
  const change = useMutation({
    mutationFn: updateSharedAttribution,
    onSuccess: (next: HouseholdSettingsData) => {
      client.setQueryData(HOUSEHOLD_KEY, next);
      // Every report that follows the setting reads it again.
      void client.invalidateQueries({ queryKey: ["reports"] });
    },
  });
  const current = settings.data?.sharedAttribution;

  return (
    <div className="flex flex-col gap-5">
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
          <h2 className="text-base font-semibold leading-tight">Household</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Shared finances and household configuration.
        </p>
      </div>

      <div className="space-y-2">
        <div
          id="attribution-label"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Shared spending attribution
        </div>
        <p className="text-xs text-muted-foreground">
          How your share of shared spending is worked out on Cash flow. Both of you see the same
          shared total.
        </p>
        {settings.isPending ? <p className="text-sm">Loading…</p> : null}
        {settings.isError ? (
          <p role="alert" className="text-sm">
            Household settings are unavailable. Reload to try again.
          </p>
        ) : null}
        {current === undefined ? null : (
          <div
            role="radiogroup"
            aria-labelledby="attribution-label"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            {ATTRIBUTION_OPTIONS.map((opt) => {
              const isSelected = current === opt.id;
              return (
                // biome-ignore lint/a11y/useSemanticElements: custom styled radio button in ARIA radiogroup
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={change.isPending}
                  onClick={() => {
                    if (!isSelected) change.mutate(opt.id);
                  }}
                  className={`flex flex-col rounded-xl border p-3.5 text-left transition-all ${
                    isSelected
                      ? "border-primary bg-accent ring-1 ring-primary"
                      : "border-border bg-card hover:border-muted-foreground/30"
                  }`}
                >
                  <span className="text-sm font-semibold text-foreground">{opt.name}</span>
                  <span className="text-xs text-muted-foreground">{opt.description}</span>
                </button>
              );
            })}
          </div>
        )}
        {change.isError ? (
          <p role="alert" className="text-sm">
            Could not change the setting. Try again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
