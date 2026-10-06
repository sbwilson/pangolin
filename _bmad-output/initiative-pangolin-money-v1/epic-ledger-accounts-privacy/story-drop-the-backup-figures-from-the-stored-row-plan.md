---
title: 'Drop the backup figures from the stored row'
type: 'chore'
ticket: '21'
created: '2026-10-06'
status: 'built'
baseline_revision: '03d6fe3818d10c08af701a993f02db1cb827a925'
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

**Problem:** `backup_snapshot` stores `table_count`, `row_count` and `manifest_sha256` for the whole database, private rows included, and a successful drill's summary says `verified N tables, M rows`. They reach the partner through the unscoped audit row (`after` is the whole row) and `GET /api/system/backup`, so what the partner reads changes when only the other's private data changes (retro N3, Done when 1). Nothing reads the three fields back.

**Approach:** Drop the three columns and their CHECK with a migration, stop writing them everywhere, take the counts out of the success summary, and scrub the figures from the audit rows and verification summaries already stored. Simon decided on 2026-10-06 to drop the figures and to migrate.

## Boundaries & Constraints

**Always:** Migration `0011` rebuilds `backup_snapshot` (SQLite cannot drop columns named in the `backup_snapshot_counts` CHECK) with `id`, `taken_at`, `schema_version`, `push_job_id`, `restic_snapshot_id`, `pushed_at`, `created_at`, `updated_at`, the pushed CHECK and the `pushed_at` index, and keeps every row. In the same migration the three keys are removed from the `before` and `after` JSON of `audit_log` rows whose entity is `backup_snapshot`, and the ` and verified N tables, M rows` tail is removed from stored successful drill summaries in `backup_verification`. The restic snapshot ID stays readable (Simon: people may need it to choose a backup to restore). `pnpm check:upgrade` migrates a v0.2.1 database from schema 11 to 12.

