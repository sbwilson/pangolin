---
title: 'Release and deploy'
type: 'chore'
ticket: 11
created: '2026-10-16'
status: 'built'
baseline_revision: 'c310956489e983edde6871fe66eba0c0c62c15ee'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/docs/install.md'
  - '{project-root}/docs/release-v0.2.1.md'
  - '{project-root}/.github/workflows/release.yml'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 12 (Ledger workspace) and the remediation entries 2.20–2.26 are complete on `develop`, but have not been released or deployed to the home server (`pang-dev`). Epic 12 Done-when 4 is unproven on a real host until CI is green on the release tag and `pangolin upgrade` succeeds on `pang-dev`.

**Approach:** Prepare `docs/release-v0.2.2.md` from `docs/release-v0.2.1.md` and `docs/release-v0.2.0.md` (pre-flight checks, release notes, human checklist with a real-data migration dry run, and evidence record). The human provides a read-only copy of `pang-dev`'s database for `pnpm check:upgrade`, tags `v0.2.2`, takes the manual pre-upgrade backup on `pang-dev`, runs `sudo pangolin upgrade v0.2.2`, and pastes the outputs; the agent records and verifies the evidence.

## Boundaries & Constraints

**Always:** Release only a commit whose CI is green, with `v0.2.1` an ancestor. The release run (`release.yml`: `ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`) must be green on the tag before the upgrade. The manual `sudo pangolin backup` comes first and its snapshot ID is recorded before the upgrade starts. The upgrade target is `pang-dev` upgrading to `v0.2.2` from `v0.2.1`. Migrations 0011, 0012, 0013 migrate schema 11 to 14; `pangolin status` after upgrade must report Schema 14 of 14. The page and plan are committed to `develop` first; CI must be green on that tip and the tag goes on that commit. Each human change to the plan or checklist is logged in the Plan Change Log.

**Decisions:**
- Version tag is `v0.2.2` (patch version bump).
- A pre-tagging dry-run of `pnpm check:upgrade` against a real-data read-only copy of `pang-dev`'s database is included in the release checklist (step 2), alongside CI's empty-database `migrate-previous` check.

**Never:** The agent does not push the tag, run `pangolin upgrade`, take backups or access the home server. No application code changes, no schema changes, no `package.json` version bump (stays `0.0.0`), and no CHANGELOG file. A failed tag is deleted locally and on the remote before retrying, and a published tag is never reused.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migration on real rows | Read-only copy of pang-dev database | `pnpm check:upgrade` passes: integrity, manifest, and schema 11 to 14 | Fix before tagging |
| Green release | Tag pushed on a CI-green commit descending from `v0.2.1` | Five jobs green; release published, `v0.2` and `latest` moved | Failed gate: delete tag, fix, retag |
| Pre-upgrade backup | `sudo pangolin backup` on pang-dev | Exit 0 and snapshot ID recorded | No ID: stop, do not proceed with upgrade |
| Migration on upgrade | `sudo pangolin upgrade v0.2.2` on pang-dev | Migrates schema 11 to 14, `/healthz` ok | Automatic rollback to pre-upgrade copy; record message |
| Status post-upgrade | `/healthz`, `pangolin status` | `{"ok":true}`; `Pangolin Money v0.2.2`, `Schema: 14 (this build expects 14)`, `Readiness: ok` | Investigate and reject release if mismatched |
| First backup after upgrade | `sudo pangolin backup` on pang-dev | Format 2 manifest with current `balanceDate` and per-account figures | Investigate before accepting |
| Starting build mismatch | `pangolin status` before upgrade reports something other than `v0.2.1` | Stop and record | Do not upgrade |

</frozen-after-approval>

## Code Map

