/**
 * The shared Tailwind classes for the app's 36px-tall bordered form inputs.
 * Compose these instead of repeating the class string per component.
 */

/** Base input: full width, 36px tall, rounded bordered field, small text. */
export const INPUT_CLASS =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";

/** {@link INPUT_CLASS} plus the focus-visible ring. */
export const INPUT_CLASS_RING = `${INPUT_CLASS} outline-none focus-visible:ring-2 focus-visible:ring-ring`;

/** {@link INPUT_CLASS_RING} plus the dimmed disabled state. */
export const INPUT_CLASS_RING_DISABLED = `${INPUT_CLASS_RING} disabled:opacity-50`;
