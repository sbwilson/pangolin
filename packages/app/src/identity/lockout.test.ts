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
  releaseLoginAttempt,
  reserveLoginAttempt,
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

describe("identity lockout reservations", () => {
  it("reserve counts the attempt as a failure up front, and refuses the 6th while writing nothing", () => {
    const { ctx, uow } = setup();
    for (let i = 0; i < 5; i++) {
      expect(
        refusal(() => reserveLoginAttempt(ctx, { email: "Alex@Example.com" })),
      ).toBeUndefined();
    }
    expect(uow.state.loginAttempts).toHaveLength(5);
    expect(uow.state.loginAttempts.every((a) => a.email === email && !a.ok)).toBe(true);
    const error = refusal(() => reserveLoginAttempt(ctx, { email }));
    expect(error).toMatchObject({ code: "RateLimited", details: { retryAfterSeconds: 900 } });
    expect(uow.state.loginAttempts).toHaveLength(5);
    expect(refusal(() => assertLoginAllowed(ctx, { email }))?.code).toBe("RateLimited");
  });

  it("release removes the email's newest failure only", () => {
    const { ctx, uow, clock } = setup();
    recordLoginAttempt(ctx, { email, ok: false });
    clock.advance(1000);
    recordLoginAttempt(ctx, { email, ok: true });
    clock.advance(1000);
    reserveLoginAttempt(ctx, { email });
    reserveLoginAttempt(ctx, { email: "sam@example.com" });
    releaseLoginAttempt(ctx, { email: "ALEX@example.com" });
    expect(uow.state.loginAttempts).toEqual([
      { email, at: "2026-09-27T00:00:00.000Z", ok: false },
      { email, at: "2026-09-27T00:00:01.000Z", ok: true },
      { email: "sam@example.com", at: "2026-09-27T00:00:02.000Z", ok: false },
    ]);
    // Only failures go: the success stays, and a release with none left is a no-op.
    releaseLoginAttempt(ctx, { email });
    releaseLoginAttempt(ctx, { email });
    expect(uow.state.loginAttempts).toEqual([
      { email, at: "2026-09-27T00:00:01.000Z", ok: true },
      { email: "sam@example.com", at: "2026-09-27T00:00:02.000Z", ok: false },
    ]);
  });

  it("released reservations count as neither: five reserved and released never lock", () => {
    const { ctx } = setup();
    for (let i = 0; i < 10; i++) {
      reserveLoginAttempt(ctx, { email });
      releaseLoginAttempt(ctx, { email });
    }
    expect(refusal(() => reserveLoginAttempt(ctx, { email }))).toBeUndefined();
  });

  it("a success after reservations ends the count, as with recorded failures", () => {
    const { ctx } = setup();
    for (let i = 0; i < 4; i++) reserveLoginAttempt(ctx, { email });
    recordLoginAttempt(ctx, { email, ok: true });
    for (let i = 0; i < 4; i++) reserveLoginAttempt(ctx, { email });
    expect(refusal(() => reserveLoginAttempt(ctx, { email }))).toBeUndefined();
    expect(refusal(() => reserveLoginAttempt(ctx, { email }))?.code).toBe("RateLimited");
  });

  it("reserve prunes attempts too old to matter, and rejects an empty email", () => {
    const { ctx, uow, clock } = setup();
    recordLoginAttempt(ctx, { email: "sam@example.com", ok: false });
    clock.advance(30 * 60_000 + 1);
    reserveLoginAttempt(ctx, { email });
    expect(uow.state.loginAttempts).toEqual([{ email, at: "2026-09-27T00:30:00.001Z", ok: false }]);
    expect(refusal(() => reserveLoginAttempt(ctx, { email: " " }))?.code).toBe("Validation");
    expect(refusal(() => releaseLoginAttempt(ctx, { email: " " }))?.code).toBe("Validation");
  });
});
