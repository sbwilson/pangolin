import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  fetchAccounts,
  fetchHouseholdSettings,
  fetchPayAnchor,
  type HouseholdSettingsData,
  type PayAnchorData,
  type SharedAttribution,
  updateHouseholdSettings,
  upsertPayAnchor,
} from "../api.ts";
import { centsToText, parseCents } from "../lib/money.ts";
import { useSignedIn } from "../session.tsx";
import { Button } from "./ui/button.tsx";
import { DateInput } from "./ui/date-input.tsx";
import { INPUT_CLASS_RING_DISABLED } from "./ui/input-class.ts";
import { NativeSelect } from "./ui/select.tsx";

export const HOUSEHOLD_KEY = ["household-settings"] as const;
export const PAY_ANCHOR_KEY = ["pay-anchor"] as const;
export const ACCOUNTS_KEY = ["accounts"] as const;

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
  const { me } = useSignedIn();
  const client = useQueryClient();

  const settings = useQuery({
    queryKey: HOUSEHOLD_KEY,
    queryFn: fetchHouseholdSettings,
    retry: false,
  });

  const payAnchorQuery = useQuery({
    queryKey: PAY_ANCHOR_KEY,
    queryFn: () => fetchPayAnchor(),
    retry: false,
  });

  const accountsQuery = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: fetchAccounts,
    retry: false,
  });

  const updateHousehold = useMutation({
    mutationFn: updateHouseholdSettings,
    onSuccess: (next: HouseholdSettingsData) => {
      client.setQueryData(HOUSEHOLD_KEY, next);
      void client.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  const savePayAnchor = useMutation({
    mutationFn: upsertPayAnchor,
    onSuccess: (saved: PayAnchorData) => {
      client.setQueryData(PAY_ANCHOR_KEY, saved);
      void client.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  // Local state for personal pay anchor form
  const [cadence, setCadence] = useState<"fortnightly" | "monthly">("fortnightly");
  const [alignment, setAlignment] = useState<"calendar" | "deposit">("calendar");
  const [accountId, setAccountId] = useState<string>("");
  const [anchorDate, setAnchorDate] = useState<string>("");
  const [dayOfMonth, setDayOfMonth] = useState<number>(15);
  const [expectedNet, setExpectedNet] = useState<string>("");
  const [expectedGross, setExpectedGross] = useState<string>("");
  const [payAnchorError, setPayAnchorError] = useState<string | null>(null);

  // Sync loaded personal pay anchor into local form state
  useEffect(() => {
    if (payAnchorQuery.data) {
      const a = payAnchorQuery.data;
      setCadence(a.cadence);
      setAlignment(a.alignment);
      setAccountId(a.accountId);
      if (a.anchorDate) setAnchorDate(a.anchorDate);
      if (a.dayOfMonth) setDayOfMonth(a.dayOfMonth);
      if (a.expectedNetCents !== null) setExpectedNet(centsToText(a.expectedNetCents));
      if (a.expectedGrossCents !== null) setExpectedGross(centsToText(a.expectedGrossCents));
    } else if (accountsQuery.data && accountsQuery.data.length > 0 && !accountId) {
      const firstAccount = accountsQuery.data[0];
      if (firstAccount) setAccountId(firstAccount.id);
    }
  }, [payAnchorQuery.data, accountsQuery.data, accountId]);

  const currentAttribution = settings.data?.sharedAttribution;
  const currentHouseholdPayAnchorPersonId = settings.data?.householdPayAnchorPersonId ?? "";

  const people = [
    { id: me.personId, name: me.displayName || "You" },
    ...(me.partner ? [{ id: me.partner.personId, name: me.partner.displayName || "Partner" }] : []),
  ];

  const handleSavePayAnchor = (e: React.FormEvent) => {
    e.preventDefault();
    setPayAnchorError(null);

    if (!accountId) {
      setPayAnchorError("Please choose a deposit account.");
      return;
    }

    if (cadence === "fortnightly" && !anchorDate) {
      setPayAnchorError("Please choose an anchor pay date.");
      return;
    }

    const netCents = expectedNet.trim() ? parseCents(expectedNet.trim()) : null;
    const grossCents = expectedGross.trim() ? parseCents(expectedGross.trim()) : null;

    savePayAnchor.mutate(
      {
        accountId,
        cadence,
        alignment,
        anchorDate: cadence === "fortnightly" ? anchorDate : null,
        dayOfMonth: cadence === "monthly" ? Number(dayOfMonth) : null,
        expectedNetCents: netCents ?? null,
        expectedGrossCents: grossCents ?? null,
      },
      {
        onError: (err: any) => {
          setPayAnchorError(err?.message ?? "Could not save pay anchor.");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-8">
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
          Shared finances, pay cycles, and household configuration.
        </p>
      </div>

      {/* Shared spending attribution */}
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
          <p role="alert" className="text-sm text-destructive">
            Household settings are unavailable. Reload to try again.
          </p>
        ) : null}
        {currentAttribution === undefined ? null : (
          <div
            role="radiogroup"
            aria-labelledby="attribution-label"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            {ATTRIBUTION_OPTIONS.map((opt) => {
              const isSelected = currentAttribution === opt.id;
              return (
                // biome-ignore lint/a11y/useSemanticElements: custom styled radio button in ARIA radiogroup
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={updateHousehold.isPending}
                  onClick={() => {
                    if (!isSelected) updateHousehold.mutate({ sharedAttribution: opt.id });
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
        {updateHousehold.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not change the setting. Try again.
          </p>
        ) : null}
      </div>

      {/* Household Pay Anchor / Cadence Leader */}
      <div className="space-y-3 border-t border-border pt-6">
        <div>
          <label
            htmlFor="household-pay-anchor-select"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Household Pay Cycle
          </label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select whose pay schedule sets the household budget and planning cadence.
          </p>
        </div>

        <div className="max-w-xs">
          <NativeSelect
            id="household-pay-anchor-select"
            aria-label="Household pay cycle leader"
            value={currentHouseholdPayAnchorPersonId}
            disabled={updateHousehold.isPending}
            onChange={(e) => {
              const val = e.target.value;
              updateHousehold.mutate({
                householdPayAnchorPersonId: val === "" ? null : val,
              });
            }}
          >
            <option value="">Default (Calendar Month)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {/* Personal Pay Anchor Configuration */}
      <form onSubmit={handleSavePayAnchor} className="space-y-4 border-t border-border pt-6">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Personal Pay Anchor
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure your pay cycle and salary deposit account for personal planning. Your pay
            anchor details are private and never shared with your partner.
          </p>
        </div>

        {payAnchorQuery.isPending ? <p className="text-sm">Loading pay anchor…</p> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-xl">
          <div>
            <label htmlFor="pay-cadence" className="block text-xs font-medium text-foreground mb-1">
              Pay Cadence
            </label>
            <NativeSelect
              id="pay-cadence"
              aria-label="Pay cadence"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as "fortnightly" | "monthly")}
            >
              <option value="fortnightly">Fortnightly (Every 2 weeks)</option>
              <option value="monthly">Monthly</option>
            </NativeSelect>
          </div>

          <div>
            <label
              htmlFor="pay-alignment"
              className="block text-xs font-medium text-foreground mb-1"
            >
              Cycle Alignment
            </label>
            <NativeSelect
              id="pay-alignment"
              aria-label="Cycle alignment"
              value={alignment}
              onChange={(e) => setAlignment(e.target.value as "calendar" | "deposit")}
            >
              <option value="calendar">Calendar rule (fixed schedule)</option>
              <option value="deposit">Deposit detection (tracks actual pay)</option>
            </NativeSelect>
          </div>

          {cadence === "fortnightly" ? (
            <div>
              <label
                htmlFor="pay-anchor-date"
                className="block text-xs font-medium text-foreground mb-1"
              >
                Recent Pay Date (Anchor)
              </label>
              <DateInput
                id="pay-anchor-date"
                aria-label="Recent pay date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
              />
            </div>
          ) : (
            <div>
              <label
                htmlFor="pay-day-of-month"
                className="block text-xs font-medium text-foreground mb-1"
              >
                Day of Month (1–31)
              </label>
              <input
                id="pay-day-of-month"
                aria-label="Day of month"
                type="number"
                min={1}
                max={31}
                className={INPUT_CLASS_RING_DISABLED}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
              />
            </div>
          )}

          <div>
            <label htmlFor="pay-account" className="block text-xs font-medium text-foreground mb-1">
              Deposit Account
            </label>
            <NativeSelect
              id="pay-account"
              aria-label="Deposit account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="" disabled>
                Select account
              </option>
              {accountsQuery.data?.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <label
              htmlFor="pay-expected-net"
              className="block text-xs font-medium text-foreground mb-1"
            >
              Expected Net Pay ($)
            </label>
            <input
              id="pay-expected-net"
              aria-label="Expected net pay"
              type="text"
              placeholder="e.g. 3200.00"
              className={INPUT_CLASS_RING_DISABLED}
              value={expectedNet}
              onChange={(e) => setExpectedNet(e.target.value)}
            />
          </div>

          <div>
            <label
              htmlFor="pay-expected-gross"
              className="block text-xs font-medium text-foreground mb-1"
            >
              Expected Gross Pay ($ optional)
            </label>
            <input
              id="pay-expected-gross"
              aria-label="Expected gross pay"
              type="text"
              placeholder="e.g. 4500.00"
              className={INPUT_CLASS_RING_DISABLED}
              value={expectedGross}
              onChange={(e) => setExpectedGross(e.target.value)}
            />
          </div>
        </div>

        {payAnchorError ? (
          <p role="alert" className="text-sm text-destructive">
            {payAnchorError}
          </p>
        ) : null}

        {savePayAnchor.isSuccess ? (
          <p className="text-sm text-green-600 dark:text-green-400">
            Pay anchor saved successfully.
          </p>
        ) : null}

        <div>
          <Button type="submit" disabled={savePayAnchor.isPending}>
            {savePayAnchor.isPending ? "Saving…" : "Save Pay Anchor"}
          </Button>
        </div>
      </form>
    </div>
  );
}
