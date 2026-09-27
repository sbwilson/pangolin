// Job kinds and schedules (AD-8). A kind names its payload schema, lane, retry policy and
// flags; a handler is paired with its kind only in the composition root that runs it.
import type { Id } from "@pangolin/shared";
import type { Temporal } from "@pangolin/shared/temporal";
import type { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import type { JobLane } from "../ports/unit-of-work.ts";
import type { SystemViewer } from "../viewer.ts";

export const JOB_LANES: readonly JobLane[] = ["llm", "net", "local"];

/** Exponential backoff, then `dead`: retry `n` waits `min(maxDelayMs, baseDelayMs × 2^(n-1))`. */
export interface RetryPolicy {
  /** Claims allowed in total, including the first; at least 1. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 60 * 60_000,
};

export interface JobKind<P = unknown> {
  /** Lowercase words joined by hyphens; the handler's audit actor is `job:<kind>`. */
  readonly kind: string;
  /** Checked when the job is enqueued and again when it runs. */
  readonly schema: z.ZodType<P>;
  readonly lane: JobLane;
  readonly retry: RetryPolicy;
  /** The job reaches outside the process (a push, a fetch, an email); `restore` cancels these. */
  readonly externalEffects: boolean;
  /** When the job dies, raise a household `job.dead` review item. */
  readonly needsPersonWhenDead: boolean;
  /**
   * How long one attempt may run, in milliseconds, before the runner aborts its signal and fails
   * the attempt; undefined for no limit.
   */
  readonly timeoutMs: number | undefined;
}

export interface JobKindSpec<P> {
  readonly kind: string;
  readonly schema: z.ZodType<P>;
  readonly lane: JobLane;
  readonly retry?: Partial<RetryPolicy>;
  readonly externalEffects: boolean;
  readonly needsPersonWhenDead: boolean;
  readonly timeoutMs?: number | undefined;
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Declares a job kind. Throws `TypeError` for a bad name, lane or retry policy. */
export function defineJobKind<P>(spec: JobKindSpec<P>): JobKind<P> {
  if (!NAME_RE.test(spec.kind)) {
    throw new TypeError(`defineJobKind: kind must be lowercase-hyphenated, got ${spec.kind}`);
  }
  if (!JOB_LANES.includes(spec.lane)) {
    throw new TypeError(`defineJobKind: unknown lane ${String(spec.lane)}`);
  }
  const retry: RetryPolicy = { ...DEFAULT_RETRY, ...spec.retry };
  if (
    !nonNegativeInteger(retry.maxAttempts) ||
    retry.maxAttempts < 1 ||
    !nonNegativeInteger(retry.baseDelayMs) ||
    !nonNegativeInteger(retry.maxDelayMs)
  ) {
    throw new TypeError(`defineJobKind: invalid retry policy for ${spec.kind}`);
  }
  if (
    spec.timeoutMs !== undefined &&
    (!Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 1)
  ) {
    throw new TypeError(`defineJobKind: invalid timeout for ${spec.kind}`);
  }
  return Object.freeze({
    kind: spec.kind,
    schema: spec.schema,
    lane: spec.lane,
    retry: Object.freeze(retry),
    externalEffects: spec.externalEffects,
    needsPersonWhenDead: spec.needsPersonWhenDead,
    timeoutMs: spec.timeoutMs,
  });
}

/** The delay before retry number `attempts` (the attempt that just failed, from 1). */
export function backoffMs(retry: RetryPolicy, attempts: number): number {
  return Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** Math.max(0, attempts - 1));
}

/** The part of an `AbortSignal` a handler reads (`app` has no DOM or Node types). */
export interface JobSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** What a handler runs with: a use-case context whose viewer is `SystemViewer` `job:<kind>`. */
export interface JobContext extends UseCaseContext {
  readonly viewer: SystemViewer;
  readonly job: { readonly id: Id<"Job">; readonly kind: string; readonly attempt: number };
  /**
   * Aborted when the attempt times out (the kind's `timeoutMs`) or the runner gives up waiting
   * for it at stop. A handler stops its I/O (kills its child process, terminates its worker) and
   * throws.
   */
  readonly signal: JobSignal;
}

/**
 * Does the job's I/O first, then commits through use cases with `ctx` (AD-1, AD-2). Execution is
 * at least once, so a handler must be idempotent. Throwing fails the attempt.
 */
export type JobHandler<P> = (ctx: JobContext, payload: P) => Promise<void>;

/** A kind paired with its handler, as a runner takes it. */
export interface JobRegistration<P = unknown> {
  readonly kind: JobKind<P>;
  readonly handler: JobHandler<P>;
}

/** Pairs a kind with its handler for a runner. */
export function jobHandler<P>(kind: JobKind<P>, handler: JobHandler<P>): JobRegistration {
  return Object.freeze({ kind, handler }) as JobRegistration;
}

/** A recurring job defined in code; its live row carries the dedupe key `schedule:<name>`. */
export interface Schedule<P = unknown> {
  readonly name: string;
  readonly kind: JobKind<P>;
  readonly payload: P;
  /** The next run strictly after `after`. */
  readonly next: (after: Temporal.Instant) => Temporal.Instant;
}

/** Declares a schedule. Throws `TypeError` for a bad name, or when the payload fails its schema. */
export function defineSchedule<P>(spec: Schedule<P>): Schedule {
  if (!NAME_RE.test(spec.name)) {
    throw new TypeError(`defineSchedule: name must be lowercase-hyphenated, got ${spec.name}`);
  }
  const parsed = spec.kind.schema.safeParse(spec.payload);
  if (!parsed.success) {
    throw new TypeError(
      `defineSchedule: payload of ${spec.name} fails the ${spec.kind.kind} schema`,
    );
  }
  return Object.freeze({ ...spec }) as Schedule;
}

/** The dedupe key of a schedule's live row. */
export function scheduleKey(name: string): string {
  return `schedule:${name}`;
}
