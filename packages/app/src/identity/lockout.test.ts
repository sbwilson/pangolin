import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import {
  assertLoginAllowed,
  DEFAULT_LOCKOUT,
  type LockoutPolicy,
  lockedUntil,
  recordLoginAttempt,
} from "./lockout.ts";

function setup() {
  const clock = manualClock("2026-09-27T00:00:00Z");
  const { ctx, uow } = memoryContext(systemViewer("cli:test"), clock);
  return { ctx, uow, clock };
}

function refusal(fn: () => void): AppError | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  return undefined;
}

const email = "alex@example.com";

describe("identity lockout", () => {
  it("locks the email on the 5th failure within 15 minutes, for 15 minutes", () => {
    const { ctx, clock } = setup();
    for (let i = 0; i < 4; i++) {
      recordLoginAttempt(ctx, { email, ok: false });
      clock.advance(60_000);
    }
    expect(refusal(() => assertLoginAllowed(ctx, { email }))).toBeUndefined();
    recordLoginAttempt(ctx, { email, ok: false });
    const error = refusal(() => assertLoginAllowed(ctx, { email }));
    expect(error).toMatchObject({ code: "RateLimited", details: { retryAfterSeconds: 900 } });
    clock.advance(15 * 60_000 - 1);
    expect(refusal(() => assertLoginAllowed(ctx, { email }))?.code).toBe("RateLimited");
    clock.advance(1);
    expect(refusal(() => assertLoginAllowed(ctx, { email }))).toBeUndefined();
  });

  it("matches the email case-insensitively and keeps other emails unlocked", () => {
    const { ctx } = setup();
    for (let i = 0; i < 5; i++) recordLoginAttempt(ctx, { email: "Alex@Example.com", ok: false });
    expect(refusal(() => assertLoginAllowed(ctx, { email }))?.code).toBe("RateLimited");
    expect(refusal(() => assertLoginAllowed(ctx, { email: "sam@example.com" }))).toBeUndefined();
  });

  it("does not lock on 5 failures spread over more than 15 minutes", () => {
    const { ctx, clock } = setup();
    for (let i = 0; i < 5; i++) {
      recordLoginAttempt(ctx, { email, ok: false });
      clock.advance(4 * 60_000);
    }
    expect(refusal(() => assertLoginAllowed(ctx, { email }))).toBeUndefined();
  });

  it("counts only failures after the last success", () => {
    const { ctx } = setup();
    for (let i = 0; i < 4; i++) recordLoginAttempt(ctx, { email, ok: false });
    recordLoginAttempt(ctx, { email, ok: true });
    for (let i = 0; i < 4; i++) recordLoginAttempt(ctx, { email, ok: false });
    expect(refusal(() => assertLoginAllowed(ctx, { email }))).toBeUndefined();
  });

  it("prunes attempts too old to matter", () => {
    const { ctx, uow, clock } = setup();
    recordLoginAttempt(ctx, { email, ok: false });
    clock.advance(30 * 60_000 + 1);
    recordLoginAttempt(ctx, { email: "sam@example.com", ok: true });
    expect(uow.state.loginAttempts).toEqual([
      { email: "sam@example.com", at: "2026-09-27T00:30:00.001Z", ok: true },
    ]);
    expect(uow.state.audit).toEqual([]);
  });

  it("follows the configured policy", () => {
    const policy: LockoutPolicy = { maxFailures: 2, windowMs: 60_000, lockMs: 120_000 };
    const { ctx, clock } = setup();
    recordLoginAttempt(ctx, { email, ok: false }, policy);
    recordLoginAttempt(ctx, { email, ok: false }, policy);
    clock.advance(119_999);
    expect(refusal(() => assertLoginAllowed(ctx, { email }, policy))?.code).toBe("RateLimited");
    clock.advance(1);
    expect(refusal(() => assertLoginAllowed(ctx, { email }, policy))).toBeUndefined();
  });

  it("lockedUntil is undefined without enough failures", () => {
    expect(lockedUntil([], DEFAULT_LOCKOUT)).toBeUndefined();
  });

  it("rejects an empty email with Validation", () => {
    const { ctx } = setup();
    expect(refusal(() => assertLoginAllowed(ctx, { email: " " }))?.code).toBe("Validation");
  });
});
