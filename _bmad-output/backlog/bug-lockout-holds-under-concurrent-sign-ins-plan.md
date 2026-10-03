---
title: 'Lockout holds under concurrent sign-ins'
type: 'bugfix'
ticket: '1'
created: '2026-10-03'
status: done
baseline_revision: 'cf6498dc81a41b23941bde0f8126febe319b2a03'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The login lockout reads the failure count before the password hash runs and records the failure after it, with an await between. Concurrent sign-ins for one email all pass the check before any failure is recorded, so a burst gets every guess evaluated, and a correct password at the end of the burst signs in (spike 11.2, seam S11a).

**Approach:** Count each attempt before the hash runs: in one synchronous transaction, check the lock and record the attempt as a provisional failure. Afterwards a success records a success as today, a rejected password or code leaves the failure in place, and an outcome that is neither (a right password awaiting its TOTP code, or any other error) removes one provisional failure for that email. The recovery-code sign-in gets the same treatment.

## Boundaries & Constraints

**Always:** The lock decision and the provisional record happen in one transaction with no await between them. Sequential behaviour is unchanged: one wrong password is exactly one failure, a success ends a lockout, a right password awaiting TOTP counts as neither, and a locked email refuses even correct credentials with 429 `RateLimited` before better-auth sees them. An attempt whose outcome is never seen (a crash between the hooks) stays counted as a failure.

**Never:** Add a migration or a column. Change the lockout policy or its defaults. Hold an in-memory lock or counter as the guard (the database stays the record).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Concurrent burst | 19 wrong then the right password for one email, all at once | at most `maxFailures` evaluated (401), the rest 429, the right one 429 | No error |
| Sequential wrong passwords | `maxFailures` wrong, one at a time | each is 401 and records exactly one failure; the next is 429 | No error |
| Success | right password, no 2FA | session; one success recorded; earlier failures no longer count | No error |
| Right password awaiting TOTP | 2FA enabled | the provisional failure is removed: counts as neither | No error |
| Other error | a non-401 failure (e.g. 400 bad body) after the reservation | the provisional failure is removed | No error |
| Locked | email locked | 429 before better-auth; nothing recorded | No error |
| Recovery-code burst | concurrent `recover` calls with wrong codes | at most `maxFailures` evaluated, the rest 429 | No error |

</frozen-after-approval>

## Code Map

