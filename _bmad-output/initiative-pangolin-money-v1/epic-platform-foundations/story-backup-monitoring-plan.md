---
title: 'Backup monitoring'
type: 'feature'
ticket: '14'
created: '2026-10-01'
status: 'built'
baseline_revision: 'a38fae70094d079cfb3bb3ed8773a9a36a1133c7'
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

**Problem:** Only a crashed backup job raises an alert. A schedule that silently stops, backups switched off, a corrupt repository, or a backup that no longer restores all go unnoticed until the day a restore is needed.

**Approach:** Add a weekly `restic check` (Sundays 03:30), a monthly restore drill (1st, 04:00) that restores the latest snapshot into a temporary directory and runs the existing restore verification, and a stale-backup warning (last good backup older than about 48 hours). Results show in `pangolin status` and on the web status page; a failed check raises a review item.

## Boundaries & Constraints

**Always:** Times are in the household time zone. The check and drill run only when a backup repository is configured. The drill never touches live data files and removes its directory afterwards. Reuse 1.10's `fetchSnapshot` and `verifyFetched`. Status output follows the existing `/api/system/backup` and `pangolin status` shapes. Every new job and review item goes through the existing use-case, audit and job-runner conventions.

**Decisions (human, 2026-10-01):**
- Results are stored in a new STRICT table `backup_verification` (kind, at, ok, summary) via migration 0006 and a repo method, keeping history.
- A stale backup does not fail `/healthz`: readiness stays ok and staleness is a warning field in the body, `pangolin status` and the page. `pangolin status` therefore still exits 0 when only the backup is stale.
- A failed check or drill raises a dedicated household-scope review item on the first failure, auto-resolved on the next success.
- A configured repository with no backup yet is timed from first start: no stale warning for 48 hours.

**Never:** No attachment decryption or attachment snapshotting (epic 5). No `forget` or `prune` on the repository. No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Check passes | Healthy repository, Sunday 03:30 | Result recorded and shown as passing | No error |
| Check fails | `restic check` exits non-zero | Failure shown in status and on the page; one open review item, resolved by the next pass | Repeat failures do not duplicate the item |
| Drill passes | Latest snapshot verifies | Pass shown with its time | Temp directory removed |
| Drill fails | Restore or verification fails | Failure with the failed check named, on the page | Temp directory removed; raises the same failure signal as the check |
| Stale backup | Last good backup older than 48 hours | Warning in status, the page and the `/healthz` body; `/healthz` stays 200 and status exits 0 | No warning when no repository is configured |
| Fresh backup | Last good backup within 48 hours | No warning | None |
| Configured, never backed up | Repository set, no snapshot yet | No warning until 48 hours after first start | None |
| Schedule times | Household zone with DST, month lengths | Runs at local 03:30 Sunday and 04:00 on the 1st | Test across a DST change |

</frozen-after-approval>

## Code Map

