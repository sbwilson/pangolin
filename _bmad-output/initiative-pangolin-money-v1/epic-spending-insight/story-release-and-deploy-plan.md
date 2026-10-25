---
title: 'Release v0.2.5 and deploy'
type: 'chore'
ticket: '12'
created: '2026-10-25'
status: complete
baseline_revision: '094174981642ecdd2da7b2dadb0af4d47ad790d7'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/docs/install.md'
  - '{project-root}/docs/release-v0.2.4.md'
  - '{project-root}/.github/workflows/release.yml'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 4 (spending and cash-flow insight) is complete on `develop` but not released or deployed to the home server (`pang-dev`), and the landing redirect to `/cash-flow`, reports, and net-worth experience need verification on a real host with green CI on the release tag.

**Approach:** Prepare `docs/release-v0.2.5.md` from the proven v0.2.4 template (pre-flight, release notes, real-data dry run, 13-step human checklist, empty evidence record), resolve any CI / e2e flakiness in develop pre-flight, and support the human through tagging `v0.2.5`, running manual backup, `pangolin upgrade v0.2.5`, and verifying `/cash-flow` and `/healthz`.

## Boundaries & Constraints

**Always:**
- Release only a commit whose CI is green on GitHub Actions, including `Container and end-to-end`, and which descends from `v0.2.4`.
- The `release.yml` run (`ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`) must be green on the tag before the upgrade.
- The manual `sudo pangolin backup` on `pang-dev` comes first and its snapshot ID is recorded before upgrading.
- The upgrade is `v0.2.4` to `v0.2.5`; database schema remains 21 (no new migrations in Epic 4); `pangolin status` afterwards must report `Schema: 21 (this build expects 21)`.
- A dry run of `pnpm check:upgrade` must be performed against a read-only copy of `pang-dev`'s database before tagging to confirm schema 21 consistency.
- A failed tag is deleted locally and remotely before retrying; a published tag is never reused.

**Never:**
- The agent does not push the tag, take backups, run `pangolin upgrade` on the server, or touch the home server.
- No schema change, no `package.json` version bump, no CHANGELOG file, no develop build on `pang-dev`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Real-data check | Read-only copy of `pang-dev` DB (schema 21) | `pnpm check:upgrade` reports schema 21 ok, integrity and manifest valid | Fix before tagging |
| Green release | Tag on CI-green commit descending from `v0.2.4` | All five jobs green in `release.yml`; container image published | Delete tag, fix, retag |
| Upgrade | `sudo pangolin upgrade v0.2.5` on `v0.2.4` host | Schema 21 of 21, `/healthz` ok, landing page redirects `/` to `/cash-flow` | Automatic rollback; record message |
| Starting build | `pangolin status` is not `v0.2.4` / schema 21 | Stop and record | Do not upgrade |

</frozen-after-approval>

## Code Map

- `docs/release-v0.2.5.md` -- Release page, pre-flight checks, release notes for Epic 4, 13-step checklist, and evidence tables (new).
- `docs/release-v0.2.4.md` -- Template and predecessor release reference.
- `docs/install.md` section 11 & `deploy/pangolin` -- Upgrade commands and health checks.
- `.github/workflows/release.yml`, `.github/workflows/ci.yml` -- Release and CI pipelines.
- `deploy/release-workflow.test.ts`, `deploy/release-scripts.test.ts` -- Release validation tests.
- `e2e/playwright.config.ts`, `e2e/routing.spec.ts` -- E2E test suite configuration, project ordering, and session handling.
- `e2e/cash-flow.spec.ts`, `e2e/spending.spec.ts`, `e2e/net-worth.spec.ts`, `e2e/spending-insight.spec.ts` -- Report spec timeline pinning and mobile auth stabilization.

## Tasks & Acceptance

