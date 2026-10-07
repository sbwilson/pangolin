import type * as React from "react";
import { cn } from "@/lib/utils.ts";

/** A native `type="date"` input (its value is `YYYY-MM-DD`, or empty). */
function DateInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="date"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { DateInput };
