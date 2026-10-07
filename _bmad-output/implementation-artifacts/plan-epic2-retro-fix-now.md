---
title: 'Epic 2 retrospective fix-now changes (S1, S2, S3, S8)'
type: 'chore'
ticket: ''
created: '2026-10-07'
baseline_revision: 'd13965893cbdba6487e8265c2a398ffda0a1122b'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The fourth retrospective pass found that the split between the ledger lock (applies once `closedOn` is set, even for a future date) and the closed state (`closedOn` today or earlier) is documented but untested; that the job's day is tested only under UTC; that the lock's and `closeAccount`'s messages say an account "was closed" or is "already closed" when the list still shows it as open; and that two doc comments still describe the old rule.

**Approach:** Pin the split with tests, test the job in a non-UTC zone, give a future-closed account the wording "closes on <date>", and correct the two comments. Simon approved all four on 2026-10-07, including the wording.

## Boundaries & Constraints

**Always:**
- The rules do not change: the lock still refuses a write dated after a set `closedOn` (future or not), and `closeAccount` still refuses a second close while `closedOn` is set. Only messages and tests change.
- When `closedOn` is later than the clock's today, the lock's message reads "This account closes on <closedOn>, so a <kind> dated <date> is locked. Move the closed date to <date> or later, move its manually entered transactions dated after <closedOn> back to on or before it, or reopen the account." and `closeAccount`'s reads "The account closes on <closedOn>; change that date with updateAccount, or reopen it". When `closedOn` is today or earlier both messages stay as they are. The `ClosedAccountDetails` carried by the lock's Conflict does not change.
- The test for "not yet closed" is `isClosed` (`accounts/closed-state.ts`) with the clock's today.

**Never:** change the lock or refusal rules, the predicate, the job, a schema or any public API beyond what the tests need.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Entry after a future closedOn | Closed for a date after today; entry dated after it | Refused | `Conflict`, message starts "This account closes on" |
| Entry on or before it | Same account; entry dated on or before `closedOn` | Accepted | none |
| Entry after a past closedOn | `closedOn` today or earlier | Refused | `Conflict`, message starts "This account was closed on" |
| Second close, future | `closedOn` after today | Refused | `Conflict` "The account closes on <date>; change that date with updateAccount, or reopen it" |
| Second close, past | `closedOn` today or earlier | Refused | `Conflict` "The account is already closed" |
| Job, non-UTC zone | Sydney, closed for 2026-10-05; now 2026-10-04T13:06Z | The run raises the item | none |
| Both adapters | SQLite and memory mirror | Same outcomes | none |

</frozen-after-approval>

## Code Map

- `packages/app/src/ledger/closed-lock.ts:67-81` (`requireOpenOn`) -- message branch on `isClosed(account, ctx.clock.today().toString())`; `requireClosableOn`'s message is unchanged.
- `packages/app/src/accounts/close-account.ts:37` -- message branch on `isClosed(before, today)`; `today` is already read for the default date.
- `packages/app/src/accounts/closed-state.ts` -- reuse `isClosed`; update its doc note on the two messages.
- `packages/app/src/accounts/pool.ts:~41` (`warning` doc) and `list-accounts.ts` (the `listAccounts` doc comment) -- S8.
- Tests: `packages/db/src/accounts.test.ts` describe "one closed state for the list, the warning and the review item" (helper `closedForTheFuture`, clock 2026-09-27; `txn` helper) -- S1 and both messages; `packages/app/src/testing/accounts-parity.test.ts` `closedState` flow -- S1 on both adapters; `apps/server/src/jobs/closing-balance.test.ts` -- S2 (`systemClock("Australia/Sydney", ...)`, `createJobs({ timezone })`); `packages/app/src/ledger/closed-lock.test.ts` -- the past-date message stays (it may assert the text).
- Do not change: the job, `closing-balance*.ts`, migrations.

## Tasks & Acceptance

**Execution:**
- [ ] `closed-lock.ts`, `close-account.ts`, `closed-state.ts` -- the "closes on" wording
- [ ] `pool.ts`, `list-accounts.ts` -- the comments
- [ ] tests -- the matrix at use-case, parity and job level

**Acceptance Criteria:**
- Given an account closed for a later date, when an entry is written after it, then it is refused with "closes on"; one on or before is accepted; a second close is refused with "closes on".
- Given a closed date today or earlier, then both messages are as before.
- Given a Sydney household whose date differs from UTC, when the job ticks at 00:06 local, then the item is raised on that run.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 0, low 3 patched, 1 deferred, 8 rejected, false 1, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| The parity test's accepted probes (-100 on 10-05, +100 on 09-10) cancel, and only that keeps the later warning at 1000 (blind, edge) | low | patch | `accounts-parity.test.ts` `futureOn` and `futureBefore`; say so in a comment. |
| `closeAccount` reads the clock once for the default date and again for the message, so the plan's "already read" is not true and the two can straddle midnight (edge) | low | patch | `close-account.ts:34,40`; read `today` once and reuse it. |
| The `requireOpenOn` doc comment wraps raggedly after the edit (blind) | low | patch | Re-wrap the paragraph. |
| The future-date message names `updateAccount`, a use-case name, where the lock's message speaks in user terms (blind) | low | defer | The text is the plan's frozen wording; the copy a person reads belongs to the screens (epic-ledger-workspace), which can map the structured error. Reword then. |
| `closed-lock.ts` imports `accounts/closed-state.ts` while `accounts` imports the lock: a cycle or layering break (blind) | false | rejected | `closed-state.ts` has no imports (grep), so there is no file cycle; the folder-level two-way dependency was already recorded in the third pass (Q10). |
| Wording is duplicated in two files; no machine flag for clients (blind, edge) | low | rejected | Two messages; the structured details are unchanged and the fix adds surface. |
| The Sydney test has no second tick, no zone behind UTC, no midnight-gap zone; its title says 00:06 while the schedule is 00:05 (blind) | low | rejected | The first two are extra axes, and the title names the tick, not the schedule. |
| `closed-lock.test.ts` asserts only "was closed on"; the parity test asserts only the prefix; no snapshot-kind wording test (blind, VG) | low | rejected | The use-case tests assert both full messages; the wording does not depend on the kind. |
| No HTTP-level wording test; the screens' copy and the experience docs differ from the API text; the doc row in EXPERIENCE.md reads differently (intent, blind) | low | rejected | The route passes the message through; the screens own their copy. |
| The diff edits four comments, not two; the `closeAccount` message adds remedy words beyond "closes on" (intent) | low | rejected | The extra comments record the new wording; the remedy words are the plan's. |

## Design Notes

The lock's message cannot say "was closed" for an account the list shows as open; the rule itself stays because a closed date, once set, is a promise that later entries move.

## Verification

**Commands:**
- `pnpm vitest run` -- expected: pass; `pnpm lint` and `pnpm typecheck` -- expected: clean
