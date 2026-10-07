import { useMemo, useState } from "react";
import {
  ApiError,
  type CategorySummary,
  hideName,
  type LedgerSplit,
  type LedgerTag,
  type LedgerTransaction,
  type Me,
  setSplitField,
  setSplits,
  setSplitTags,
  unhideName,
  updateNotes,
} from "../api.ts";
import { Button } from "../components/ui/button.tsx";
import { CategoryCombobox } from "../components/ui/category-combobox.tsx";
import { DateInput } from "../components/ui/date-input.tsx";
import { NativeSelect } from "../components/ui/select.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { TagPicker } from "../components/ui/tag-picker.tsx";
import { localDay } from "../lib/date-range.ts";
import { hiddenUntilLabel, hidingActive, longDay, utcDay, WINK_LINE } from "../lib/hidden.ts";
import { centsToText, parseCents } from "../lib/money.ts";
import { formatCents } from "./TransactionsTable.tsx";

/** The message a refused `setSplitField` shows. */
export const KEPT_MESSAGE = "Kept: a higher-ranked source set this";

type Notice = { readonly kind: "error" | "kept"; readonly text: string };

/** One row of the split editor: an existing split (`id`) or a new one, and its amount text. */
interface Draft {
  readonly key: string;
  readonly id?: string;
  readonly amount: string;
}

const draftsOf = (txn: LedgerTransaction): Draft[] =>
  txn.splits.map((s) => ({ key: s.id, id: s.id, amount: centsToText(s.amountCents) }));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong";

/**
 * The transaction sheet: splits, category, tags, notes, beneficiary and name hiding for one
 * transaction. Every write answers with the whole transaction, which replaces what the sheet and
 * the list row show; the remaining amount is the server's `remainingCents`, never worked out here.
 */
