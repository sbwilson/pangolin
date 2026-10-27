---
title: 'Check the suspected seams'
type: 'chore'
ticket: '2'
created: '2026-10-03'
status: done
baseline_revision: '4da7f54615af370b5c43eb0352fad491a35e5828'
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

**Problem:** The epic 1 retrospective found seven suspected seams (S10, S11) by reading code only; nothing was run, so nobody knows which are real (retro "Could not be resolved").

**Approach:** Run each seam: reproduce it with a test or a scripted run against the real code, record the evidence and a verdict (real, not real, or real but harmless), and propose the follow-up for each real one: a story in this epic for `deploy/` seams, a backlog ticket for app-code seams. The spike changes no product code.

## Boundaries & Constraints

**Always:** Every verdict cites evidence that was run (a test, a command and its output), not reasoning alone. Reproduction tests that show a real seam are kept, skipped (`it.skip` / `it.fails` with the seam id) so the fix story can turn them on; tests that show a seam is not real are kept as regression tests if cheap, otherwise dropped.

**Never:** Fix a seam in this spike. Write to `tickets.toml` or the backlog: the spike proposes the follow-up entries in its findings note, and they are added through ticketing afterwards. Run anything against the dev or prod VM.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Seam reproduced | a test or scripted run shows the bad outcome | verdict real, evidence, proposed follow-up (deploy/ story or backlog ticket) with a one-line description and verify | No error |
| Seam not reproduced | the run shows the guard holds | verdict not real, evidence | No error |
| Cannot run here | needs a real VM, root, or a large database beyond a test's reach | verdict unverified, what would settle it, proposed follow-up as a backlog check | No error |

</frozen-after-approval>

## Code Map

The seven seams (retro S10, S11) and where to look:

