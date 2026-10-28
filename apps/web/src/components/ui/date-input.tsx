import type * as React from "react";
import { cn } from "@/lib/utils.ts";
import { INPUT_CLASS_RING_DISABLED } from "./input-class.ts";

/** A native `type="date"` input (its value is `YYYY-MM-DD`, or empty). */
function DateInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return <input type="date" className={cn(INPUT_CLASS_RING_DISABLED, className)} {...props} />;
}

export { DateInput };
