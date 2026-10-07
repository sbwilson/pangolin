---
title: 'One closed state for the list, the warning and the review item'
type: 'bugfix'
ticket: ''
created: '2026-10-07'
baseline_revision: '2f8fc9129f9d758a89c48ba5dd61d3ee2c008aca'
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

**Problem:** Epic 2's third retrospective (finding Q1) found that stories 2.24 and 2.25 decided "closed" differently. An account closed for a future date stays in the default list yet already carries a closing-balance warning and an open review item, and nothing re-evaluates the item when the date arrives, because `syncClosingBalance` runs only on writes.

**Approach:** One predicate, "closed once `closedOn` is today or earlier by the clock", used by the list, the warning and the review item, and a daily job that brings the review items in step on the day a closed date arrives.

## Boundaries & Constraints

**Always:**
- Closed state is `closedOn !== null && closedOn <= today` (the clock's today), defined once in `accounts` and used by `listAccounts`' archive filter, `closingBalanceOf` (so `closingBalanceWarning` and `syncClosingBalance`) and the job. A future `closedOn` has no warning and no review item until the date arrives; the balance is still read as of `closedOn`.
- The lock stays "refuse dates after `closedOn`" and `closeAccount` still refuses a second close on any set `closedOn`; one doc comment states how the three rules relate. The closed date itself is archived and still takes entries dated that day (Simon, 2026-10-07).
- A daily job, scheduled in the household time zone, runs `syncClosingBalance` for every account with a set `closedOn`, as the job's system viewer, in one write. It is idempotent and raises or resolves exactly as the write paths do. It runs whether or not a backup repository is configured.
- Reopening, closing with a past date and every existing write path behave as before.

**Never:** change the lock, privacy, owner rules or the `closeAccount` refusal; add a column or migration; build screens; make a read write.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Future close | Cash account, `closedOn` after today, non-zero balance at that date | In the default list; no `warning`; no review item | none |
| Date arrives | Same account, clock reaches `closedOn`, job runs | Archived; `warning` on `getAccount` and `includeClosed`; one open item | none |
| Date arrives, zero balance | Balance zero at `closedOn` | No warning, no item | none |
| Past close | `closedOn` today or earlier | As before: warning and item raised in the close write | none |
| Reopen | `closedOn` cleared | Warning gone; item resolved | none |
| Job twice | Run on the same day twice | No second item, no extra audit | none |
| Non-cash type | Closed property or super account | No warning, no item | none |

</frozen-after-approval>

## Code Map

- New `packages/app/src/accounts/closed-state.ts` -- `isClosed(account: { closedOn: string | null }, today: string)` and the doc comment on how lock (`ledger/closed-lock.ts`, dates after `closedOn`), `closeAccount`'s refusal (any set `closedOn`) and the closed state relate.
- `accounts/list-accounts.ts` -- replace private `isArchived` with `isClosed`; `viewOf` passes `ctx.clock.today().toString()` to `closingBalanceWarning`.
- `accounts/closing-balance.ts` -- `closingBalanceOf` and `closingBalanceWarning` take `today`; return null unless `isClosed`; `syncClosingBalance` uses `ctx.clock.today()`; resolution text keeps "opened again" for `closedOn === null` and "the closing balance reached zero" otherwise, and a future date resolves with "the closed date has not come".
- Callers of `closingBalanceWarning`: `close-account.ts:50`, `update-account.ts:108`, `rejoin-account.ts:78`, `set-privacy.ts:77`, `list-accounts.ts:43` (all have `ctx.clock`).
- Job: new kind `closing-balance-sync` and `closingBalanceSchedule(timeZone)` in `packages/app/src/system/` or `accounts/` beside the pattern of `BACKUP_SNAPSHOT_JOB` and `nightlyBackupSchedule` (`system/backups.ts:28,179`; lane `local`, `dailyAt`, time just after midnight); export from `packages/app/src/index.ts`; a handler in `apps/server/src/jobs/` (`jobHandler`, `jobs/backup.ts` pattern) that runs `write(ctx, ...)` over `tx.accounts.list(ctx.viewer)` with `syncClosingBalance`; register the kind and the schedule in `apps/server/src/jobs/index.ts` (`JOB_KINDS`, `createJobs`: schedule always, not behind `backup.repository`). Check `registry.test.ts` and `jobs/index` tests that enumerate kinds.
- Tests: `packages/db/src/accounts.test.ts` (matrix at use-case level, with the clock moved past `closedOn`), `testing/accounts-parity.test.ts`, `apps/server/src/jobs/*.test.ts` (handler idempotent), `apps/server/src/http/app.test.ts` if the HTTP list changes.
- Existing closing-balance tests that close with a past date stay; any that use a future `closedOn` (`accounts.test.ts` ~L803) are updated.
- Do not change: `ledger/closed-lock.ts`, `close-account.ts` refusal, migrations.

## Tasks & Acceptance

**Execution:**
- [ ] `accounts/closed-state.ts`, `list-accounts.ts`, `closing-balance.ts` and the five callers -- one predicate, `today` through
- [ ] job kind, schedule, handler and registration -- the daily sync
- [ ] tests -- the matrix, with a moved clock; the job's idempotence

**Acceptance Criteria:**
- Given a cash account closed for a future date with a balance, when it is listed, then it is in the default list with no warning and no review item exists.
- Given the clock reaches that date and the job runs, then the account is archived, carries the warning and has one open item; a second run changes nothing.
- Given any existing close, reopen or ledger write, then behaviour is as before.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 0, low 3 patched, 2 deferred, 10 rejected, false 3, maybe-false 1.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `listAccounts` reads the clock's today once for the filter and again per row in `viewOf`, so one list could straddle midnight (blind) | low | patch | `list-accounts.ts` computes `today` and `viewOf` calls `ctx.clock.today()` again; compute once and pass it in. |
| The sync job's kind has `needsPersonWhenDead: false`: a dead job leaves items missing and tells nobody (blind, edge) | low | patch | The backup kinds set it true, raising a household `job.dead` item; set it true here. |
| The `closeAccount` doc comment is wrapped unevenly (blind) | low | patch | Re-wrap the paragraph. |
| A person who resolves a closing-balance item by hand gets a fresh one at the next nightly run, since `raiseReviewItem` dedupes only among open items (blind) | maybe-false | defer | No screen can resolve an item yet; settle it when the review inbox lands. |
| A stale open item on a future-closed account (raised under the old rule) is resolved by the job, which no test seeds (VG) | low | defer | The resolve branch is covered through `updateAccount`; only data written before this change can hold such an item, and pang-dev holds none. |
| Clock and schedule zones may disagree; the tests use UTC (blind, VG, edge) | false | rejected | `server.ts:110` builds the runner's clock with `systemClock(timezone)` from the household settings, the same zone `dailyAt` takes. |
| Nothing runs the sync at startup; 00:00 to 00:05 has no item; a missed day is not caught up (blind, edge) | low | rejected | A pending job row persists, and an overdue one runs when the runner starts (the job test's first tick runs the overdue 09-27 job). |
| Items raised for future-dated closes under the old rule stay until the first run (blind, edge) | low | rejected | The first run resolves them; no ledger account exists on pang-dev. |
| One account's failure rolls back the whole sync (edge) | low | rejected | The only throw is a dedupe key open under another kind, which no code path creates. |
| Future-dated writes no longer raise an item (intent, edge) | false | rejected | That is the plan's matrix. |
| The closed date is archived while still taking entries (blind, edge) | low | rejected | Simon accepted it on 2026-10-07. |
| Repeated `ctx.clock.today().toString()`; `isClosed` as a type guard; `syncClosingBalances` does not check the viewer is the system viewer; thin job-test assertions; schedule order (blind, VG) | low | rejected | Style, or the fix adds surface for a job-only caller. |
| No HTTP-level test for a future `closedOn` (intent) | false | rejected | The route passes through to `listAccounts`, which the use-case tests cover. |

## Design Notes

A read cannot raise the item, and a write is not guaranteed on the day, so the job is the one place a date arriving becomes an item. The warning is derived on read and needs no job.

## Verification

**Commands:**
- `pnpm vitest run` -- expected: pass; `pnpm lint` and `pnpm typecheck` -- expected: clean
