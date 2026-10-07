import { useMemo } from "react";
import type { LedgerTag } from "../../api.ts";
import { Combobox } from "./combobox.tsx";

/**
 * Shows the tags on a split as removable chips and adds more from `available`. It reports the
 * whole new tag set on every change (the API replaces a split's tags as a set). Standalone: entry
 * reuses it.
 */
export function TagPicker({
  label = "Tags",
  available,
  selected,
  disabled,
  onChange,
}: {
  label?: string;
  available: readonly LedgerTag[];
  selected: readonly LedgerTag[];
  disabled?: boolean;
  /** The IDs of the tags the split should now carry. */
  onChange: (tagIds: string[]) => void;
}) {
  const options = useMemo(() => {
    const taken = new Set(selected.map((t) => t.id));
    return available.filter((t) => !taken.has(t.id)).map((t) => ({ id: t.id, label: t.name }));
  }, [available, selected]);
  return (
    <div>
      <ul
        className="m-0 mb-1 flex list-none flex-wrap gap-1 p-0"
        aria-label={`${label} on this split`}
      >
        {selected.map((tag) => (
          <li
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs"
          >
            {tag.name}
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove tag ${tag.name}`}
              className="rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onChange(selected.filter((t) => t.id !== tag.id).map((t) => t.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <Combobox
        label={`Add a tag`}
        options={options}
        placeholder="Add a tag"
        clearOnSelect
        {...(disabled === undefined ? {} : { disabled })}
        onSelect={(id) => onChange([...selected.map((t) => t.id), id])}
      />
    </div>
  );
}
