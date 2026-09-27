// Server-side ID minting (AD-5). This is the only module that imports `ulid`, and `app` is
// unreachable from `apps/web`, so IDs are never generated in the browser.
import type { Id } from "@pangolin/shared";
import { monotonicFactory } from "ulid";

/** Mints a new ID for entity `B`. */
export type IdGenerator = <B extends string>() => Id<B>;

export interface IdSources {
  /** Current time in epoch milliseconds. */
  readonly now: () => number;
  /** Uniform random number in `[0, 1)`. */
  readonly random: () => number;
}

/**
 * Builds a monotonic ULID generator: IDs from one generator sort in creation order, even
 * within the same millisecond. Inject `now` and `random` for deterministic tests and seeds.
 */
export function createIdGenerator(sources?: IdSources): IdGenerator {
  if (!sources) {
    const next = monotonicFactory();
    return <B extends string>() => next() as Id<B>;
  }
  const next = monotonicFactory(sources.random);
  return <B extends string>() => {
    const time = sources.now();
    // ulid treats a seed time of 0 as "use Date.now()", which would bypass the injected time.
    if (!Number.isSafeInteger(time) || time <= 0) {
      throw new RangeError(`ID time must be a positive integer of epoch ms, got ${time}`);
    }
    return next(time) as Id<B>;
  };
}

/** Mints a new ID for entity `B` from the system clock and a secure random source. */
export const newId: IdGenerator = createIdGenerator();
