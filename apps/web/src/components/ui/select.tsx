import type * as React from "react";
import { cn } from "@/lib/utils.ts";
import { INPUT_CLASS_RING_DISABLED } from "./input-class.ts";

/**
 * A native `select`, styled to match the inputs. The calendar popover and shared Select wait for
 * the CSP nonce wiring (see `deferred-work.md`), so filters use the platform's own control.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(INPUT_CLASS_RING_DISABLED, className)} {...props} />;
}

export { NativeSelect };
