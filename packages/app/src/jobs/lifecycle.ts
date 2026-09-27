// The runner's use cases (AD-8): claim, renew, complete and fail a job, and keep the schedules'
// next rows. Each is one short write transaction. Bookkeeping on the job row is system state,
// not an entity change, so it is not audited; the `job.dead` review item it raises is.
import { formatInstant } from "@pangolin/shared/temporal";
import type { UseCaseContext } from "../context.ts";
import type { JobLane, JobRow, TxRepos } from "../ports/unit-of-work.ts";
import { JOB_DEAD_REVIEW, raiseReviewItem } from "../system/review-items.ts";
import { type Audit, write } from "../write.ts";
import { enqueueJob } from "./enqueue.ts";
import { backoffMs, type JobKind, type Schedule, scheduleKey } from "./registry.ts";

/** Longest error text kept on a job row. */
const MAX_ERROR_LENGTH = 2000;

function leaseUntil(ctx: UseCaseContext, leaseMs: number): string {
  return formatInstant(ctx.clock.now().add({ milliseconds: leaseMs }));
}

/**
 * Makes sure each schedule has its next row: enqueues `next(now)` with dedupe
 * `schedule:<name>`, a no-op when that schedule already has a pending or running job. Throws
 * `TypeError` naming a schedule whose `next(now)` is not strictly after now, even when its row
 * already exists, so a broken schedule fails loudly at startup.
 */
export function ensureSchedules(ctx: UseCaseContext, schedules: readonly Schedule[]): void {
  if (schedules.length === 0) return;
  write(ctx, (tx) => {
    for (const schedule of schedules) enqueueNext(tx, ctx, schedule);
  });
}

/**
 * Enqueues `schedule`'s next run. Throws `TypeError` naming the schedule when `next(now)` is not
 * strictly after now, which would make the job due on every tick.
 */
function enqueueNext(tx: TxRepos, ctx: UseCaseContext, schedule: Schedule): void {
  const now = ctx.clock.now();
  const runAt = schedule.next(now);
  if (runAt.epochNanoseconds <= now.epochNanoseconds) {
    throw new TypeError(
      `Schedule ${schedule.name}: next(${now.toString()}) returned ${runAt.toString()}, not a later instant`,
    );
  }
  enqueueJob(tx, ctx, schedule.kind, schedule.payload, {
    dedupeKey: scheduleKey(schedule.name),
    runAt,
  });
}

/** The schedule that owns `job`, when its dedupe key is `schedule:<name>`. */
function scheduleOf(job: JobRow, schedules: readonly Schedule[]): Schedule | undefined {
  return schedules.find((schedule) => job.dedupeKey === scheduleKey(schedule.name));
}

export interface ClaimInput {
  readonly lane: JobLane;
  readonly owner: string;
  readonly leaseMs: number;
}

/**
 * Claims the oldest runnable job in `lane` for `owner`: pending and due, or running with an
 * expired lease (a crashed runner's job, whose lost attempt still counts). Returns it with its
 * new `attempts`, or undefined when nothing is runnable.
 */
export function claimJob(ctx: UseCaseContext, input: ClaimInput): JobRow | undefined {
  return write(ctx, (tx) =>
    tx.jobs.claimNext(
      input.lane,
      input.owner,
      formatInstant(ctx.clock.now()),
      leaseUntil(ctx, input.leaseMs),
    ),
  );
}

/** Extends `owner`'s lease on `job` to now + `leaseMs`. False when `owner` no longer holds it. */
export function renewJobLease(
  ctx: UseCaseContext,
  input: { readonly job: JobRow; readonly owner: string; readonly leaseMs: number },
): boolean {
  return write(ctx, (tx) =>
    tx.jobs.renewLease(
      input.job.id,
      input.owner,
      formatInstant(ctx.clock.now()),
      leaseUntil(ctx, input.leaseMs),
    ),
  );
}

export interface CompleteInput {
  readonly job: JobRow;
  readonly owner: string;
  readonly schedules: readonly Schedule[];
}

/**
 * Marks `job` done and, for a scheduled job, enqueues the schedule's next run in the same
 * transaction. False, writing nothing, when `owner` no longer holds the lease.
 */
export function completeJob(ctx: UseCaseContext, input: CompleteInput): boolean {
  return write(ctx, (tx) => {
    if (!tx.jobs.complete(input.job.id, input.owner, formatInstant(ctx.clock.now()))) return false;
    const schedule = scheduleOf(input.job, input.schedules);
    if (schedule !== undefined) enqueueNext(tx, ctx, schedule);
    return true;
  });
}

export interface FailInput {
  readonly job: JobRow;
  readonly owner: string;
  /** The job's kind, when this process knows it; without it the job cannot retry. */
  readonly kind: JobKind | undefined;
  /** Kept on the row for the server only; never sent over HTTP. */
  readonly error: string;
  /** Go straight to `dead`, e.g. for a payload that no longer parses. */
  readonly permanent?: boolean;
  readonly schedules: readonly Schedule[];
}

export type FailOutcome = "retry" | "dead" | "lost";

function markDead(
  tx: TxRepos,
  audit: Audit,
  ctx: UseCaseContext,
  input: FailInput,
  now: string,
  error: string,
): boolean {
  if (!tx.jobs.markDead(input.job.id, input.owner, now, error)) return false;
  if (input.kind?.needsPersonWhenDead === true) {
    raiseReviewItem(tx, audit, ctx, {
      kind: JOB_DEAD_REVIEW,
      entityRef: `job:${input.job.id}`,
      dedupeKey: `job.dead:${input.job.id}`,
    });
  }
  const schedule = scheduleOf(input.job, input.schedules);
  if (schedule !== undefined) enqueueNext(tx, ctx, schedule);
  return true;
}

/**
 * Records a failed attempt. While `attempts < maxAttempts` the job goes back to pending after
 * `min(maxDelay, base × 2^(attempts-1))`; otherwise, or when `permanent`, it is `dead`. A dead
 * job whose kind needs a person raises one household `job.dead` review item, and a dead
 * scheduled job enqueues its next run, both in the same transaction. Returns `lost`, writing
 * nothing, when `owner` no longer holds the lease.
 */
export function failJob(ctx: UseCaseContext, input: FailInput): FailOutcome {
  const error = input.error.slice(0, MAX_ERROR_LENGTH);
  return write(ctx, (tx, audit) => {
    const now = ctx.clock.now();
    const { job, kind } = input;
    const retryable =
      input.permanent !== true && kind !== undefined && job.attempts < job.maxAttempts;
    if (retryable) {
      const runAt = now.add({ milliseconds: backoffMs(kind.retry, job.attempts) });
      const ok = tx.jobs.retry(
        job.id,
        input.owner,
        formatInstant(now),
        formatInstant(runAt),
        error,
      );
      return ok ? "retry" : "lost";
    }
    return markDead(tx, audit, ctx, input, formatInstant(now), error) ? "dead" : "lost";
  });
}
