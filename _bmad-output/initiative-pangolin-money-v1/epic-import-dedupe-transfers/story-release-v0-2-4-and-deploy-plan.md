---
title: 'Release v0.2.4 and deploy'
type: 'chore'
ticket: '11'
created: '2026-10-21'
status: 'ready-for-dev'
baseline_revision: 'e41b6d4f10c8098d3c888a1cbaed479cd7bb860b'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/install.md'
  - '{project-root}/docs/release-v0.2.3.md'
  - '{project-root}/.github/workflows/release.yml'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 3 (import, dedupe and transfer matching) is complete on `develop` but not released or deployed to the home server (`pang-dev`), and the M1 gate needs the new import, review and gate tooling on a real host.

**Approach:** Prepare `docs/release-v0.2.4.md` from the proven v0.2.3 template (pre-flight, release notes, real-data migration dry run, 13-step human checklist, empty evidence record). The human takes a read-only copy of `pang-dev`'s database for `pnpm check:upgrade`, tags `v0.2.4`, takes the manual pre-upgrade backup, runs `sudo pangolin upgrade v0.2.4` and pastes the outputs.

## Boundaries & Constraints

**Always:**
- Release only a commit whose CI is green, **including `Container and end-to-end`**, and which descends from `v0.2.3`.
- The `release.yml` run (`ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`) must be green on the tag before the upgrade.
- The manual `sudo pangolin backup` on `pang-dev` comes first and its snapshot ID is recorded.
- The upgrade is `v0.2.3` to `v0.2.4`; schema migrates 15 to 21 (migrations 0015 to 0020); `pangolin status` afterwards must report `Schema: 21 (this build expects 21)`.
- `pnpm check:upgrade` runs on a read-only copy of `pang-dev`'s real database before tagging (it exercises migration 0019's backfill).
- A failed tag is deleted locally and remotely before retrying; a published tag is never reused.

**Never:**
- The agent does not push the tag, take backups, run `pangolin upgrade` or touch the server.
- No schema change, no `package.json` version bump, no CHANGELOG file, no develop build on `pang-dev`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migrations on real rows | Read-only copy of pang-dev database | `migrated 15 -> 21; integrity, manifest, schema ok` | Fix before tagging |
| Green release | Tag on a CI-green commit descending from `v0.2.3` | Five jobs green; release published | Failed gate: delete tag, fix, retag |
| Upgrade | `sudo pangolin upgrade v0.2.4` on a `v0.2.3` host | Schema 21 of 21, `/healthz` ok | Automatic rollback; record message |
| Starting build | `pangolin status` is not `v0.2.3` / schema 15 | Stop and record | Do not upgrade |

</frozen-after-approval>

## Code Map

- `docs/release-v0.2.4.md` -- release page, pre-flight record, checklist and evidence table (new).
- `docs/release-v0.2.3.md`, `docs/install.md` section 11, `deploy/pangolin` -- template and upgrade procedure.
- `.github/workflows/release.yml`, `ci.yml`, `deploy/release-workflow.test.ts`, `deploy/release-scripts.test.ts` -- release machinery.
- `packages/db/migrations/0015` to `0020` -- schema 15 to 21.
- `e2e/import.spec.ts`, `e2e/review.spec.ts` -- fixed in `e41b6d4` (duplicate CSP guard registration).

## Tasks & Acceptance

**Execution:**
- [x] `docs/release-v0.2.4.md` -- written from the v0.2.3 template.
- [x] Agent pre-flight -- ancestry, release machinery tests, lint, types, tests; CI red on `391d9e4`..`db68f5d` diagnosed and fixed in `e41b6d4`.
- [ ] Human -- CI green on the tag commit, real-data `check:upgrade`, `pangolin status` is `v0.2.3`, manual backup, tag, release run, upgrade, healthz, status, first backup.
- [ ] `docs/release-v0.2.4.md` -- evidence record filled from pasted output.

**Acceptance Criteria:**
- Given the `v0.2.4` tag, when the release run completes, then all five jobs pass.
- Given `pang-dev` after the upgrade, when `/healthz` and `pangolin status` run, then they report ok and `Schema: 21 (this build expects 21)`.
- Given the release page, when the release is accepted, then every evidence field holds pasted output.

## Implementation Notes

The release page was generated from `docs/release-v0.2.3.md` with version and schema numbers changed, new release notes and a new pre-flight section.

## Plan Change Log

## Review Triage Log

## Design Notes

None.

## Verification

**Commands:**
- `npx vitest run deploy/release-workflow.test.ts deploy/release-scripts.test.ts` -- expected: pass.
