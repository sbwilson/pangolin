import { useId, useState } from "react";
import {
  type AccountType,
  type AccountView,
  ApiError,
  createAccount,
  type InstitutionSummary,
  type Me,
  setAccountPrivacy,
  updateAccount,
} from "../api.ts";
import { Button } from "../components/ui/button.tsx";
import { NativeSelect } from "../components/ui/select.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { CREATABLE_TYPES, TYPE_LABEL } from "../lib/accounts.ts";
import { parseCents } from "../lib/money.ts";

/** The household's base currency; the server refuses any other and says so. */
const BASE_CURRENCY = "AUD";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong";

interface Candidate {
  readonly personId: string;
  readonly name: string;
}

/** One owner row of the form: whether they own it and their share as typed (a percentage). */
interface OwnerDraft {
  on: boolean;
  share: string;
}

type Drafts = Record<string, OwnerDraft>;

/** Even shares across the owners switched on: one owner has all, two split it. */
function withEvenShares(drafts: Drafts): Drafts {
  const on = Object.entries(drafts).filter(([, d]) => d.on).length;
  const share = on === 1 ? "100" : on === 2 ? "50" : "";
  return Object.fromEntries(
    Object.entries(drafts).map(([id, d]) => [id, { on: d.on, share: d.on ? share : "" }]),
  );
}

/** The names a refusal's `details` list, as the server gave them (it is `unknown` to us). */
function refusalLines(details: Readonly<Record<string, unknown>>): {
  items: string[];
  owners: string[];
} {
  const named = (value: unknown, label: string): string[] =>
    Array.isArray(value)
      ? value.flatMap((entry) =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as { name?: unknown }).name === "string"
            ? [`${label} "${(entry as { name: string }).name}"`]
            : [],
        )
      : [];
  const owners = Array.isArray(details.owners)
    ? details.owners.flatMap((entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { displayName?: unknown }).displayName === "string"
          ? [(entry as { displayName: string }).displayName]
          : [],
      )
    : [];
  return {
    items: [
      ...named(details.payees, "payee"),
      ...named(details.tags, "tag"),
      ...named(details.activities, "activity"),
    ],
    owners,
  };
}