**Never:** change the manifest file's format or content (`manifest.ts`, `manifestSha256` the function, `writeSnapshot`'s return), `verifySnapshot` or `compareManifests`, or the operator paths' messages; touch entries 22 to 26's scope. No other schema change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upgrade | v0.2.1 database at schema 11 with `backup_snapshot` rows, their audit rows and verification rows | Schema 12; rows kept with the three columns gone; audit `before` and `after` of `backup_snapshot` rows hold none of the three keys; successful drill summaries read `restored snapshot <id>` and `verified` without figures | Migration failure rolls back as every migration does |
| Backup | Nightly or manual backup | Row recorded with `schema_version` only; push, `latestPushed`, `lastBackup` unchanged | none |
| Success drill | Drill passes | Summary `restored snapshot <8 hex> and verified the restore` | none |
| Restore | `pangolin restore` records the restored snapshot | Row recorded without the three fields | none |
| Failed drill | Unchanged from entry 17 | Names only the failed check | none |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/backup-snapshot.ts` -- remove `tableCount`, `rowCount`, `manifestSha256` and the `backup_snapshot_counts` check; then `pnpm --filter @pangolin/db db:generate` writes `packages/db/migrations/0011_*.sql`, `meta/0011_snapshot.json` and the `_journal.json` entry (as 0010 did, with `__new_` table, `INSERT SELECT`, drop, rename). Append the audit and summary scrub statements to the generated SQL (no triggers guard `audit_log`).
- `packages/app/src/ports/unit-of-work.ts:142-145` (`BackupSnapshotRow`), `packages/app/src/system/backups.ts:209-250` (`recordBackupSnapshotInput`, `recordBackupSnapshot`) -- drop the fields.
- `apps/server/src/backup/snapshot.ts:9-11,45-47` (`SnapshotSummary`, `isSummary`) and `snapshot-worker.ts:16-25` -- the summary keeps `schemaVersion`.
- `apps/server/src/admin/restore.ts:256-258` -- stop passing the three fields.
- `apps/server/src/jobs/backup.ts:205-207` -- success summary without counts; `packages/db/src/backup-snapshot-repo.ts` needs no change beyond types; `packages/app/src/testing/memory-uow.ts` mirrors the row.
- Tests that mention the fields: `packages/app/src/system/backups.test.ts`, `packages/db/src/backup-snapshot-repo.test.ts`, `migrate.test.ts`, `apps/server/src/cli.test.ts`, `http/app.test.ts`, `jobs/backup.test.ts`, `backup/snapshot.test.ts`, and the known-gap test and digest masking in `apps/server/src/privacy/privacy.test.ts` (`sansSnapshotIds`): this story closes that gap, so the known-gap test goes and the 64-hex digest mask goes; the snapshot-id mask stays; entry 22 adds the paired worlds that replace it.
- Do not change: the manifest code, `docs/release-v0.2.1.md`, `tx-repos-viewer.test.ts` (entry 22).

## Tasks & Acceptance

**Execution:**
- [ ] `schema/backup-snapshot.ts` and the generated `0011` migration with the audit and summary scrub
- [ ] `ports/unit-of-work.ts`, `system/backups.ts`, `memory-uow.ts`, `snapshot.ts`, `snapshot-worker.ts`, `restore.ts`, `jobs/backup.ts` -- stop carrying the figures
- [ ] a migration test: build a schema-11 database with rows (backup snapshot, its audit rows, a successful and a failed drill summary), migrate, assert the matrix row "Upgrade"
- [ ] update the tests listed above; remove the known-gap test and the digest mask

**Acceptance Criteria:**
- Given a v0.2.1 database, when `pnpm check:upgrade` runs on a copy, then it prints `migrated 11 -> 12` and integrity, manifest and schema pass.
- Given a backup, a push, a restore and a restore drill, when they run on the new schema, then they work and no stored row, audit row or summary holds a row or table count or a manifest digest.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 0, low 10, false 3, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| The migration test's `d{64}` matches 64 literal d characters, not a digest (blind, edge, VG) | low | patch | It passes only because the fixture digest is `"d".repeat(64)`; use a hex pattern and require any 64-hex string to be the restic id. |
| Migrated and new successful-drill summaries differ, and the new text holds the migration's own marker (blind, edge) | low | patch | Make the migration rewrite the tail to ` and verified the restore` so they are identical. |
| The summary rewrites have no kind or ok guard (edge) | low | patch | Restrict to successful drills; add failed-drill and check rows to the test. |
| The third UPDATE's `json_extract` could abort on malformed JSON (blind) | false | rejected | `audit_log` has a CHECK that `before` and `after` are valid JSON, so no row can hold malformed text; NULL gives NULL. |
| Audit rewrite of an append-only log is unexamined; no downgrade note (blind) | false | rejected | No trigger protects `audit_log` (grep of migrations); a migration is the only writer allowed to rewrite it, as the plan states; the upgrade's pre-upgrade copy is the rollback. |
| The raw digest code and `verdict.tables/rows` remain (blind) | false | rejected | The plan keeps `manifestSha256` the function and `writeSnapshot`'s return; `restore.ts` still prints the counts to the operator (the plan's Never). |
| Other entities might hold the figures (edge) | low | rejected | Checked by the verification lens: no other consumer; the migration test asserts an unrelated audit row is left alone. |
| `json_remove` re-serialises unaffected rows (edge) | low | rejected | Content is unchanged; a minified JSON string is harmless. |
| Test churn: hard-coded schema version 12 and `slice(0, 11)`; broad privacy regex; an idempotency test varies `schemaVersion` (blind) | low | rejected | The repo's existing pattern for every migration; the regex is scoped to four named sources. |
| The restic snapshot id stays readable and the known-gap record is gone (blind) | low | rejected | Accepted by Simon on 2026-10-06; the deferred-work entry gets a disposition line. |
| Intent audit: the figures remain in the pushed manifest and the operator restore output (intent) | low | rejected | Operator-side sinks; the plan's Never leaves them. |

## Design Notes

The scrub of old rows is part of the migration because a migration is the only place that may rewrite `audit_log` (nothing else updates it), and v0.2.1 on pang-dev already holds the figures in its audit rows. The `backup_verification.summary` tail is removed with a `substr` and `instr` on ` and verified `, which only a successful drill's summary contains.

## Verification

**Commands:**
- `pnpm --filter @pangolin/db db:generate` -- expected: one new migration `0011`, then `git status` shows only the intended files
- `pnpm vitest run packages apps` -- expected: pass; `pnpm lint` and `pnpm typecheck` -- expected: clean
- `pnpm check:upgrade <copy of a schema-11 database>` -- expected: `migrated 11 -> 12`
