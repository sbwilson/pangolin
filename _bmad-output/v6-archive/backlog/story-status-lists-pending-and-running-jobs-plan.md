---
title: 'pangolin status lists pending and running jobs'
type: 'feature'
ticket: '4'
created: '2026-10-03'
status: done
baseline_revision: '040326f9922745af91046ee172eb08c15345c256'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'auto'
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `sudo pangolin status` shows only counts of pending and running jobs, so the operator cannot see what is queued or due next.

**Approach:** Add the lists to the status result and print them like the dead jobs: pending jobs soonest first (kind and due time), running jobs (kind and lease end), at most ten each, with a "next 10 of N" header when there are more. Kind and time only, never a payload or error text (AD-9). The CLI only; the web status page is unchanged.

</frozen-after-approval>

## Implementation Notes

A repo query, a use case, a status field, a few CLI lines and tests: built on the oneshot route.

- Port: `JobRepo.listPending(limit)` → `PendingJobRow { kind, runAt }` (soonest `runAt`, then id) and `listRunning(limit)` → `RunningJobRow { kind, leaseExpiresAt }` (soonest lease end, then id); both in the read-only `ReadRepos.jobs` Pick. Two methods rather than one `listQueued(status)`, since the rows differ in shape.
- SQLite (`packages/db/src/job-repo.ts`, `unit-of-work.ts` read repos) and memory uow select kind and time only.
- Use cases `pendingJobs` / `runningJobs` with `QUEUED_JOBS_LIMIT = 10` in `packages/app/src/system/job-status.ts`, exported from `packages/app/src/index.ts`.
- `StatusResult` gains `pendingJobs` and `runningJobs`; `printStatus` prints them straight after the `Jobs:` line ("Pending jobs (soonest first):" / "(next 10 of N):", "Running jobs:" / "(10 of N):", lines `  <time>  <kind>`, running ones suffixed `  (lease until)`), nothing for an empty list. The web status page is unchanged.
- `docs/install.md` §9 `status` bullet mentions the lists.
- Tests: `packages/db/src/job-repo.test.ts` (order, limit, outside-transaction), `packages/app/src/system/job-status.test.ts` (order, limit 10, no payload/error/lease owner), `apps/server/src/admin/socket.test.ts` (fields present, empty and populated, no secrets or IDs), `apps/server/src/cli.test.ts` (12 pending → "next 10 of 12" with ten lines, running line, nothing printed when there are no jobs).

## Review Triage Log

Quick review: high 0, medium 0, low 2, false 1.

- low, patched: the `release-workflow.test.ts` lint clean-up (two `noTemplateCurlyInString` warnings from story 11.6) is outside this story; committed separately.
- low, patched: rewrapping the `status` docs bullet left a 117-character line.
- false: the counts and lists cannot disagree: `statusCommand` is synchronous and its three reads run back to back on the one better-sqlite3 connection in the process that owns the database and the runner, so no claim can land between them.
