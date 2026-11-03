import { Temporal } from "@pangolin/shared/temporal";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  type AccountSummary,
  createRecurringSeries,
  fetchPayees,
  listAccounts,
  type PayeeData,
} from "../api.ts";
import { parseCents } from "../lib/money.ts";
import { Button } from "./ui/button.tsx";
import { Combobox } from "./ui/combobox.tsx";
import { INPUT_CLASS_RING_DISABLED } from "./ui/input-class.ts";
import { NativeSelect } from "./ui/select.tsx";
import { Sheet } from "./ui/sheet.tsx";

export interface RecurringBillEditorSheetProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

const CADENCES = [
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
] as const;

export function RecurringBillEditorSheet({
  isOpen,
  onClose,
  onSaved,
}: RecurringBillEditorSheetProps) {
  const [accountId, setAccountId] = useState<string>("");
  const [payeeId, setPayeeId] = useState<string>("");
  const [cadence, setCadence] = useState<
    "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual"
  >("monthly");
  const [amountInput, setAmountInput] = useState<string>("");
  const [nextDueOn, setNextDueOn] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Queries
  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    enabled: isOpen,
  });

  const payeesQuery = useQuery({
    queryKey: ["classify", "payees"],
    queryFn: fetchPayees,
    enabled: isOpen,
  });

  const accounts: AccountSummary[] = accountsQuery.data ?? [];
  const payees: PayeeData[] = payeesQuery.data ?? [];

  // Reset form when opened
  useEffect(() => {
    if (!isOpen) return;
    setAccountId("");
    setPayeeId("");
    setCadence("monthly");
    setAmountInput("");
    // Default next due date to today
    const today = Temporal.Now.plainDateISO().toString();
    setNextDueOn(today);
    setError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const payeeOptions = payees.map((p) => ({
    id: p.id,
    label: p.name,
  }));

  const selectedPayeeLabel = payees.find((p) => p.id === payeeId)?.name ?? "";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!accountId) {
      setError("Please select an account.");
      return;
    }
    if (!payeeId) {
      setError("Please select a payee.");
      return;
    }
    const cents = parseCents(amountInput);
    if (cents === undefined || cents <= 0) {
      setError("Please enter a valid amount greater than $0.00.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDueOn)) {
      setError("Please enter a valid next due date (YYYY-MM-DD).");
      return;
    }

    setSaving(true);
    try {
      await createRecurringSeries({
        accountId,
        payeeId,
        direction: "bill",
        cadence,
        expectedCents: cents,
        toleranceBp: 1500,
        nextDueOn,
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create recurring bill.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      title="Add recurring bill"
      description="Track and predict upcoming recurring bills and subscriptions."
      onClose={onClose}
    >
      <form onSubmit={handleSave} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive font-medium"
          >
            {error}
          </div>
        )}

        {/* Account Select */}
        <div>
          <label htmlFor="bill-account" className="block text-xs font-medium text-foreground mb-1">
            Account
          </label>
          <NativeSelect
            id="bill-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={saving}
            className="w-full"
          >
            <option value="">Select an account</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        {/* Payee Picker */}
        <div>
          <span className="block text-xs font-medium text-foreground mb-1">Payee</span>
          {payeeOptions.length > 0 ? (
            <Combobox
              label="Payee"
              options={payeeOptions}
              selectedLabel={selectedPayeeLabel}
              placeholder="Search payees..."
              disabled={saving}
              onSelect={(id) => setPayeeId(id)}
              className="w-full"
            />
          ) : (
            <input
              type="text"
              placeholder="No payees found"
              disabled
              className={INPUT_CLASS_RING_DISABLED}
            />
          )}
        </div>

        {/* Cadence Select */}
        <div>
          <label htmlFor="bill-cadence" className="block text-xs font-medium text-foreground mb-1">
            Cadence
          </label>
          <NativeSelect
            id="bill-cadence"
            value={cadence}
            onChange={(e) =>
              setCadence(
                e.target.value as "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual",
              )
            }
            disabled={saving}
            className="w-full"
          >
            {CADENCES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        {/* Expected Amount */}
        <div>
          <label htmlFor="bill-amount" className="block text-xs font-medium text-foreground mb-1">
            Expected amount ($)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">
              $
            </span>
            <input
              id="bill-amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={saving}
              className={`${INPUT_CLASS_RING_DISABLED} pl-7`}
            />
          </div>
        </div>

        {/* Next Due Date */}
        <div>
          <label htmlFor="bill-due-date" className="block text-xs font-medium text-foreground mb-1">
            Next due date (YYYY-MM-DD)
          </label>
          <input
            id="bill-due-date"
            type="date"
            value={nextDueOn}
            onChange={(e) => setNextDueOn(e.target.value)}
            disabled={saving}
            className={INPUT_CLASS_RING_DISABLED}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-border/50">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
            className="text-xs bg-primary text-primary-foreground font-semibold"
          >
            {saving ? "Saving..." : "Save recurring bill"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