- `packages/app/src/identity/lockout.ts` -- add `reserveLoginAttempt(ctx, {email}, policy)`: inside `ctx.uow.transaction`, list attempts since the horizon, compute `lockedUntil` (provisional failures are ordinary failures), throw the same `RateLimited` as `assertLoginAllowed` when locked, else prune old rows and insert `{email, at: now, ok: false}`. Add `releaseLoginAttempt(ctx, {email})`: delete the newest failure row for the email. Keep `assertLoginAllowed` and `recordLoginAttempt` (other callers and tests); export the new ones from `packages/app/src/index.ts`.
- `packages/app/src/ports/unit-of-work.ts:375` `LoginAttemptRepo` -- add `deleteNewestFailure(email: string): void`; implement in `packages/db` (the login-attempt repo; find it beside `identity-repos.ts`) and `packages/app/src/testing/memory-uow.ts`.
- `apps/server/src/auth/hooks.ts` `authHooks` -- `before`: `reserveLoginAttempt` instead of `assertLoginAllowed`. `after` for SIGN_IN / VERIFY_TOTP: new session and not pending TOTP → record success (as today); pending TOTP → `releaseLoginAttempt`; 401 → nothing (already counted; remove today's `ok: false` insert); any other outcome → `releaseLoginAttempt`. The email for the release comes from `attemptEmail(hook)` as today. VERIFY_PASSKEY is unchanged (not reserved).
- `apps/server/src/auth/recovery.ts:153-168` `recover` -- `reserveLoginAttempt` instead of `assertLoginAllowed`; on `Unauthenticated` keep the failure (drop the extra `ok: false` insert); on success record success; on any other error `releaseLoginAttempt`. `reEnrol` unchanged.
- `apps/server/src/auth/auth.test.ts:452-490` -- turn the `it.fails` S11a test into `it`; add tests for each matrix row not already covered by the existing lockout tests (pending TOTP counts as neither, a non-401 error is released, sequential count unchanged); `apps/server/src/auth/recovery.test.ts` -- a concurrent recovery burst.
- `packages/app/src/identity/lockout.test.ts` (if it exists, else beside it) -- unit tests of reserve and release on the memory unit of work.
- Backlog ticket `_bmad-output/backlog/bug-lockout-holds-under-concurrent-sign-ins.md` -- do not edit.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app` + `packages/db` -- reserve, release, repo method
- [x] `apps/server/src/auth/hooks.ts`, `recovery.ts` -- use them
- [x] tests -- every matrix row; S11a turned on

**Acceptance Criteria:**
- Given the existing lockout, recovery and auth tests, when the suite runs, then they all pass unchanged apart from the S11a test now running as `it`.

## Implementation Notes

- A success (password without 2FA, TOTP, recovery code) calls `releaseLoginAttempt` before `recordLoginAttempt({ok: true})`, so the provisional failure is replaced rather than left behind under the success. Without this, existing tests that count `ok = 0` rows (recovery.test.ts "are issued once…", auth.test.ts "TOTP lockout") failed, breaking the acceptance criterion; lock semantics are unaffected either way, since failures before a success never count. The hook's release on success uses `session.user.email`; a passkey success releases nothing (it reserved nothing).
- better-auth 1.7.6 (`dispatch.mjs`): our before-hook runs first, and a throw from it skips the endpoint and every after-hook, so a 429 from the reservation never reaches the release. A non-API error thrown by the endpoint also skips the after-hooks, so such an attempt stays counted (as the plan allows).

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 3, low 4, false 3, rejected low 4, deferred 0.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch (done) | The burst tests passed with zero evaluated (`<= maxFailures`) and never checked `login_attempt`; now exact counts and rows. |
| medium | patch (done) | Recovery's "any other error releases" branch was never run by a test; added a failing-lookup stub test. |
| medium | patch (done) | `/two-factor/verify-totp` reserves but had no concurrent test; added a TOTP burst. |
| low | patch (done) | A throw from `releaseLoginAttempt` in recovery's catch replaced the original error; wrapped. |
| low | patch (done) | The passkey lockout test asserted statuses only, so a release on passkey success would pass; now counts rows. |
| low | patch (done) | The release docstring called failures "interchangeable" though `lockedUntil` reads timestamps. |
| low | patch (done) | The S11a block comment still described the seam in the present tense. |
| false | rejected | A non-APIError from the endpoint skips the after hooks, so the reservation stays a failure: the frozen Always accepts an outcome never seen staying counted. |
| false | rejected | Concurrent correct sign-ins can briefly get 429 while provisional failures are in flight: the approach the intent chose; at most until the burst settles. |
| false | rejected | The success path also releases one failure: kept so the existing count tests pass unchanged (the acceptance criterion); failures before a success never count. |
| low | rejected | The release deletes the newest failure, not its own row: the count is preserved and a lock's end moves only by the gap between two attempts in a burst; carrying a row id from the before hook to the after hook adds per-request state. |
| low | rejected | The TOTP after hook re-derives the email, which may be gone after the endpoint: the failure then stays counted, which is the conservative side. |
| low | rejected | Release and success record are two transactions: synchronous with no await between, in the one process that owns the database. |
| low | rejected | `assertLoginAllowed` is unused in production: the plan keeps it for its tests and as a read-only query. |

## Verification

**Commands:**
- `npx vitest run apps/server/src/auth packages/app/src/identity packages/db` -- expected: pass
- `pnpm lint && pnpm typecheck` -- expected: clean
