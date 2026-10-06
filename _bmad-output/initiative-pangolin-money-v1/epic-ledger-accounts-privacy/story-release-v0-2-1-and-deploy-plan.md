---
title: 'Release v0.2.1 and deploy'
type: 'chore'
ticket: '19'
created: '2026-10-06'
status: 'built'
baseline_revision: '84a66994371dcb4f7d4f99c4e5287a93b8a1a825'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/docs/install.md'
  - '{project-root}/docs/release-v0.2.0.md'
  - '{project-root}/.github/workflows/release.yml'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The privacy fixes of entries 14–18 (P1–P8, I1, I2, decision 80, the drill summary and the widened suite) exist only on `develop`; the home server (`pang-dev`) still runs `v0.2.0`, so CAP-16's release and upgrade path is unproven for them.

**Approach:** The agent prepares `docs/release-v0.2.1.md` from `docs/release-v0.2.0.md` (pre-flight, release notes, human checklist, evidence record). The human tags, takes the manual backup, runs `pangolin upgrade` from the `v0.2.0` tag and pastes the output; the agent fills the record from pasted output.

## Boundaries & Constraints

**Always:** Release only a commit whose CI is green, with `v0.2.0` an ancestor of it. The release run (`ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`) must be green on the tag before the upgrade. The manual `sudo pangolin backup` comes first and its snapshot ID is recorded before the upgrade starts; without it the upgrade does not run. The upgrade is `sudo pangolin upgrade v0.2.1` on a host reporting `v0.2.0`, never a develop build. Each human change to the plan or checklist is logged in the Plan Change Log. No field counts as filled without pasted output or a run URL. Schema stays 11 of 11: no migration lies between the tags. The page is committed to `develop` first; CI must be green on that tip and the tag goes on that tip (decision, 2026-10-06). The release notes carry a "Not fixed in this release" line naming the backup digest in unscoped audit rows (a partner can see that private data changed) and I4 (a soft-deleted payee keeps its name and logo), as decided 2026-10-06.

**Never:** The agent does not push the tag, run `pangolin upgrade`, take a backup or touch the server. No code, schema or CHANGELOG change, no `package.json` version bump, and no hardening or reconciliation work. A failed tag is deleted on the remote and locally before the next attempt, and a published tag is never reused.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Green release | Tag pushed on a CI-green commit that descends from `v0.2.0` | Five jobs green; release published, `latest` moved | Failed gate: delete the tag, fix, retag |
| Pre-upgrade backup | `sudo pangolin backup` on pang-dev | Exit 0 and a snapshot ID recorded | No ID: stop, no upgrade |
| Upgrade | `pangolin upgrade v0.2.1` from v0.2.0 | Signature verified, pre-upgrade copy made, schema 11 of 11, healthy | Automatic rollback; record the message |
| Status | `/healthz`, `pangolin status` | `{"ok":true…}`; `Pangolin Money v0.2.1`, `Schema: 11`, `Readiness: ok` | Reject the release |
| Backup after upgrade | `pangolin backup`, read the manifest | Format 2, current `balanceDate` | Investigate before accepting |
| Wrong starting build | `pangolin status` before the upgrade shows other than v0.2.0 | Stop and record it | Do not upgrade |

</frozen-after-approval>

## Code Map

