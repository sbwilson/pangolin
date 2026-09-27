import type { Id } from "@pangolin/shared";
import { formatInstant, type Temporal } from "@pangolin/shared/temporal";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { TxRepos } from "../ports/unit-of-work.ts";
import type { JobKind } from "./registry.ts";

export interface EnqueueOptions {
  /** A second enqueue with this key while a job holding it is pending or running is a no-op. */
  readonly dedupeKey?: string;
  /** Not before this instant; defaults to now. */
  readonly runAt?: Temporal.Instant;
}

/**
 * Adds a job to the outbox inside the caller's `write` transaction (AD-8), so it commits or
 * rolls back with the business change. The payload is round-tripped through JSON, parsed with
 * the kind's schema, and the parsed value is stored (`AppError` `Validation` when it is not
 * JSON or fails the schema). Returns the new job's ID, or the ID of the live job
 * that already holds `dedupeKey`. Not audited here: the calling use case audits its change.
 */
export function enqueueJob<P>(
  tx: TxRepos,
  ctx: Pick<UseCaseContext, "clock" | "newId">,
  kind: JobKind<P>,
  payload: P,
  options: EnqueueOptions = {},
): Id<"Job"> {
  // Round-trip through JSON first, so what is validated is exactly what the runner will read.
  let wire: unknown;
  try {
    const raw = JSON.stringify(payload);
    if (raw === undefined) throw new TypeError("not JSON");
    wire = JSON.parse(raw);
  } catch {
    throw new AppError("Validation", "Job payload must be JSON");
  }
  const text = JSON.stringify(parseInput(kind.schema, wire));
  if (options.dedupeKey !== undefined && options.dedupeKey.length === 0) {
    throw new AppError("Validation", "dedupeKey must not be empty");
  }
  const now = formatInstant(ctx.clock.now());
  const { id } = tx.jobs.insertOrGetPending({
    id: ctx.newId<"Job">(),
    kind: kind.kind,
    lane: kind.lane,
    payload: text,
    dedupeKey: options.dedupeKey ?? null,
    status: "pending",
    attempts: 0,
    maxAttempts: kind.retry.maxAttempts,
    runAt: options.runAt === undefined ? now : formatInstant(options.runAt),
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  });
  return id;
}
