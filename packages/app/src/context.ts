import type { IdGenerator } from "./ids.ts";
import type { Clock } from "./ports/clock.ts";
import type { UnitOfWork } from "./ports/unit-of-work.ts";
import type { Viewer } from "./viewer.ts";

/**
 * What every use case receives as its first argument: `(ctx: UseCaseContext, input) → output`.
 * Every field is required. Composition roots build it; use cases never construct their own.
 */
export interface UseCaseContext {
  readonly viewer: Viewer;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  readonly uow: UnitOfWork;
}
