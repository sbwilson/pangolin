import { useId } from "react";
import type { AccountView, Me } from "../../api.ts";
import { NativeSelect } from "../ui/select.tsx";

/** The picker's value for "For <partner>". */
export const HANDOFF_VALUE = "handoff";

export interface AccountGroups {
  readonly yours: readonly AccountView[];
  readonly shared: readonly AccountView[];
}

/** Only what `listAccounts` returned, split into the viewer's own accounts and shared ones. */
export function groupAccounts(accounts: readonly AccountView[], me: Me): AccountGroups {
  const byName = (a: AccountView, b: AccountView) => a.name.localeCompare(b.name);
  return {
    yours: accounts.filter((a) => a.pool === me.personId).sort(byName),
    shared: accounts.filter((a) => a.pool === "shared").sort(byName),
  };
}

export interface AccountPickerProps {
  readonly accounts: readonly AccountView[];
  readonly me: Me;
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}

export function AccountPicker({ accounts, me, value, disabled, onChange }: AccountPickerProps) {
  const id = useId();
  const { yours, shared } = groupAccounts(accounts, me);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        Which account is this for?
      </label>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose an account</option>
        {yours.length > 0 ? (
          <optgroup label="Yours">
            {yours.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {shared.length > 0 ? (
          <optgroup label="Shared">
            {shared.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {me.partner === null ? null : (
          <option value={HANDOFF_VALUE}>For {me.partner.displayName}</option>
        )}
      </NativeSelect>
      {me.partner !== null && value === HANDOFF_VALUE ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Waits in {me.partner.displayName}&apos;s Needs review. The account is their choice.
        </p>
      ) : null}
    </div>
  );
}
