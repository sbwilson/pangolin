// Login lockout (story 1.5): too many failed password or TOTP attempts for one email lock that
// email for a while. Attempts are counted server-side in `login_attempt`, so the lock survives a
// new browser, a new IP and a restart. The rows are themselves the log and are not audited.
import { formatInstant, Temporal } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { LoginAttemptRow } from "../ports/unit-of-work.ts";

export interface LockoutPolicy {
  /** Failures within `windowMs` that lock the email. */
  readonly maxFailures: number;
  readonly windowMs: number;
  /** How long the email stays locked after the failure that locked it. */
  readonly lockMs: number;
}

/** 5 failures within 15 minutes lock the email for 15 minutes. */
export const DEFAULT_LOCKOUT: LockoutPolicy = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
};

export type LockoutContext = Pick<UseCaseContext, "clock" | "uow">;

const emailSchema = z.string().trim().toLowerCase().min(1).max(320);

/** Rows older than this can no longer affect a lock. */
function horizonMs(policy: LockoutPolicy): number {
  return policy.windowMs + policy.lockMs;
}

/**
 * When the email is locked until, from its attempts (oldest first): the latest time at which
 * `maxFailures` failures fell within `windowMs`, plus `lockMs`. Only failures after the last
 * success count. Undefined when no run of failures ever locked it.
 */
export function lockedUntil(
  attempts: readonly LoginAttemptRow[],
  policy: LockoutPolicy,
): Temporal.Instant | undefined {
  let lastOk = -1;
  attempts.forEach((attempt, index) => {
    if (attempt.ok) lastOk = index;
  });
  const failures = attempts.slice(lastOk + 1).map((a) => Temporal.Instant.from(a.at));
  let until: Temporal.Instant | undefined;
  for (let i = policy.maxFailures - 1; i < failures.length; i++) {
    const first = failures[i - policy.maxFailures + 1];
    const last = failures[i];
    if (first === undefined || last === undefined) continue;
    if (last.epochMilliseconds - first.epochMilliseconds <= policy.windowMs) {
      const end = last.add({ milliseconds: policy.lockMs });
      if (until === undefined || Temporal.Instant.compare(end, until) > 0) until = end;
    }
  }
  return until;
}

export const loginAttemptInput = z.object({ email: emailSchema }).strict();
export type AssertLoginAllowedInput = z.input<typeof loginAttemptInput>;

/**
 * `identity.assertLoginAllowed`: throws `RateLimited` while the email is locked out, so even the
 * right password or code is refused. A read-only check that writes nothing: the sign-in hooks do
 * not call it, but use `reserveLoginAttempt`, which checks and counts the attempt in one
 * transaction.
 */
export function assertLoginAllowed(
  ctx: LockoutContext,
  input: AssertLoginAllowedInput,
  policy: LockoutPolicy = DEFAULT_LOCKOUT,
): void {
  const { email } = parseInput(loginAttemptInput, input);
  const now = ctx.clock.now();
  const since = formatInstant(now.subtract({ milliseconds: horizonMs(policy) }));
  const attempts = ctx.uow.read((repos) => repos.loginAttempts.listSince(email, since));
  assertNotLocked(attempts, now, policy);
}

/** Throws `RateLimited` when `attempts` lock the email at `now`. */
function assertNotLocked(
  attempts: readonly LoginAttemptRow[],
  now: Temporal.Instant,
  policy: LockoutPolicy,
): void {
  const until = lockedUntil(attempts, policy);
  if (until !== undefined && Temporal.Instant.compare(now, until) < 0) {
    throw new AppError("RateLimited", "Too many failed sign-in attempts. Try again later.", {
      retryAfterSeconds: Math.ceil((until.epochMilliseconds - now.epochMilliseconds) / 1000),
    });
  }
}

/**
 * `identity.reserveLoginAttempt`: the lockout check and the attempt's count in one transaction,
 * with no await between them, so concurrent attempts for one email cannot all pass the check
 * before any is counted. Throws `RateLimited` (writing nothing) while the email is locked;
 * otherwise records the attempt as a provisional failure before the password or code is checked.
 * Afterwards the caller records a success (`recordLoginAttempt` with `ok: true`), leaves the
 * failure for a rejected password or code, or calls `releaseLoginAttempt` for an outcome that is
 * neither. An attempt whose outcome is never seen stays counted as a failure.
 */
export function reserveLoginAttempt(
  ctx: LockoutContext,
  input: AssertLoginAllowedInput,
  policy: LockoutPolicy = DEFAULT_LOCKOUT,
): void {
  const { email } = parseInput(loginAttemptInput, input);
  const now = ctx.clock.now();
  const before = formatInstant(now.subtract({ milliseconds: horizonMs(policy) }));
  ctx.uow.transaction((tx) => {
    assertNotLocked(tx.loginAttempts.listSince(email, before), now, policy);
    tx.loginAttempts.deleteBefore(before);
    tx.loginAttempts.insert({ email, at: formatInstant(now), ok: false });
  });
}

/**
 * `identity.releaseLoginAttempt`: removes one provisional failure that `reserveLoginAttempt`
 * recorded, for an attempt that ended neither in a session nor in a rejected password or code
 * (a right password awaiting its TOTP code, or another error). Removes the email's newest
 * failure: what the release preserves is the count of failures. Under concurrency the row
 * removed may be another attempt's rather than this one's; since `lockedUntil` reads the
 * timestamps, that can only move a lock's end by the gap between the two attempts.
 */
export function releaseLoginAttempt(ctx: LockoutContext, input: AssertLoginAllowedInput): void {
  const { email } = parseInput(loginAttemptInput, input);
  ctx.uow.transaction((tx) => tx.loginAttempts.deleteNewestFailure(email));
}

export const recordLoginAttemptInput = z.object({ email: emailSchema, ok: z.boolean() }).strict();
export type RecordLoginAttemptInput = z.input<typeof recordLoginAttemptInput>;

/**
 * `identity.recordLoginAttempt`: logs one attempt (`ok` when it ended in a session) and prunes
 * attempts too old to matter. Not audited: `login_attempt` is itself the log.
 */
export function recordLoginAttempt(
  ctx: LockoutContext,
  input: RecordLoginAttemptInput,
  policy: LockoutPolicy = DEFAULT_LOCKOUT,
): void {
  const { email, ok } = parseInput(recordLoginAttemptInput, input);
  const now = ctx.clock.now();
  const at = formatInstant(now);
  const before = formatInstant(now.subtract({ milliseconds: horizonMs(policy) }));
  ctx.uow.transaction((tx) => {
    tx.loginAttempts.deleteBefore(before);
    tx.loginAttempts.insert({ email, at, ok });
  });
}