/** A refusal's message, verbatim, and what the server listed with it. */
function Refusal({ error }: { error: unknown }) {
  const details = error instanceof ApiError ? error.details : undefined;
  const lines = details === undefined ? null : refusalLines(details);
  return (
    <div role="alert" className="mt-2 text-sm text-destructive">
      <p className="m-0">{messageOf(error)}</p>
      {lines === null || lines.items.length + lines.owners.length === 0 ? null : (
        <ul className="m-0 mt-1 pl-5">
          {lines.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
          {lines.owners.length === 0 ? null : <li>Owners: {lines.owners.join(" and ")}</li>}
        </ul>
      )}
    </div>
  );
}

/**
 * The create and edit sheet for an account: its details, owners and shares, and (when editing)
 * its privacy. The server checks every rule; a refusal is shown with the server's own words.
 */
export function AccountSheet({
  account,
  me,
  institutions,
  onSaved,
  onClose,
}: {
  /** The account to edit, or null to add one. */
  account: AccountView | null;
  me: Me;
  institutions: readonly InstitutionSummary[];
  /** Called after each write that changed an account, so the lists can refetch. */
  onSaved: () => void;
  onClose: () => void;
}) {
  const ids = { name: useId(), type: useId(), institution: useId() };
  const [current, setCurrent] = useState(account);
  const editing = current !== null;
  const candidates: Candidate[] = [
    { personId: me.personId, name: me.displayName },
    ...(me.partner === null
      ? []
      : [{ personId: me.partner.personId, name: me.partner.displayName }]),
  ];
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "transaction");
  const [institutionId, setInstitutionId] = useState(account?.institutionId ?? "");
  const [isSavings, setIsSavings] = useState(account?.isSavings ?? false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>(() =>
    Object.fromEntries(
      candidates.map((c) => {
        const owned = account?.owners.find((o) => o.personId === c.personId);
        const mine = account === null && c.personId === me.personId;
        return [
          c.personId,
          {
            on: owned !== undefined || mine,
            share: owned ? `${owned.shareBp / 100}` : mine ? "100" : "",
          },
        ];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [privacyError, setPrivacyError] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);

  const setOwner = (personId: string, change: Partial<OwnerDraft>, even: boolean) =>
    setDrafts((prev) => {
      const next = { ...prev, [personId]: { ...(prev[personId] as OwnerDraft), ...change } };
      return even ? withEvenShares(next) : next;
    });
  const choosePrivate = (value: boolean) => {
    setIsPrivate(value);
    // A private account has one owner, and a person may only make one for themselves.
    if (value) {
      setDrafts((prev) =>
        Object.fromEntries(
          Object.keys(prev).map((id) => [
            id,
            id === me.personId ? { on: true, share: "100" } : { on: false, share: "" },
          ]),
        ),
      );
    }
  };

  const ownersLocked = current?.isPrivate === true;
  const owners = (): { personId: string; shareBp: number }[] | string => {
    const picked: { personId: string; shareBp: number }[] = [];
    for (const c of candidates) {
      const draft = drafts[c.personId];
      if (draft?.on !== true) continue;
      const shareBp = parseCents(draft.share);
      if (shareBp === undefined || shareBp <= 0) {
        return "Enter each share as a percentage, like 60";
      }
      picked.push({ personId: c.personId, shareBp });
    }
    return picked.length === 0 ? "An account needs an owner" : picked;
  };

  const save = async () => {
    setError(null);
    setStatus(null);
    const trimmed = name.trim();
    if (trimmed === "") {
      setError(new Error("Enter a name"));
      return;
    }
    const picked = owners();
    if (typeof picked === "string") {
      setError(new Error(picked));
      return;
    }
    setBusy(true);
    try {
      if (current === null) {
        await createAccount({
          name: trimmed,
          type,
          currency: BASE_CURRENCY,
          isPrivate,
          owners: picked,
          ...(institutionId === "" ? {} : { institutionId }),
          isSavings: type === "savings" && isSavings,
        });
      } else {
        const key = (list: readonly { personId: string; shareBp: number }[]) =>
          [...list]
            .sort((a, b) => a.personId.localeCompare(b.personId))
            .map((o) => `${o.personId}:${o.shareBp}`)
            .join(",");
        const ownersChanged = key(picked) !== key(current.owners);
        const changes = {
          ...(trimmed === current.name ? {} : { name: trimmed }),
          ...((institutionId || null) === current.institutionId
            ? {}
            : { institutionId: institutionId || null }),
          ...(isSavings === current.isSavings ? {} : { isSavings }),
          ...(ownersChanged && !ownersLocked ? { owners: picked } : {}),
        };
        if (Object.keys(changes).length > 0) await updateAccount(current.id, changes);
      }
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const switchPrivacy = async () => {
    if (current === null) return;
    setPrivacyError(null);
    setStatus(null);
    setBusy(true);
    try {
      const next = await setAccountPrivacy(current.id, !current.isPrivate);
      setCurrent(next);
      setStatus(next.isPrivate ? "This account is now private." : "This account is now public.");
      onSaved();
    } catch (failure) {
      setPrivacyError(failure);
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Sheet
      title={editing ? "Edit account" : "Add account"}
      description={editing ? current.name : "Name it, say who owns it and how much each owns."}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="m-0 text-sm" htmlFor={ids.name}>
          Name
          <input
            id={ids.name}
            className={fieldClass}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="m-0 text-sm" htmlFor={ids.type}>
          Type
          <NativeSelect
            id={ids.type}
            value={type}
            disabled={editing}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {(editing && !CREATABLE_TYPES.includes(type) ? [type] : CREATABLE_TYPES).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="m-0 text-sm" htmlFor={ids.institution}>
          Institution
          <NativeSelect
            id={ids.institution}
            value={institutionId}
            onChange={(e) => setInstitutionId(e.target.value)}
          >
            <option value="">None</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        {type === "savings" ? (
          <label className="m-0 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isSavings}
              onChange={(e) => setIsSavings(e.target.checked)}
            />
            Counts toward savings
          </label>
        ) : null}

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold">Owners</legend>
          {candidates.map((c) => {
            const draft = drafts[c.personId] as OwnerDraft;
            const blocked = ownersLocked || (isPrivate && c.personId !== me.personId);
            return (
              <div key={c.personId} className="flex items-center gap-2 text-sm">
                <label className="m-0 flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.on}
                    disabled={blocked}
                    onChange={(e) => setOwner(c.personId, { on: e.target.checked }, true)}
                  />
                  {c.name}
                </label>
                <div className="flex items-center gap-1">
                  <input
                    aria-label={`${c.name} share (%)`}
                    inputMode="decimal"
                    className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums disabled:opacity-50"
                    value={draft.share}
                    disabled={blocked || !draft.on}
                    onChange={(e) => setOwner(c.personId, { share: e.target.value }, false)}
                  />
                  <span aria-hidden="true">%</span>
                </div>
              </div>
            );
          })}
        </fieldset>

        {editing ? null : (
          <label className="m-0 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => choosePrivate(e.target.checked)}
            />
            Private: only you can see it
          </label>
        )}

        {error === null ? null : <Refusal error={error} />}
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={busy}>
            {editing ? "Save changes" : "Add account"}
          </Button>
        </div>
      </form>

      {current === null ? null : (
        <section aria-labelledby={`${ids.name}-privacy`} className="mt-4 border-t pt-3">
          <h3 id={`${ids.name}-privacy`} className="m-0 text-base">
            Privacy
          </h3>
          <p className="text-sm text-muted-foreground">
            {current.isPrivate
              ? "Private: only its owner can see this account and its transactions."
              : "Public: both of you can see this account and its transactions."}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void switchPrivacy()}
          >
            {current.isPrivate ? "Make public" : "Make private"}
          </Button>
          {status === null ? null : (
            <p role="status" className="text-sm text-muted-foreground">
              {status}
            </p>
          )}
          {privacyError === null ? null : <Refusal error={privacyError} />}
        </section>
      )}
    </Sheet>
  );
}
