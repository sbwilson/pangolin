import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils.ts";

/** One choice. Options with the same `group` sit under one heading, in the order given. */
export interface ComboboxOption {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
}

const inputClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/**
 * A filtering combobox over plain elements (the ARIA 1.2 pattern: a text input that owns a
 * listbox, with the active option named by `aria-activedescendant`). Typing narrows the options,
 * Arrow keys move, Enter picks, Escape closes. `selectedLabel` is what the input shows until the
 * person types. Choosing calls `onSelect` and closes the list.
 */
export function Combobox({
  label,
  options,
  selectedLabel = "",
  placeholder,
  disabled,
  autoFocus,
  clearOnSelect,
  onSelect,
  onDismiss,
  className,
}: {
  /** The input's accessible name. */
  label: string;
  options: readonly ComboboxOption[];
  selectedLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Focuses the input and opens the list on mount (the inline chip editor). */
  autoFocus?: boolean;
  /** Empties the input after a pick (the tag picker adds, it does not hold a value). */
  clearOnSelect?: boolean;
  onSelect: (id: string) => void;
  /** Called when focus leaves or Escape is pressed with nothing chosen. */
  onDismiss?: () => void;
  className?: string;
}) {
  const base = useId();
  const [open, setOpen] = useState(autoFocus === true);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const shown = useMemo(() => {
    if (query === null || query.trim() === "") return options;
    const needle = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query]);
  const groups = useMemo(() => {
    const out: { name: string | undefined; items: { option: ComboboxOption; index: number }[] }[] =
      [];
    shown.forEach((option, index) => {
      let group = out.find((g) => g.name === option.group);
      if (group === undefined) {
        group = { name: option.group, items: [] };
        out.push(group);
      }
      group.items.push({ option, index });
    });
    return out;
  }, [shown]);

  const optionId = (index: number) => `${base}-option-${index}`;
  const current = Math.min(active, Math.max(0, shown.length - 1));

  const close = () => {
    setOpen(false);
    setQuery(null);
    setActive(0);
  };
  const choose = (option: ComboboxOption) => {
    close();
    onSelect(option.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive(Math.min(current + 1, shown.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive(Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      const option = shown[current];
      if (open && option !== undefined) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === "Escape") {
      if (open) event.stopPropagation();
      close();
      onDismiss?.();
    }
  };

  return (
    <div className={cn("relative", className)}>
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${base}-list`}
        aria-autocomplete="list"
        {...(open && shown.length > 0 ? { "aria-activedescendant": optionId(current) } : {})}
        autoComplete="off"
        // biome-ignore lint/a11y/noAutofocus: the inline editor opens on the person's click
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        className={inputClass}
        value={query ?? (clearOnSelect === true ? "" : selectedLabel)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(event) => {
          if (query === null && clearOnSelect !== true) event.target.select();
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          close();
          onDismiss?.();
        }}
        onKeyDown={onKeyDown}
      />
      <div
        id={`${base}-list`}
        role="listbox"
        aria-label={label}
        hidden={!open}
        // Keeps focus in the input when the list itself (or its scrollbar) is pressed.
        onMouseDown={(event) => event.preventDefault()}
        className="absolute left-0 z-30 mt-1 max-h-60 min-w-full overflow-auto rounded-md border bg-background p-1 text-sm shadow-md"
      >
        {shown.length === 0 ? (
          <p className="m-0 px-2 py-1 text-muted-foreground">No matches</p>
        ) : (
          groups.map((group) => (
            <div
              key={group.name ?? ""}
              {...(group.name === undefined
                ? { role: "presentation" }
                : { role: "group", "aria-label": group.name })}
            >
              {group.name === undefined ? null : (
                <p aria-hidden="true" className="m-0 px-2 pt-1 text-xs text-muted-foreground">
                  {group.name}
                </p>
              )}
              {group.items.map(({ option, index }) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the input owns the keys (aria-activedescendant)
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === current}
                  className={cn(
                    "cursor-pointer rounded px-2 py-1",
                    index === current && "bg-accent text-accent-foreground",
                  )}
                  // Keeps focus in the input, so a click picks before the blur closes the list.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
