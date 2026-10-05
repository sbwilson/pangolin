---
title: 'Backup manifest privacy'
type: 'bugfix'
ticket: '17'
created: '2026-10-06'
status: 'built'
baseline_revision: 'bfd0abbeaf3a0976f37cba302bfa0826ebcdd7d0'
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

**Problem:** A failed restore drill stores a summary built from `verdict.message` or `error.message`. For a manifest mismatch that text names private account IDs with transaction counts, sums and balances. It reaches `backup_verification.summary`, `GET /api/system/backup` and an unscoped audit row (retro P3). Separately, `buildManifest` and `writeSnapshot` default `balanceDate` to the UTC date, so a caller can forget the household clock (I7).

**Approach:** `jobs/backup.ts` stores, returns and audits a summary naming only the failed check kind. `verifySnapshot` and `compareManifests` keep their detailed messages for the operator paths. A discriminated option type makes `balanceDate` required for format 2.

## Boundaries & Constraints

**Always:** the detailed verdict message still reaches `admin/restore.ts` and `check-upgrade` unchanged. The format-1 rebuild in `verifySnapshot` still compiles and verifies old backups. Every format-2 caller passes a date: the household clock's `today()` on server paths, the UTC date in `check-upgrade` (decision 83).

**Never:** change `compareManifests` or `verifySnapshot` wording, `parseManifest`, or the manifest's JSON format. Do not log the dropped detail. Touch no file outside `packages/db/src/manifest.ts`, `apps/server/src/jobs/backup.ts`, `apps/server/src/backup/snapshot*`, `packages/db/src/cli/check-upgrade.ts` and their tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Drill, manifest mismatch | Private account's sum differs in the snapshot | Summary `the manifest check failed on snapshot <8 hex>`; no account ID, count or figure | Review item raised as before |
| Drill, restore throws | restic exits 1, or the snapshot is not a Pangolin backup | Summary `the restore check failed`; no restic text | As above |
| Drill, other verdicts | integrity or schema failure | `the integrity check failed on snapshot <8 hex>`, likewise `schema` | As above |
| Repository check fails | restic check exits non-zero | Summary `the repository check failed`; no restic text | As above |
| Operator restore | `verifySnapshot` returns a failing verdict | Detailed message unchanged | Unchanged |
| Format 2 without date | `buildManifest(db)` or `writeSnapshot(f, d)` | Does not type-check | Compile error |

</frozen-after-approval>

## Code Map

