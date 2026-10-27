---
id: 1
type: bug
title: "Lockout holds under concurrent sign-ins"
parent: none
covers: []
after: []
assignee: ""
refined: false
hitl: false
risk: high
severity: P1
estimate: ""
---

# Lockout holds under concurrent sign-ins

## Description

The login lockout only works when wrong passwords arrive one after another. When many sign-ins for one email arrive at once, every one is checked against the password hash before any failure is recorded, so an attacker gets about twice `PANGOLIN_LOGIN_MAX_FAILURES` guesses from one client and more from several, and a correct password sent at the end of a burst signs in.

## Reproduction

Run the `it.fails` S11a test in `apps/server/src/auth/auth.test.ts`: 19 wrong passwords and then the right one for one email, all at once, against an in-process server. Every request is evaluated, and the last one signs in with 200 where 429 is expected. Evidence and runs at the production rate limit are in the spike's findings, section 2.

## Cause Hypothesis

The lockout check reads the failure count, runs the scrypt hash, then records the failure: check-then-act across an await, so concurrent requests all pass the check before any of them records.

## Acceptance Criteria

1. **The lockout holds under concurrency**
   **Given** one email and `maxFailures` from the auth config
   **When** many sign-ins for it arrive at once, wrong passwords first and the right one last
   **Then** at most `maxFailures` are evaluated, every response is 401 or 429, and the right password is refused with 429
2. **Tests cover the condition found and fixed**
   **Given** the test suite
   **When** it runs
   **Then** the S11a test runs as a normal `it` and passes, and the existing lockout tests still pass
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the expected behavior already holds, with the evidence recorded in Notes — this supersedes 1 and 2

## References

- findings — _bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/spike-check-the-suspected-seams-findings.md, section 2 (S11a)
- security — _bmad-output/specs/spec-pangolin-money/security-and-recovery.md
