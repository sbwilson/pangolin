---
title: 'Batch undo and account freshness'
type: 'feature'
ticket: 7
created: '2026-10-21'
baseline_revision: '187f748ff0ad2e6a0f31307b5868c4e736889b79'
status: done
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/import-pipeline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A wrong import cannot be reversed as a unit, and the Accounts list judges freshness by the newest transaction date, so it cannot say when or from what an account was last imported.

**Approach:** Record who imported each batch and when it was undone (migration 0018), add an `undoImportBatch` use case that soft-deletes the batch's transactions through the same rules as `deleteTransaction`, and derive each account's freshness and provenance from its non-undone batches instead of `posted_on`.

## Boundaries & Constraints

**Always:**
- Only the person who imported a batch, with recent re-authentication, may undo it; anyone else, or a batch whose account they cannot see, gets `NotFound`. A batch with no recorded importer cannot be undone (`Conflict`).
- Undo is all-or-nothing in one `write`: every live transaction with `import_id = batch` is soft-deleted, open review items on it and the batch's `import.set_aside` item are resolved, and a transfer survivor is unlinked (including one in another person's private account, via the upkeep read), each audited as `deleteTransaction` does.
- Refuse the whole undo (`Conflict`) when any row sits after its account's `closedOn` (`requireEntryOpen`).
- Undo sets `undone_at`; the batch row stays. Re-importing the same file stays blocked (AD-20: the file hash and soft-deleted fingerprints still count).
- Freshness is the newest `posted_on` among live transactions of the account's non-undone committed batches, with the newest such batch's `source` and `created_at` as provenance; an account with none reports `null`.
- `latestPostedOn` stays for the closed-account lock.

**Never:**
- No hand-off changes (a hand-off stays `imported`; the sender learns nothing new), no UI beyond the Accounts page's freshness line, no undo route or button, no re-import after undo, no hard delete.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Undo | Importer undoes a committed batch of 5 rows | 5 transactions soft-deleted; review items resolved; `undone_at` set | No error |
| Transfer survivor | A batch row linked to a row in another account | Survivor unlinked, group deleted | No error |
| Not the importer | Another person undoes | Nothing written | `NotFound` |
| Stale auth | Importer's last auth is old | Nothing written | `requireRecentAuth` error |
| Twice | Undo an undone batch | Nothing written | `Conflict` |
| Closed account | A row is dated after `closedOn` | Nothing written | `Conflict` |
| Re-import | Same file after undo | Zero new rows | No error |
| Freshness | Two batches, newest undone | Freshness and provenance come from the older batch | n/a |
| No imports | Account with only manual entries | `lastImport: null` | n/a |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/import-batch.ts`, `migrations/0018_*.sql` (+ journal and `meta/0018_snapshot.json`), `migrate.test.ts` -- nullable `imported_by_person_id` (FK person) and `undone_at`; schema version bump in `migrate.test.ts` and `system-health-repo.test.ts` as 0017 did.
- `packages/app/src/ports/unit-of-work.ts` (`ImportBatchRow`, `ImportBatchRepo`), `packages/db/src/repositories/import-repos.ts`, `packages/app/src/testing/memory-uow.ts` -- new fields; `markUndone(id, at)`; `listLiveTransactionIds(batchId)` via `transaction.import_id`; `latestImportFor(accountId)` for freshness.
- `packages/app/src/imports/import-statement.ts` -- stamp `importedByPersonId` from the viewer (null for system).
- `packages/app/src/ledger/delete-transaction.ts` -- extract the per-row body (soft delete, review resolution, transfer unlink, audit, closing balance) into a shared helper; do not change its behaviour.
- `packages/app/src/imports/undo-batch.ts` -- new `undoImportBatch`; `identity/reauth.ts` `requireRecentAuth`; `closed-lock.ts` `requireEntryOpen`; `system/review-items.ts` resolvers.
- `packages/app/src/accounts/list-accounts.ts`, `pool.ts` -- `AccountView.lastImport {through, source, importedAt} | null`; keep `newestPostedOn` only where the lock needs it.
- `apps/web/src/api.ts`, `lib/freshness.ts`, `pages/AccountsPage.tsx` and their tests -- show "imported up to <date> from <source>, <time>" and stale after 45 days of `through`.
- Parity: `packages/app/src/testing/accounts-parity.test.ts`, `repo-parity.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] Migration 0018, schema, snapshot, version bumps -- new columns.
- [ ] Port, db repo, memory repo, parity tests -- undo and freshness queries.
- [ ] `import-statement.ts`, `delete-transaction.ts` helper, `undo-batch.ts`, exports -- the use case.
- [ ] `list-accounts.ts`, `pool.ts`, web api/freshness/AccountsPage -- freshness and provenance.
- [ ] Tests -- one per matrix row; web tests for the new label and stale rule.

**Acceptance Criteria:**
- Given an undone batch, when reading the ledger and review inbox, then none of its transactions, links or open items remain, and totals match the pre-import state.
- Given an account whose newest batch is undone, when the Accounts list loads, then freshness reflects the previous batch.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- Undo never audits the batch-level change (blind, gap) -- verdict: medium -- route: patch -- `undone_at` has no actor trail when a batch has no live rows; audit an `import_batch` update.
- `importedByPersonId` and undo only verified on the memory UoW (gap) -- verdict: medium -- route: patch -- a SQLite insert that dropped the column would make every undo `Conflict` with tests green; add a round-trip and a SQLite-backed import-then-undo; restore a non-null `lastImport` assertion with explicit values in the accounts parity test (blind: assertion was weakened).
- Hand-off importer attribution untested (gap) -- verdict: medium -- route: patch -- assert the recipient is stamped and the sender cannot undo.
- Undo of a non-committed batch untested (gap) -- verdict: low -- route: patch -- one-line test.
- e2e `reduce` without a seed on an empty list (edge, blind) -- verdict: low -- route: patch -- throws TypeError when the first account has no transactions.
- Orphaned doc comment on `LastImport` in `api.ts` (blind) -- verdict: low -- route: patch -- direct correction.
- Batch-level review items other than set-aside left open (edge) -- verdict: false -- per-transaction items are resolved by `softDeleteTransactionRow`; the set-aside item is resolved explicitly.
- Both transfer legs in one batch untested (gap) -- verdict: false -- `matchTransfersForBatch` excludes the batch's own account, so a batch cannot hold both legs.
- Null importer returns Conflict before NotFound (blind, edge) -- verdict: false -- the plan's rule is Conflict for a batch with no recorded importer.
- Rows moved to another account, NaN/month guards in `freshness.ts`, silent continue in the delete loop (edge) -- verdict: low -- route: reject -- not reachable in current code; fix adds guards.
- Mixed provenance pairing, time without date, raw `source` id, per-account query cost, missing index/CHECK/backfill, viewer-less repo methods, undo size guard (blind) -- verdict: low -- route: reject -- matches UX copy or plan, or is polish for the UI story.
- Pre-0018 batches un-undoable, no undo route/UI (blind, intent) -- verdict: false -- stated in the plan's Design Notes and Never list.

## Design Notes

"Through" uses live transaction dates, so an import that added no new rows reports the same date as before. A hand-off's importer is the recipient, because `acceptHandoff` runs `importStatement` as her; only she can undo it. Batches that predate 0018 have a null importer and are not undoable.

## Verification

**Commands:**
- `npx vitest run packages apps/server apps/web` -- expected: all pass.
- `pnpm typecheck` -- expected: no errors.
- `pnpm lint` -- expected: clean.
- `pnpm check:strict` -- expected: STRICT tables ok.