export function TransactionSheet({
  transaction,
  me,
  accountName,
  categories,
  tags,
  onChange,
  onClose,
}: {
  transaction: LedgerTransaction;
  me: Me;
  accountName: string;
  categories: readonly CategorySummary[];
  tags: readonly LedgerTag[];
  /** Called with each transaction a write returns. */
  onChange: (transaction: LedgerTransaction) => void;
  onClose: () => void;
}) {
  const [txn, setTxn] = useState(transaction);
  const [drafts, setDrafts] = useState(() => draftsOf(transaction));
  const [newKey, setNewKey] = useState(0);
  const [notes, setNotes] = useState(transaction.notes ?? "");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** The server's remaining amount from a refused split edit, until the next good write. */
  const [refusedRemaining, setRefusedRemaining] = useState<number | null>(null);

  const today = useMemo(() => localDay(new Date()), []);
  const partner = me.partner;
  const hiding = hidingActive(txn.nameHiddenUntil, utcDay(new Date()));
  const hiddenByMe = hiding && txn.nameHiddenBy === me.personId;
  const title = txn.nameHidden ? hiddenUntilLabel(txn.nameHiddenUntil) : txn.descriptionRaw;
  const remaining = refusedRemaining ?? txn.remainingCents;

  const beneficiaries = [
    { id: "shared", label: "Shared" },
    { id: me.personId, label: me.displayName },
    ...(partner === null ? [] : [{ id: partner.personId, label: partner.displayName }]),
  ];

  const accept = (next: LedgerTransaction) => {
    setTxn(next);
    setRefusedRemaining(null);
    onChange(next);
  };

  /** Runs a write; a failure is shown inline, a success replaces the transaction. */
  const run = async (write: () => Promise<LedgerTransaction | undefined>) => {
    setBusy(true);
    setNotice(null);
    setRefusedRemaining(null);
    try {
      const next = await write();
      if (next !== undefined) accept(next);
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
      const remainingCents = error instanceof ApiError ? error.details?.remainingCents : undefined;
      if (typeof remainingCents === "number") setRefusedRemaining(remainingCents);
    } finally {
      setBusy(false);
    }
  };

  const saveSplits = () => {
    const parsed = drafts.map((d) => ({ draft: d, cents: parseCents(d.amount) }));
    if (parsed.some((p) => p.cents === undefined)) {
      setNotice({ kind: "error", text: "Enter each amount in dollars and cents, like -4.50" });
      return;
    }
    void run(async () => {
      const next = await setSplits(
        txn.id,
        parsed.map(({ draft, cents }) => ({
          ...(draft.id === undefined ? {} : { id: draft.id }),
          amountCents: cents as number,
        })),
      );
      setDrafts(draftsOf(next));
      return next;
    });
  };

  const setField = (split: LedgerSplit, field: "category" | "beneficiary", value: string | null) =>
    run(async () => {
      const result = await setSplitField(txn.id, split.id, field, value);
      if (!result.applied) setNotice({ kind: "kept", text: KEPT_MESSAGE });
      // `run` clears the notice before calling this write, so the kept notice set here stays.
      return result.transaction;
    });

  return (
    <Sheet
      title={title}
      description={txn.nameHidden ? WINK_LINE : `${longDay(txn.postedOn)} · ${accountName}`}
      onClose={onClose}
    >
      <p className="m-0 mb-2 text-sm">
        <span className="tabular-nums">{formatCents(txn.amountCents)}</span>
        {" · "}
        <span aria-live="polite">
          Remaining <span className="tabular-nums">{formatCents(remaining)}</span>
        </span>
      </p>

      {notice === null ? null : (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={notice.kind === "error" ? "text-destructive" : "text-muted-foreground"}
        >
          {notice.text}
        </p>
      )}

      <section aria-labelledby="sheet-splits" className="mb-4">
        <h3 id="sheet-splits" className="m-0 mb-1 text-base">
          Splits
        </h3>
        {drafts.map((draft, index) => {
          const split = txn.splits.find((s) => s.id === draft.id);
          const n = index + 1;
          return (
            <fieldset key={draft.key} className="mb-2 grid gap-2 rounded-md border p-2">
              <legend className="px-1 text-sm">Split {n}</legend>
              <label className="m-0 text-sm" htmlFor={`split-${draft.key}-amount`}>
                Split {n} amount
                <input
                  id={`split-${draft.key}-amount`}
                  inputMode="decimal"
                  value={draft.amount}
                  className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm tabular-nums"
                  onChange={(event) =>
                    setDrafts((all) =>
                      all.map((d) =>
                        d.key === draft.key ? { ...d, amount: event.target.value } : d,
                      ),
                    )
                  }
                />
              </label>
              {split === undefined ? (
                <p className="m-0 text-sm text-muted-foreground">
                  Save the splits to set this one's category, beneficiary and tags.
                </p>
              ) : (
                <>
                  <div className="text-sm">
                    <span className="block">Split {n} category</span>
                    <CategoryCombobox
                      label={`Split ${n} category`}
                      categories={categories}
                      value={split.categoryId}
                      disabled={busy}
                      onChange={(id) => void setField(split, "category", id)}
                    />
                  </div>
                  <label className="m-0 text-sm" htmlFor={`split-${draft.key}-beneficiary`}>
                    Split {n} beneficiary
                    <NativeSelect
                      id={`split-${draft.key}-beneficiary`}
                      value={split.beneficiary}
                      disabled={busy}
                      onChange={(event) => void setField(split, "beneficiary", event.target.value)}
                    >
                      {[
                        ...beneficiaries,
                        ...(beneficiaries.some((b) => b.id === split.beneficiary)
                          ? []
                          : [{ id: split.beneficiary, label: "Someone else" }]),
                      ].map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <div className="text-sm">
                    <span className="block">Split {n} tags</span>
                    <TagPicker
                      label={`Split ${n} tags`}
                      available={tags}
                      selected={split.tags}
                      disabled={busy}
                      onChange={(tagIds) => void run(() => setSplitTags(txn.id, split.id, tagIds))}
                    />
                  </div>
                </>
              )}
              {drafts.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDrafts((all) => all.filter((d) => d.key !== draft.key))}
                >
                  Remove split {n}
                </Button>
              ) : null}
            </fieldset>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDrafts((all) => [...all, { key: `new-${newKey}`, amount: "" }]);
              setNewKey((k) => k + 1);
            }}
          >
            Add split
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={saveSplits}>
            Save splits
          </Button>
        </div>
      </section>

      <section aria-labelledby="sheet-notes" className="mb-4">
        <h3 id="sheet-notes" className="m-0 mb-1 text-base">
          Notes
        </h3>
        <label className="sr-only" htmlFor="sheet-notes-text">
          Notes
        </label>
        <textarea
          id="sheet-notes-text"
          rows={3}
          maxLength={1000}
          value={notes}
          className="w-full rounded-md border border-input bg-background p-2 text-sm"
          onChange={(event) => setNotes(event.target.value)}
        />
        <Button
          type="button"
          size="sm"
          className="mt-1"
          disabled={busy}
          onClick={() => void run(() => updateNotes(txn.id, notes.trim() === "" ? null : notes))}
        >
          Save notes
        </Button>
      </section>

      <section aria-labelledby="sheet-hide">
        <h3 id="sheet-hide" className="m-0 mb-1 text-base">
          Hide the name
        </h3>
        {txn.nameHidden ? (
          <p className="m-0 text-sm">
            {partner === null ? "Someone" : "Your partner"} has hidden this name from you.
          </p>
        ) : partner === null ? (
          <p className="m-0 text-sm text-muted-foreground">
            Only a shared account can hide a name.
          </p>
        ) : (
          <>
            {hiddenByMe ? (
              <p className="m-0 mb-1 inline-block rounded-full border bg-muted px-2 py-0.5 text-sm">
                Hidden from {partner.displayName} until {longDay(txn.nameHiddenUntil as string)}
              </p>
            ) : null}
            <label className="m-0 flex items-center gap-2 text-sm" htmlFor="sheet-hide-toggle">
              <input
                id="sheet-hide-toggle"
                type="checkbox"
                checked={hiddenByMe}
                disabled={busy || (hiding && !hiddenByMe)}
                onChange={(event) =>
                  void run(() =>
                    event.target.checked
                      ? hideName(txn.id, until === "" ? undefined : until)
                      : unhideName(txn.id),
                  )
                }
              />
              Hide this name from {partner.displayName}
            </label>
            {hiddenByMe ? null : (
              <label className="m-0 mt-1 block text-sm" htmlFor="sheet-hide-until">
                Hide until (up to 12 months; blank for the longest)
                <DateInput
                  id="sheet-hide-until"
                  value={until}
                  min={today}
                  onChange={(event) => setUntil(event.target.value)}
                />
              </label>
            )}
            <p className="m-0 mt-1 text-sm text-muted-foreground">
              Notes stay visible to {partner.displayName}.
            </p>
          </>
        )}
      </section>
    </Sheet>
  );
}
