import type * as React from "react";
import { cn } from "@/lib/utils.ts";

/**
 * A native `select`, styled to match the inputs. The calendar popover and shared Select wait for
 * the CSP nonce wiring (see `deferred-work.md`), so filters use the platform's own control.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