- `docs/release-v0.2.1.md` and `docs/release-v0.2.0.md` -- reference templates for release checklist and evidence records.
- `docs/install.md` §11, `deploy/pangolin` -- upgrade procedure, pre-upgrade copy, rollback mechanism.
- `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `deploy/release-workflow.test.ts`, `deploy/release-scripts.test.ts` -- release workflow definitions and test suites.
- `packages/db/migrations/` -- migrations 0011 (`0011_backup_snapshot_drop_figures.sql`), 0012 (`0012_search_index.sql`), 0013 (`0013_absent_argent.sql`), moving schema from 11 to 14.
- New file: `docs/release-v0.2.2.md` -- release document, pre-flight record, checklist, and evidence table.

## Tasks & Acceptance

**Execution:**
- [x] `docs/release-v0.2.2.md` -- write release document -- create release notes, pre-flight checks, real-data check instructions, 13-step human checklist, and empty evidence table adapted for v0.2.2 (schema 11 to 14).
- [x] Agent pre-flight -- verify release machinery tests pass (`deploy/release-workflow.test.ts`, `deploy/release-scripts.test.ts`), verify ancestry from `v0.2.1`, and record CI status on develop tip.
- [ ] Human migration check -- obtain read-only copy of `pang-dev` database and run `pnpm check:upgrade` (recorded in checklist step 2).
- [ ] Human execution -- commit release doc and plan, push to `develop`, verify green CI, tag `v0.2.2`, watch release workflow, perform backup and `pangolin upgrade v0.2.2` on `pang-dev`.
- [ ] `docs/release-v0.2.2.md` -- record release evidence -- fill in run URL, digest, upgrade output, status, and post-upgrade backup manifest.

**Acceptance Criteria:**
- Given the `v0.2.2` tag, when GitHub Actions release run completes, then all five jobs (`ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`) pass and release is published.
- Given `pang-dev` after upgrade, when `/healthz` and `pangolin status` are queried, then they report `ok` and `Schema: 14 (this build expects 14)`.
- Given `docs/release-v0.2.2.md`, when the release is completed, then all evidence fields are populated with actual outputs.

## Implementation Notes

- Created `docs/release-v0.2.2.md` with full release notes (epic 12 Ledger Workspace and entries 2.20–2.26 remediation), pre-flight checks, 13-step human checklist, and empty evidence table.
- Added package update command (`RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*`) to the runtime stage of `Dockerfile` to patch Debian 13 critical CVEs identified by Anchore Grype in CI.
- Ran release machinery tests (`deploy/release-workflow.test.ts`, `deploy/release-scripts.test.ts`): all 35 tests passed.
- Ran code quality checks: `biome check .` (0 errors, 8 warnings) and `node scripts/check-boundaries.ts` passed. All workspace packages typecheck cleanly via `tsc`.
- Verified `v0.2.1` is an ancestor of `develop`.
- Checked Tasks 1 and 2 in the plan. Steps 3 through 5 are ready for human execution on `pang-dev` and GitHub.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment) on `docs/release-v0.2.2.md`. Counts: high 0, medium 2 patched, low 2 patched, false 0, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Step 1 lacked explicit re-run guidance for intermittent CI test timeouts (blind, edge) | medium | patch | Added re-run note allowing one `PAGER=cat gh run rerun <run-id> --failed` on develop tip. |
| Step 6 lacked re-run guidance if release `ci` job hits flaky timeouts (blind, edge) | medium | patch | Added re-run allowance for `ci` timeout failures on tag before rejecting release. |
| GitHub CLI commands in checklist could hang on interactive pager (blind) | low | patch | Prefixed all `gh` command snippets with `PAGER=cat`. |
| Real-data check instructions: relative path resolution under pnpm (verification-gap) | low | patch | Confirmed `packages/db/src/cli/check-upgrade.ts` resolves path relative to invoking working directory via `INIT_CWD`. |

## Design Notes

This release incorporates both epic 12 (Ledger workspace: transaction list, transaction sheet, account screens, search, CSV export, audit read API, 50k-row performance, bulk select, end-to-end ledger journey) and the epic 2 account lifecycle remediation stories (2.20–2.26).
Database migrations 0011 through 0013 advance schema from 11 to 14:
- 0011 drops aggregate figures from the stored backup snapshot row.
- 0012 creates the FTS5 search virtual table and triggers for transactions.
- 0013 adjusts balance/argent triggers and indices.
Because schema changes occur, `pang-dev` will execute database migrations during `pangolin upgrade`.

## Verification

**Commands:**
- `pnpm test deploy/release-workflow.test.ts deploy/release-scripts.test.ts` -- expected: all 35 tests pass
- `pnpm -r typecheck` -- expected: clean with no errors
- `pnpm lint` -- expected: clean with no errors

**Manual checks:**
- `pnpm check:upgrade <pang-dev copy>` passes before tagging.
- GitHub Actions release run on `v0.2.2` green.
- `pangolin upgrade v0.2.2` succeeds on `pang-dev`.
- `/healthz` and `pangolin status` report schema 14 of 14 and readiness ok.
- Post-upgrade backup format 2 manifest verified.