- `packages/app/src/system/backups.ts` -- job kinds, `dailyAt`, `nightlyBackupSchedule`, `lastBackup`; add `weeklyAt`/`monthlyAt`, check/drill kinds and schedules, and a shared pure `backupFreshness(last, now)` with `STALE_BACKUP_MS` (last good = newest pushed row's `takenAt`).
- `apps/server/src/jobs/index.ts`, `jobs/backup.ts` -- `JOB_KINDS`, `createJobs` schedules (gated on repository), handlers via `jobHandler`; the drill needs `migrationsDir` added to `JobsDeps` (`server.ts` already has it).
- `apps/server/src/backup/restic.ts` -- add `check(signal)` to `Restic`; never forget/prune.
- `apps/server/src/backup/restore.ts` -- reuse `fetchSnapshot`, `verifyFetched`; drill directory under the data volume (not the 64 MB `/tmp`), cleaned in `finally`.
- `apps/server/src/testing/stub-restic.mjs`, `testing/restic.ts` -- add a `check` case; `STUB_RESTIC_FAIL=check` already injects failure.
- `apps/server/src/admin/commands.ts` (`BackupStatus`), `apps/server/src/cli.ts` (`printStatus`), `apps/server/src/http/app.ts` (`/api/system/backup`, `/healthz`), `apps/web/src/api.ts`, `apps/web/src/App.tsx` -- extend the one backup payload with `stale`, `check`, `drill`.
- `packages/app/src/system/readiness.ts`, `/healthz` body -- add a non-failing warning field; readiness checks list unchanged.
- `packages/app/src/system/review-items.ts` -- register the household-scope backup-verification-failed kind; resolve with `resolveReviewItem` on success.
- Tests to mimic: `apps/server/src/jobs/backup.test.ts`, `backup/restore.test.ts`, `readiness.test.ts`, `cli.test.ts`, `e2e/jobs.spec.ts`. Update the exact `JOB_KINDS` assertion.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/system/backups.ts` -- new kinds, `weeklyAt`/`monthlyAt`, schedules, `backupFreshness` -- one shared rule for CLI, page and readiness
- [x] `apps/server/src/backup/restic.ts`, stub -- `check` -- weekly repository check
- [x] `apps/server/src/jobs/backup.ts`, `index.ts` -- check and drill handlers, registration, `migrationsDir` dep -- run and record results
- [x] `packages/db` migration 0006, `ports/unit-of-work.ts`, `memory-uow.ts` -- `backup_verification` table and repo method; raise/resolve the review item
- [x] `commands.ts`, `cli.ts`, `http/app.ts`, `apps/web` -- show check, drill and stale warning
- [ ] tests for every matrix row, including schedule times across DST

**Acceptance Criteria:**
- Given the schedules, when a household zone crosses a DST change, then the check runs at local 03:30 Sunday and the drill at 04:00 on the 1st.
- Given a seeded backup, when the drill runs, then live data files are untouched and its directory is gone afterwards.
- Given a backup older than 48 hours, when `pangolin status` or the page loads, then the stale warning shows.
- Given CI, when the change is pushed, then lint, types, tests and `check:strict` are green.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; four lenses). Patches applied: 3 (low). Deferred: 2. Rest rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| low | patch (done) | `system-health-repo.test.ts` set `user_version = 7`, now the real version, so the test was vacuous. Now uses 99. |
| medium | patch (done) | No test for the drill's could-not-run/abort path. Added a `STUB_RESTIC_HANG=restore` test: no row, retried, no `drill-*` left, no review item. |
| false | rejected | Env vars leak between tests: a file-level `afterEach` already deletes them. |
| false | rejected | Check summary may leak the repository URL secret: `failed()` runs `redactRepository` on restic stderr before the message is built. |
| medium | defer | Web page rendering of stale/failed/passed states is untested; needs a web harness (already deferred for other items). |
| low | defer | Overdue check/drill not detected; drill has no disk headroom guard. |
| low | rejected | Restic check exit codes all recorded as failure (backup-server outage raises an item that resolves on the next pass); acceptable and matches the decision to raise on first failure. |
| low | rejected | Drill records non-restic errors (ENOSPC, migrations load) as verdicts: the household is told why the drill failed, which is informative, not false. |
| low | rejected | SnapshotNotFound returns silently; first-start baseline is MIN(job.created_at); stale read error in `/healthz` unlogged; NaN takenAt; leftover-dir rmSync throw; dir-stamp collision; `role="alert"` re-announce: unlikely, and each fix adds guards or branches. |
| low | rejected | Plan/doc hygiene (unchecked tasks, function signature differs from plan, no runbook text): plan edits; no user harm. |

## Design Notes

Defaults chosen from repo evidence, outside the frozen block: metadata-only `restic check` (no `--read-data-subset`); the drill is one `net`-lane job with the verification running in it; "last good" uses `takenAt` because a restore inserts a pushed row stamped with restore time.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm check:strict` -- expected: all pass