1. **S10, status after restore.** `apps/server/src/cli.ts` `printStatus` (last backup "at"), `packages/app/src/system/backups.ts` (`takenAt` vs the restore's own row; staleness). Check: restore a snapshot in a test (see `apps/server/src/admin/restore.test.ts` or `cli.test.ts` restore tests) and compare the printed "last at" with the snapshot's `takenAt`.
2. **Lockout check-then-act across the scrypt hash.** `apps/server/src/auth/` (login attempts, `PANGOLIN_LOGIN_MAX_FAILURES`), `packages/app` login-attempt repo. Check: fire N+k concurrent wrong-password sign-ins at an in-process server (see existing lockout tests) and count how many are evaluated before the lock.
3. **Drill `integrity_check` stalls lease renewal.** `apps/server/src/jobs/` drill handler and runner lease renewal (`PANGOLIN_JOB_LEASE_MS`, min 3000). Check: a large-enough generated database (or a stubbed slow synchronous check) with a short lease; does another runner claim the job, or the lease expire mid-drill?
4. **`stop_grace_period` equals the runner's 10 s stop.** `deploy/compose.yaml` and root `compose.yaml` `stop_grace_period`, `apps/server/src/main.ts`/runner stop timeout. Check: read both values; in a test, a handler that ignores abort past the runner's stop: is SIGKILL possible before the database closes? Verdict may be "real but harmless" if WAL makes it safe.
5. **Upgrade rollback discards writes made during the health wait.** `deploy/pangolin` upgrade and rollback (pre-upgrade copy restored). Check: in `deploy/pangolin.test.ts` style, simulate a write to the live database after the new image starts and before the rollback; is it lost? (GNU `sed` needed: run on Linux or note.)
6. **`install.sh` re-run overwrites `compose.yaml` and the CLI that `pangolin upgrade` installed.** `deploy/install.sh` `write_files`, `deploy/pangolin` upgrade (installs the image's compose.yaml and CLI). Check: in `deploy/install.test.ts`, upgrade-installed files, then a plain re-run of an older `install.sh`; which version wins?
7. **`--backup-server ""` cannot disable backups.** `deploy/install.sh` `env_add`/`env_replace` for `PANGOLIN_BACKUP_REPOSITORY` and `--backup-server` parsing. Check: install with a backup server, re-run with `--backup-server ""`, read `.env`.

Output: `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/spike-check-the-suspected-seams-findings.md` — one section per seam: what was run, the evidence (trimmed output), verdict, and for real ones a proposed entry (type, title, one-sentence description and verify, `after`, deploy/ story or backlog).

## Tasks & Acceptance

**Execution:**
- [x] each seam 1-7 -- run the check, keep or drop the reproduction test per Boundaries
- [x] findings note -- every seam with evidence, verdict and proposed follow-up

**Acceptance Criteria:**
- Given the findings note, when it is read, then every one of the seven seams has a verdict backed by something that was run, and every real seam has a proposed follow-up placed per the epic's decision (deploy/ → story before the sweep, app code → backlog).

## Implementation Notes

- Findings: `spike-check-the-suspected-seams-findings.md` (beside this plan). Verdicts: S10 real, S11a real, S11b real but harmless, S11c real but harmless, S11d real, S11e real, S11f real.
- Kept tests, each named after its seam: `it.fails` for S10 (`apps/server/src/cli.test.ts`), S11a (`apps/server/src/auth/auth.test.ts`), S11c, S11e and S11f (`deploy/install.test.ts`) and S11d (`deploy/pangolin.test.ts`); S11b is a passing regression test with a passing control beside it (`apps/server/src/jobs/runner.test.ts`). No product code changed; `tickets.toml` and the backlog are not written.
- S11c's SIGKILL timing and the integrity_check timing were scratch runs (not kept): a child process running `startServer`, and a generated 465 MB database.
- The S11d test stubs `docker` by running the script's own `sh -c` steps on host directories, and adds a `sed` shim so GNU `sed -i` works on macOS too.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 4, low 7, false 4, rejected low 2, deferred 0.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch (done) | S11a's kept test did not assert the worst result (a correct password last in the burst signs in), had no timeout (a timeout keeps `it.fails` green after a fix), accepted any status, and hard-coded the limit. |
| medium | patch (done) | S11b's doc claimed a kept control test that was not kept; without it the regression test could pass because runner B never polls. |
| medium | patch (done) | S11c's test read only `NNs` durations and only `deploy/compose.yaml`, so a correct fix could stay failing or half-verified. |
| medium | patch (done) | S11e's test accepted only one of the two fixes its proposed story allowed; the story now picks one. |
| low | patch (done) | S11d's stub matched `ps`/`up` anywhere in the arguments (a temp path can contain "ps"), and the exact message assertion would break the story's own change. |
| low | patch (done) | S10's comment and date disagreed, and its `UPDATE` had no `WHERE`. |
| low | patch (done) | Proposals: S10 verify missed `/api/system/backup`; S11d had no cleanup for `rolled-back-*` copies; S11f did not say whether the allowlist entry goes. |
| low | patch (done) | S11b's `/healthz` stall during `integrity_check` got no follow-up; now a backlog check, verdict unverified. |
| low | patch (done) | Evidence presented as output was trimmed without saying so; `after: [2]` and "entry 7" did not name the file they index. |
| false | rejected | The plan is missing from the reviewed diff: excluded on purpose; the findings name it. |
| false | rejected | Deploy seams ran against stubbed Docker, not containers: the plan forbids the VMs and the Limits section says so. |
| false | rejected | Test files changed although the spike "changes no product code": the plan's Boundaries keep reproduction tests. |
| false | rejected | Follow-ups are proposals, not tickets: the plan's Never forbids writing tickets in the spike. |
| low | rejected | `it.fails` passes on any failure: a known limit the findings already state; each fix story checks the failure reason first. |
| low | rejected | Paths with `|` or `&` break the S11d sed rewrite: mkdtemp paths never contain them. |

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean (kept reproduction tests compile)
- `pnpm test` -- expected: no new failures; kept reproduction tests are skipped or `it.fails`

**Results (macOS, 2026-10-03):** `pnpm lint` clean (the 7 warnings already there at baseline); `pnpm typecheck` clean; `pnpm test`: 944 passed, 6 expected fail (the kept `it.fails`; 7 after the review fixes, as S11c now checks both compose files, and one more passing test, the S11b control), 1 skipped, 14 failed, all failing the same way at the baseline (13 deploy tests needing GNU `sed`, and the `backup.test.ts` restic-timeout test).