**Execution:**
- [x] `docs/release-v0.2.5.md` -- Create release document -- Authored from v0.2.4 template tailored to Epic 4 features, schema 21, and checklist.
- [x] `e2e/playwright.config.ts`, `e2e/routing.spec.ts`, `e2e/cash-flow.spec.ts`, `e2e/spending.spec.ts`, `e2e/net-worth.spec.ts`, `e2e/spending-insight.spec.ts`, `e2e/axe.spec.ts` -- Pre-flight E2E stabilization -- Ensure test execution order, seeded date parameters, and session management pass cleanly in CI container job.
- [x] `git` pre-flight & CI check -- Verify ancestry and green CI -- Confirm HEAD descends from `v0.2.4` and all checks (`pnpm typecheck`, `pnpm lint`, `vitest`, `check-boundaries`) pass locally and on GitHub Actions push.
- [x] Human execution support -- Support checklist steps -- Assist human with `pnpm check:upgrade` dry run, tagging `v0.2.5`, watching release workflow, `pangolin upgrade v0.2.5`, and capturing output.
- [x] `docs/release-v0.2.5.md` -- Populate evidence record -- Fill in all evidence fields and decision records from human-pasted outputs.

**Acceptance Criteria:**
- Given the `v0.2.5` tag commit, CI on `develop` and all five jobs of `release.yml` on the tag pass.
- Given `pang-dev` after running `sudo pangolin upgrade v0.2.5`, `/healthz` returns 200, `pangolin status` reports `v0.2.5` and `Schema: 21 (this build expects 21)`, and navigating to `/` redirects to `/cash-flow`.
- Given `docs/release-v0.2.5.md`, every evidence field is populated with pasted output and the release is formally accepted by the human.

## Implementation Notes

- Created `docs/release-v0.2.5.md` tailored from `v0.2.4` for Epic 4 (Spending and cash-flow insight), including release notes, pre-flight verification, 13-step checklist, rollback plan, and structured evidence record.
- Added dedicated `reports` project in `e2e/playwright.config.ts` depending on `chromium` to guarantee reports specs run on a seeded ledger prior to `accounts` and `axe`.
- Pinned E2E browser time across `e2e/cash-flow.spec.ts`, `e2e/spending.spec.ts`, `e2e/net-worth.spec.ts`, and `e2e/spending-insight.spec.ts` to `2026-07-15T12:00:00Z` to anchor tests to the seeded date window.
- Isolated mobile sign-out in `e2e/routing.spec.ts` in its own browser context so `first-session.json` is not revoked for subsequent tests.
- Verified schema remains 21 (migrations 0000 to 0020).
- Ran all release tests (35 passing), ancestor check (`v0.2.4` is ancestor of HEAD), full typecheck, lint, boundary checks, and strict tables check.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 2 medium, 4 low patches; 0 deferred; 0 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | Zero-indexed month in Date constructor (`new Date(2026, 5, 15)`) pinned browser clock to June 15 rather than seed date July 15, 2026; patched to ISO `2026-07-15T12:00:00Z`. |
| medium | patch | Mobile sign-out test in `routing.spec.ts` revoked session on server while keeping `first-session.json` on disk, causing subsequent tests loading `alexSession` to fail authentication; patched to run in an isolated browser context. |
| low | patch | `net-worth.spec.ts` lacked clock pinning, risking date drift across month/quarter boundaries; patched to pin clock to `2026-07-15T12:00:00Z`. |
| low | patch | Remote upgrade snippet in `docs/release-v0.2.5.md` Step 8 referenced unset `$TAG` in clean SSH session; patched to explicitly export `TAG=v0.2.5`. |
| low | patch | Checklist and evidence record in `docs/release-v0.2.5.md` omitted `/` -> `/cash-flow` landing redirect verification on `pang-dev`; patched Step 9 and evidence table with curl check. |
| low | patch | Code Map and Tasks in plan omitted touched spec files; updated to track all modified e2e test files. |

## Verification

**Commands:**
- `pnpm exec vitest run deploy/release-workflow.test.ts deploy/release-scripts.test.ts` -- expected: all release tests pass.
- `git merge-base --is-ancestor v0.2.4 HEAD && echo ancestor-ok` -- expected: ancestor-ok.
- `pnpm typecheck && pnpm lint && node scripts/check-boundaries.ts` -- expected: zero errors.