- `docs/release-v0.2.0.md` -- the template: Rules, Pre-flight, 13-step checklist, rollback, evidence table. Carry it over; change the tag, versions, candidate and notes. Drop the schema 8-to-11 and format-1 restore steps (done at v0.2.0; no migration since). Make the manual backup a gate (v0.2.0's record notes it was skipped).
- `docs/install.md` §11, `deploy/pangolin` -- upgrade, pre-upgrade copy, rollback, `PANGOLIN_UPGRADE_TIMEOUT`. Unchanged.
- `.github/workflows/release.yml`, `.github/scripts/*`, `deploy/release-workflow.test.ts`, `deploy/release-scripts.test.ts` -- the release machinery; pre-flight runs the two tests.
- Changes since `v0.2.0` (`git log v0.2.0..develop`): stories 2.14–2.18 plus docs commits. `packages/db/migrations` ends at `0010`, no diff since the tag.
- `story-release-and-deploy-plan.md` -- the v0.2.0 plan; same agent/human split.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- deferrals that stay unfixed in v0.2.1.
- New: `docs/release-v0.2.1.md`.

## Tasks & Acceptance

**Execution:**
- [ ] Agent: confirm CI is green on the candidate, `v0.2.0` is its ancestor and `origin/develop` has not moved; run the two release-machinery tests; record in Pre-flight
- [ ] Agent: write `docs/release-v0.2.1.md` -- release notes (the privacy fixes by behaviour, no schema change, drill and check summaries now name only the failed check), checklist with who does each step, empty evidence record
- [ ] Human: confirm pang-dev reports `v0.2.0`; `sudo pangolin backup` and paste the snapshot ID
- [ ] Human: tag and push; the agent watches the run; human records the image digest
- [ ] Human: `sudo PANGOLIN_UPGRADE_TIMEOUT=<n> pangolin upgrade v0.2.1`; paste output, `/healthz`, `pangolin status`
- [ ] Human, agent: first backup after the upgrade, manifest read; fill the record; accept or reject

**Acceptance Criteria:**
- Given the tag, when the release run completes, then all five jobs are green and the release is published.
- Given pang-dev after the upgrade, when `/healthz` and `pangolin status` are read, then they report ok, `v0.2.1` and schema 11 of 11, upgraded from the `v0.2.0` tag.
- Given the evidence record, when read, then it names the deployed build, the pre-upgrade snapshot ID and the run URL, each from pasted output.

## Implementation Notes

- 2026-10-06, agent: wrote `docs/release-v0.2.1.md` (committed on the local `develop` with this plan file, not pushed; the human pushes it per step 1). Pre-flight run on base `84a6699`: `v0.2.0` is an ancestor, `origin/develop` unmoved, no migration or `package.json` diff since the tag, the two release-machinery tests pass (35), `pnpm lint` has no errors (8 pre-existing warnings).
- CI on the base is **not green**: run 37393717950 failed on 6 five-second timeouts (`apps/server/src/demo.test.ts`, `apps/server/src/admin/seed.test.ts`); the same files pass locally. Recorded in the page's Pre-flight and evidence record. The tag commit needs its own green run before tagging; re-run or timeout fix is the human's call (no code change is allowed here).
- The page drops the v0.2.0 schema 8-to-11 real-data step and the format-1 restore, adds a step 2 (starting build) and makes step 3 (manual backup) a gate.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment) on `docs/release-v0.2.1.md`. Counts: high 0, medium 3, low 9, false 5, maybe-false 0. verification-gap found no gap.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Step 4 tags whatever `HEAD` is after `git pull`, not the commit CI validated (blind, edge) | medium | patch | If `develop` moves after step 1 the tag lands on an unvalidated commit. Tag the explicit hash from step 1. |
| Step 1 says the human commits the page, but this build's commit already holds it and the plan; the plan file would otherwise dangle (blind, edge, intent) | medium | patch | The page contradicts the workflow. Rewrite step 1 as push-and-confirm-CI, with an exact `--commit` lookup. |
| Retry rule has no re-run path; the release `ci` job runs the same flaky tests, so tag churn is likely (blind) | medium | patch | Pre-flight 1 shows intermittent 5000 ms timeouts on `develop`. Allow one `gh run rerun --failed` on the same tag, recorded; other failures delete the tag. |
| "No release and no tagged image" on a failed run is unchecked before retagging (blind, edge) | low | patch | `publish` creates the image tag with `imagetools create`; a failure after it leaves a tag. Require `gh release view` and `imagetools inspect` to fail before a retag. |
| Step 5 lists the latest run without matching its commit (edge) | low | patch | Use `--branch "$TAG"` and require `headSha` to equal the tag commit. |
| Step 7 contradicts itself on the timeout; no status re-check before upgrading; digest not tied to step 6 (blind, edge) | low | patch | Direct wording and one added check each. |
| "No new setting" is backed only by the migrations diff (blind) | low | patch | Verified now: `git diff v0.2.0 HEAD` over `deploy`, `.github`, `docs/install.md`, `config.ts`, `package.json` and the lockfile is empty. Added to Pre-flight. |
| Household figures are asked into a committed page (blind) | low | patch | Default to `format`, `balanceDate` and an account count. |
| Notes: drill summary also stores the short snapshot id; `balanceDate` claim reads as a runtime refusal; old rows are not rewritten (blind, edge) | low | patch | Reword the two lines; add the not-rewritten note, backed by the v0.2.0 record (no ledger accounts). |
| Evidence record lacks rows for re-runs, the pre-upgrade copy path and the verified digest (blind) | low | patch | Three rows added. |
| No smoke test that the privacy fixes are live; no downgrade command; `.env` or manifest path assumptions; `balanceDate` day boundary (blind, edge) | low | rejected | Beyond the plan's checks: the fixes are tested, the downgrade and restic invocations are carried over from the v0.2.0 page, and the human flags any difference. |
| Pre-flight CI evidence is for the base, not the tag commit (intent) | false | rejected | The page says so and records the tag commit's run at step 1. |
| Intent audit R4(b): run the CLI from a v0.2.0 checkout (intent) | false | rejected | The intent says upgrade from the `v0.2.0` tag, which is the host's current build; the CLI is the one installed there. |
| Notes claim a `propertyId` refusal not in the intent's list (intent) | false | rejected | Story 2.16 added it (its plan, Code Map `set-splits.ts`); it is in the epic's remediation. |
| Page links to an untracked plan file and a decision not in the diff (intent) | false | rejected | The plan and its decisions are committed in the same build commit. |
| Dropped v0.2.0 checks rest on the no-migration claim only (intent) | false | rejected | The claim is checked by an empty migrations diff and an empty deploy, config and lockfile diff. |

## Design Notes

The v0.2.0 tag sat on a branch commit that never reached `develop`. This time the tagged commit is on `develop` and descends from `v0.2.0`, so `git describe` and the release notes' compare range are honest.

## Verification

**Commands:**
- `pnpm exec vitest run deploy/release-workflow.test.ts deploy/release-scripts.test.ts` -- expected: pass
- `git merge-base --is-ancestor v0.2.0 origin/develop` -- expected: exit 0
- `pnpm lint` -- expected: clean (the page is Markdown; nothing else changes)

**Manual checks (human):**
- Release run green on the tag; `pangolin upgrade` output; `/healthz`; `pangolin status`; first backup's manifest.
