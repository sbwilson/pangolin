---
title: 'Backup status in the privacy suite'
type: 'chore'
ticket: '22'
created: '2026-10-06'
status: 'built'
baseline_revision: '513085a6090b3a1789031ad8c7d44c42b087112b'
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

**Problem:** After entry 21 dropped the whole-database figures, the privacy suite pins only a failed drill in worlds whose private account differs in an amount, never in a row count, and never after a successful drill. A figure put back (a count in a success summary, a digest in an audit row) would pass, and `tx-repos-viewer.test.ts` still calls the backup repositories "no ledger data" with no reasoning (retro N3, V2).

**Approach:** Build the drill world so it can end in a pass or a fail and so its private account holds a different number of rows per flavour; compare what partner B reads in paired worlds for both outcomes; correct the repository reasons.

## Boundaries & Constraints

**Always:** the restic snapshot id stays readable by decision (Simon, 2026-10-06: people may need it to choose which backup to restore), so the suite masks it by name as an accepted exposure and says so; every other byte B reads from `GET /api/system/backup`, the backup audit rows (through the `listAudit` use case and raw `audit_log`, as today), the stored rows, the verdicts and the review items must match between the two worlds; the suite fails when a count or digest is put back in the success summary or an audit row; the reasons for `backups` and `backupVerifications` in `packages/app/src/ports/tx-repos-viewer.test.ts` say what is stored and that it holds no figure of the household's data.

**Never:** change product code, the migration, or the failed-drill assertions of entry 17; add an audit HTTP route (it stays pending for epic 12 entries 6 and 7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Passed drill | Two worlds whose private account holds 1 and 5 transactions of different amounts; backup, then a drill that passes | B's `/api/system/backup`, backup audit rows, stored rows, verdicts and review items equal after masking restic ids; the summary reads `restored snapshot <id> and verified the restore` | Differential reports the keys that differ |
| Failed drill | As today, now with differing row counts too | Equal as above; summary names only the failed check | As above |
| Backup only | Backup with no drill | `/api/system/backup` and backup audit rows equal | As above |
| Figure put back | A count in the success summary, or the digest in a `backup_snapshot` audit row | The paired test and the no-figures test fail | A deliberate-leak case proves it |

</frozen-after-approval>

## Code Map

- `apps/server/src/privacy/privacy-harness.ts:~806-860` -- `DrillWorld` and `failedDrillWorld(seed, flavour, dir, viewer)`: a private account with one transaction (`DRILL_AMOUNTS`), then tampers the stored copy and runs the drill. Generalise it to take an outcome (`passed` skips the tamper) and a per-flavour number of private transactions; keep `failedDrillWorld` working for the entry 17 tests or replace its callers.
- `apps/server/src/privacy/privacy.test.ts:1145-1260` -- `describe("a failed restore drill")`: `sansSnapshotIds`, `drillView`, the paired comparison and the no-figures test; add a passed-drill describe and a backup-only comparison on the same helpers; add a deliberate-leak case (the file already has a leaky-world group, `leakyWorld` in the harness, `privacy.test.ts:~694`).
- `apps/server/src/testing/backup-drill.ts` -- `createDrillRig` (`backUp`, `run`, `storedDatabase`); reuse.
- `packages/app/src/ports/tx-repos-viewer.test.ts:~40-41` -- `UNSCOPED_REPOS` reasons for `backups` and `backupVerifications`.
- Do not change: `apps/server/src/jobs/backup.ts`, `packages/app/src/system/backups.ts`, migrations.

## Tasks & Acceptance

**Execution:**
- [ ] `privacy-harness.ts` -- outcome and private row count options on the drill world
- [ ] `privacy.test.ts` -- passed-drill and backup-only paired worlds on the existing helpers; success-summary assertion; a deliberate-leak case that puts a figure back through a stand-in world and is caught
- [ ] `tx-repos-viewer.test.ts` -- corrected reasons

**Acceptance Criteria:**
- Given two worlds whose private accounts hold different numbers of transactions, when a backup, a passed drill and a failed drill have run in each, then B's reads match after the restic id is masked.
- Given a count or digest put back, when the suite runs, then it fails.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 0, low 8 patched, 12 rejected, false 0. The verification lens mutated the real product (the success summary printed counts again) and five of the new tests failed, so the suite does guard the behaviour.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `VERDICT_SUMMARIES` accepts any word in `the \w+ check failed`, so `the 42 check failed` passes (blind, edge) | low | patch | The guard should fail closed; enumerate the check names and the hex suffix. |
| An older test checks only the first private amount while world two holds five (VG other) | low | patch | Derive the figures from the world. |
| Empty restic id would mask everywhere; unguarded `pairs.get`; garbled describe title; repeated timeout constant; `dir` contract wording; a name in a comment (blind, edge) | low | patch | Small direct fixes. |
| Leak tests only cover the passed outcome and two leak shapes; digest shapes other than 64 hex; key regex is a deny-list (blind, edge) | low | rejected | The paired comparison catches a figure that differs between worlds in any shape; the key and fixed-word checks catch constant ones; the mutation run on the real product shows the real path is caught. |
| The leak is a stand-in written after the product ran, and the compared surface includes raw SQL beyond B's reads (intent) | low | rejected | The mutation run covers the product path; comparing the raw rows is stricter than B's reads by design. |
| Id and clock collisions with the world's generator; leaky worlds in the shared `worlds` array; serial builds; the check job is not exercised; the reasons are descriptive only (blind, edge, VG) | low | rejected | The suite passes with the separate id range; the array is used for closing; the jobs test pins the check summary; reasons in that file have always been prose. |

## Design Notes

The deliberate-leak case follows the file's own pattern (`leakyWorld`): a world that adds a figure to what B reads, and the same assertion function reports it.

## Verification

**Commands:**
- `pnpm vitest run apps/server/src/privacy packages/app/src/ports` -- expected: pass
- `pnpm lint` and `pnpm typecheck` -- expected: clean
