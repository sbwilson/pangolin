import type { PlainDate, Temporal } from "@pangolin/shared/temporal";

/**
 * The only source of "now" and "today" (AD-14). `app` injects one into every use case;
 * `domain` and `shared` never read the system clock.
 */
export interface Clock {
  /** Today's date in the household time zone. */
  today(): PlainDate;
  /** The current instant (UTC). */
  now(): Temporal.Instant;
}
