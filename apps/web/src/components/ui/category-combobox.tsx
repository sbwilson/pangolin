import { useMemo } from "react";
import type { CategorySummary } from "../../api.ts";
import { Combobox } from "./combobox.tsx";

/** The option that clears a split's category. */
export const NO_CATEGORY = "";

/**
 * Picks a category, grouped by its report group, or clears it ("Uncategorised"). Standalone: the
 * transaction sheet, the row's inline chip and entry reuse it.
 */
export function CategoryCombobox({
  label = "Category",
  categories,
  value,
  disabled,
  autoFocus,
  onChange,
  onDismiss,
  className,
}: {
  label?: string;
  categories: readonly CategorySummary[];
  /** The chosen category's ID, or null for none. */
  value: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  /** `null` clears the category. */
  onChange: (categoryId: string | null) => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const options = useMemo(
    () => [
      { id: NO_CATEGORY, label: "Uncategorised" },
      ...categories.map((c) => ({ id: c.id, label: c.name, group: c.groupName })),
    ],
    [categories],
  );
  const selected = categories.find((c) => c.id === value)?.name ?? "";
  return (
    <Combobox
      label={label}
      options={options}
      selectedLabel={selected}
      placeholder="Uncategorised"
      {...(disabled === undefined ? {} : { disabled })}
      {...(autoFocus === undefined ? {} : { autoFocus })}
      {...(onDismiss === undefined ? {} : { onDismiss })}
      {...(className === undefined ? {} : { className })}
      onSelect={(id) => onChange(id === NO_CATEGORY ? null : id)}
    />
  );
}
