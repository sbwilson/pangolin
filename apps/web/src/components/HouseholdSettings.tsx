export function HouseholdSettings() {
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

      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        <p>Pay cycles, the household pay anchor, and split attribution will be configured here.</p>
      </div>
    </div>
  );
}
