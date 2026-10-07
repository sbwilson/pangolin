import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils.ts";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet: it opens from the bottom edge below `md` and from the right edge above it.
 * Plain elements and Tailwind classes only (no inline styles, no popover library). Escape and the
 * backdrop close it; focus moves into it, is kept inside while it is open, and goes back to what
 * had it when it closes.
 */
export function Sheet({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50" data-testid="sheet">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(description === undefined ? {} : { "aria-describedby": descriptionId })}
        tabIndex={-1}
        data-sheet-panel=""
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col overflow-y-auto rounded-t-xl border bg-background p-4 shadow-lg outline-none",
          "md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[32rem] md:rounded-none md:rounded-l-xl",
        )}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close.current();
            return;
          }
          if (event.key !== "Tab" || panel.current === null) return;
          const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
          const first = items[0];
          const last = items[items.length - 1];
          if (first === undefined || last === undefined) return;
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === panel.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={titleId} className="m-0 break-words text-lg">
              {title}
            </h2>
            {description === undefined ? null : (
              <p id={descriptionId} className="m-0 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="h-8 shrink-0 rounded-md border border-input px-3 text-sm"
            onClick={onClose}
          >
            Done
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
