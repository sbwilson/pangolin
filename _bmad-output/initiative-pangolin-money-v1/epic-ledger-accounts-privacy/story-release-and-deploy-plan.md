---
title: 'Release and deploy'
type: 'chore'
ticket: '12'
created: '2026-10-05'
status: 'in-progress'
baseline_revision: '93a3f19a7b0d42b9b1208af7e2753d65f057f204'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/install.md'
  - '{project-root}/.github/workflows/release.yml'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The epic's server core (schema 11, the privacy path, the backup manifest with per-account balances) exists only on `develop`; it has not been released or run on the home server, so epic Done when 4 and 5 are unproven on a real host.

**Approach:** Prepare the release (pre-flight checks, notes, a human checklist and an evidence record), then the human cuts the tag and runs `pangolin upgrade` on the home server while the agent records the evidence. The agent never pushes the tag or touches the server.

## Boundaries & Constraints

**Always:** Release only a commit whose CI is green; the candidate is `develop` at `93a3f19` (CI run #80 green). The tag is the version (no version file, `package.json` stays 0.0.0); the tag format is `v*.*.*`. The release run (`release.yml`: ci, image, upgrade-test, migrate-previous, publish) must be green on the tag before the upgrade. The home server is `pang-dev` (accepted 2026-10-02). The human takes a manual `pangolin backup` first, then runs `sudo pangolin upgrade <tag>`, with `PANGOLIN_UPGRADE_TIMEOUT` raised if the database is large; the pre-upgrade copy and the automatic rollback are the recovery. Evidence is recorded in a structured record in the repo (like `docs/m0-gate-rehearsal.md`): the release run URL with all five jobs green and `publish` done, the upgrade command output, `/healthz` ok, `pangolin status` showing the tag with schema 11 of 11, the signed image digest, and the first backup after the upgrade showing manifest format 2 with per-account counts, sums and `balanceAsOf`. Nothing the release needs is left to memory: the checklist names who does each step.

**Decisions:** The version is `v0.2.0`. Besides CI's `migrate-previous` over an empty database, `pnpm check:upgrade` is also run on a read-only copy of pang-dev's real database, which the human provides before tagging. Format-1 restore is proven on pang-dev: after the upgrade the human restores an existing format-1 backup to a scratch location and the result is recorded. Release notes are GitHub's generated notes plus a few hand-written lines in `docs/release-v0.2.0.md`.

**Never:** The agent does not push the tag, run `pangolin upgrade`, or change the home server. No new feature or schema change, no CHANGELOG file (GitHub generates the notes), no mixing in the hardening epic's outstanding items (uninstall and reinstall, resolver change) or the spec and spine reconciliation. A failed tag is deleted on the remote and locally before the next attempt.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Green release | Tag pushed on the candidate commit | All five release jobs green; `publish` creates the release and moves `latest` | A failed gate tags nothing; delete the tag and fix |
| Upgrade | `sudo pangolin upgrade <tag>` on pang-dev | Signature verified, pre-upgrade copy made, schema 8 to 11 migrated, `/healthz` ok | Automatic rollback to the previous image and copy |
| Migration on real rows | A copy of pang-dev's database with the candidate's migrations | `pnpm check:upgrade` passes: integrity, manifest, schema | Fix before tagging |
| First backup | Backup after the upgrade | Manifest format 2 with per-account counts, sums, `balanceAsOf` | Investigate before accepting the release |
| Old backup | A format-1 backup restored to a scratch location | Restores | Investigate before accepting the release |
| Slow migration | Large database | Upgrade waits up to `PANGOLIN_UPGRADE_TIMEOUT` | Rollback if unhealthy in time |

</frozen-after-approval>

## Code Map

- `.github/workflows/release.yml`, `.github/scripts/{previous-db.sh,previous-release.sh,release-tags.sh}` -- the release run; `migrate-previous` uses an empty previous database.
- `docs/install.md` section 11 (lines ~581-616), `deploy/pangolin` -- the upgrade procedure, pre-upgrade copy, rollback, `PANGOLIN_UPGRADE_TIMEOUT`.
- `deploy/release-workflow.test.ts`, `release-scripts.test.ts` -- tests that cover the release machinery.
- `packages/db/src/manifest.ts`, `manifest.test.ts`, `apps/server/src/backup/snapshot.test.ts` -- manifest format 2 and the format-1 reads.
- `docs/m0-gate-rehearsal.md` -- the shape of an evidence record.
- `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md` -- the dev-VM run lessons and open items.
- New: `docs/release-v0.2.0.md` (the checklist and evidence record, filled in as steps complete).

## Tasks & Acceptance

**Execution:**
- [ ] Agent: confirm CI is green on the exact release commit and that the release machinery tests pass
- [ ] Agent: run `pnpm check:upgrade` against a v0.1.2 database (empty from `previous-db.sh`; real copy of pang-dev's database if the human provides one)
- [ ] Agent: write `docs/release-v0.2.0.md` with release notes, the human checklist and an empty evidence record
- [ ] Human: tag the release commit and push the tag; the agent watches the release run
- [ ] Human: manual backup, then `sudo pangolin upgrade <tag>` on pang-dev
- [ ] Agent and human: fill the evidence record (run URL, upgrade output, healthz, status, digest, first backup's manifest, format-1 restore if chosen)

**Acceptance Criteria:**
- Given the tag, when the release run completes, then all five jobs are green and the release is published.
- Given pang-dev after the upgrade, when `/healthz` and `pangolin status` are read, then they report ok and the new tag with schema 11 of 11.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Migrations 0009 and 0010 rebuild `split`, `transaction` and `review_item` (INSERT SELECT, DROP, RENAME); existing transactions get `fingerprint = id` and `fingerprint_version = 0`. CI's `migrate-previous` exercises an empty first-boot database only, so a copy of pang-dev's real rows is the only test with data.

## Verification

**Commands:**
- `pnpm test deploy/release-workflow.test.ts deploy/release-scripts.test.ts` -- expected: green
- `pnpm check:upgrade <v0.1.2 database>` -- expected: integrity, manifest and schema ok

**Manual checks:**
- Release run green on the tag; `pangolin upgrade` output; `/healthz`; `pangolin status`; first backup's manifest.