- `packages/db/src/manifest.ts` -- `BuildManifestOptions` (l.65) and `buildManifest` (l.158) default `balanceDate`; `verifySnapshot` rebuilds format 1 with `{ accounts: false }` (l.390); `writeSnapshot(dbFile, outDir, takenAt?, balanceDate?)` (l.437).
- `apps/server/src/jobs/backup.ts` -- `checkHandler` (l.156-161) and `drillHandler` (l.187-203) build the summaries from `error.message` and `verdict.message`; the snapshot handler already passes `ctx.clock.today().toString()`.
- `apps/server/src/backup/snapshot.ts` and `snapshot-worker.ts` -- `TakeSnapshotOptions.balanceDate` is optional; the worker calls `writeSnapshot` positionally.
- `packages/db/src/cli/check-upgrade.ts` -- `writeSnapshot(path, dir)` with no date (l.69).
- Tests: `packages/db/src/manifest.test.ts` (about 25 `buildManifest`/`writeSnapshot` calls), `apps/server/src/backup/snapshot.test.ts` (l.46), `apps/server/src/jobs/backup.test.ts` (l.422, 535, 547), `packages/db/src/cli/check-upgrade.test.ts` if present.
- Reuse: `SnapshotCheck` type. `packages/app/src/system/backups.ts` needs no change: the summary is stored and audited as given, and `/api/system/backup` returns what is stored.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db/src/manifest.ts` -- make `BuildManifestOptions` a union, `{ accounts: false } | { accounts?: true; balanceDate: string }`. Make `writeSnapshot` take `(dbFile, outDir, options: WriteSnapshotOptions)`, that union plus `takenAt?`. Drop the UTC default and its `new Date()` call. Update the doc comments -- required date for format 2.
- [ ] `apps/server/src/backup/snapshot.ts`, `snapshot-worker.ts` -- `balanceDate` becomes required; the worker passes an options object.
- [ ] `packages/db/src/cli/check-upgrade.ts` -- pass `balanceDate: new Date().toISOString().slice(0, 10)` with a comment naming decision 83.
- [ ] `apps/server/src/jobs/backup.ts` -- add a helper that maps a failed verdict or a thrown restore to `the <check> check failed`, with ` on snapshot <8 hex>` when a snapshot was fetched. Use it in the drill's verdict and catch paths. Set the check handler's failure summary to `the repository check failed`.
- [ ] Tests -- update call sites to the new signatures. Add: a type-level `@ts-expect-error` for format 2 without a date; a drill whose private-account sum differs, and one whose restore throws, store and return (`backupStatus`) summaries and an audit row with no account ID, digit run or `cents`; `verifySnapshot` still returns the detailed message; the check summary is kind-only. Update the assertions at `backup.test.ts` l.422, 535, 547.

**Acceptance Criteria:**
- Given a drill whose snapshot has a private account's sum altered, when it fails, then `backup_verification.summary`, `backupStatus().drill.summary` and the `audit_log` row contain no account ID, count or figure.
- Given `check-upgrade` runs, when it writes its snapshot, then it passes the UTC date and a failing check still prints the detailed message.
- Given any server path that writes a snapshot, when it runs, then it passes the household clock's `today()`.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 0, low 8, false 4, maybe-false 0. verification-gap found nothing.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Dropped check/drill detail is not logged (blind, edge) | low | rejected | Operator paths (`admin/restore.ts`, `check-upgrade`) keep the detail, as the story specifies. A log sink needs a logger on `BackupJobDeps`, which has none, so the fix adds surface for a rare event. Surfaced in the final report. |
| Existing rows are not scrubbed (blind) | false | rejected | Epic note 2026-10-05: the home server's manifest has an empty accounts section, so no stored summary carries account figures. |
| "restore" lumps unrelated causes (blind, edge) | low | rejected | The story asks for the failed check kind only; more categories need a taxonomy the plan does not settle. |
| Privacy test flaky on "777" in ULIDs or the hex prefix (blind, edge) | low | patch | Audit JSON holds random ULIDs and the 8-hex snapshot prefix; a chance "777" fails it. Fix is a direct edit of the test values. |
| Restore-failure test checks only "restic restore exited" in audit (edge) | low | patch | Other leaked text would pass; assert the exact summary in the audit row. |
| Type and test gaps: `String(balanceDate)`, `{accounts:true}` without date, check-upgrade test (blind) | low | rejected | `{accounts:false}` format 1 is covered at `manifest.test.ts` l.270; `check:upgrade` run exits 0; the rest is cosmetic. |
| `balanceDate` validated late, after `rmSync`/VACUUM, and accepts impossible dates (blind, edge) | low | defer | Pre-existing: the shape-only check in `buildManifest` is unchanged. Every caller passes the clock's `today()` or a `Date`, which cannot be malformed. |
| 500-char cap removed (blind) | false | rejected | `recordBackupVerificationInput` still caps `summary` at 500 and the summaries are fixed text. |
| Restore-throws drill has no private-account fixture (edge) | false | rejected | The summary is the fixed string `the restore check failed`, so it cannot carry an account ID; the test asserts it exactly. |
| Intent audit: tests assert `backupStatus`, not the HTTP route | false | rejected | The route returns `backupStatus(...)` unchanged; no surface differs. |
| Intent audit: `@ts-expect-error` needs typecheck over tests | false | rejected | `pnpm typecheck` ran clean with the directives consumed. |
| Intent audit: job path already passed the clock's `today()` | false | rejected | True, and not a defect; the story says to keep it. |

## Design Notes

The summary is fixed where it is stored, in `jobs/backup.ts`, so the status route and the audit row inherit it with no change to the use case. A stray `parseManifest` failure also surfaces as `manifest`, since `verifyFetched` maps it there.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors, and the `@ts-expect-error` is consumed
- `pnpm vitest run packages/db apps/server/src/backup apps/server/src/jobs/backup.test.ts` -- expected: pass
- `pnpm lint` -- expected: clean
- `pnpm check:upgrade` against a migrated database -- expected: exit 0
