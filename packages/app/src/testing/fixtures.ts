// Test support only: a clock tests can move, sequential IDs, and a context on the memory uow.
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import type { UseCaseContext } from "../context.ts";
import type { IdGenerator } from "../ids.ts";
import type { Clock } from "../ports/clock.ts";
import type { Viewer } from "../viewer.ts";
import { type MemoryUnitOfWork, memoryUnitOfWork } from "./memory-uow.ts";

export interface ManualClock extends Clock {
  set(instant: Temporal.Instant | string): void;
  advance(ms: number): void;
}

/** A clock that stands still until the test moves it. `today` is the UTC date of `now`. */
export function manualClock(start: string): ManualClock {
  let now = Temporal.Instant.from(start);
  return {
    now: () => now,
    today: () => now.toZonedDateTimeISO("UTC").toPlainDate(),
    set: (instant) => {
      now = typeof instant === "string" ? Temporal.Instant.from(instant) : instant;
    },
    advance: (ms) => {
      now = now.add({ milliseconds: ms });
    },
  };
}

/** IDs `01J00000000000000000000001`, `…02`, … in order, so they sort by creation. */
export function sequentialIds(): IdGenerator {
  let n = 0;
  return <B extends string>() => `01J0000000000000000000${String(++n).padStart(4, "0")}` as Id<B>;
}

export function memoryContext(viewer: Viewer, clock: Clock = manualClock("2026-09-27T00:00:00Z")) {
  const uow: MemoryUnitOfWork = memoryUnitOfWork();
  const ctx: UseCaseContext = { viewer, clock, newId: sequentialIds(), uow };
  return { ctx, uow };
}
