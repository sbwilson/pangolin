---
title: 'Overlap-safe dedupe and re-import after undo'
type: 'bugfix'
ticket: ''
created: '2026-10-22'
baseline_revision: '0fa5efcd6afeebf544a6cc90ebb7a17fee5e513c'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/epic-import-dedupe-transfers/epic-import-dedupe-transfers-retrospective.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/import-pipeline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Importing a CSV that overlaps an earlier file re-commits the shared rows (second file: 3 new, 0 duplicates, 6 transactions where 4 are correct), because the occurrence counter is seeded from rows already in the ledger so a repeated bank line gets a fingerprint nothing matches (retro F1). And an import that was undone can never be redone: its transactions still count for dedupe, the unique indexes still hold its fingerprints and file hash, and the file-hash gate returns the old batch (retro F2), so the "undo, then import a corrected file" remedy the Balance gap card and `docs/m1-gate.md` give does not work.

**Approach:** Number a repeated line by its position in the file only, so an overlapping file matches the ledger line for line and only the excess rows are new. Make an undo free what the batch claimed (transaction fingerprints, external ids, the file hash), so its rows and file can be imported again; rows the user deleted stay blocked.

## Boundaries & Constraints

**Always:**
- Occurrence = the 0-based index of that identical `(date, amount, normalised description)` line within the incoming file; never seeded from the ledger. A row is a duplicate when a transaction with that fingerprint (or external id) exists in the account, soft-deleted by the user included (AD-20).
- Two identical same-day coffees in one file stay two; a file that repeats them over a ledger that has both adds zero; a file with one more than the ledger adds one.
- `undoImportBatch` tombstones, in the same write, every transaction of the batch (`fingerprint` and non-null `external_id` become `undone:<transaction id>:<old value>`) and the batch (`file_sha256` becomes `undone:<batch id>:<old value>`). Rows stay soft-deleted for audit. The file-hash gate and dedupe then see nothing for them; user deletes (`deleteTransaction`) are not tombstoned.
- Works on SQLite with the unique indexes `transaction_account_fingerprint_idx`, the external-id index and `import_batch_account_file_sha_idx`; no migration.
- The tombstoned values are still unique and never collide with a real fingerprint (64 hex chars) or file hash.

**Never:**
- No change to fingerprint formula or `FINGERPRINT_VERSION`, probable-duplicate or transfer matching, reconcile, or the set-aside fix path; no repair of rows already duplicated by the old behaviour (record that in Implementation Notes); no undo route or UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Overlapping CSV | File A rows 1-3, then B rows 2-4, no ids | B adds 1; ledger has 4 | n/a |
| Cross-format overlap | OFX imported, then a CSV with the same lines | Shared lines are duplicates | n/a |
| Same-day twins | File has two identical lines; ledger has both | Adds 0 | n/a |
| Later more rows | Ledger has one coffee on a day; later file has two | Adds 1 | n/a |
| Identical file | Same file again | Existing batch returned, 0 new | n/a |
| Undo, same file | Undo, then import the same file | New batch, all rows back, index not violated | n/a |
| Undo, corrected file | Undo, then an overlapping corrected file | All its rows commit | n/a |
| User delete | User deletes one imported line, re-imports | Line stays blocked | n/a |
| Undone twice over | Undo batch, re-import, undo again | Works; tombstones stay unique | n/a |

</frozen-after-approval>

## Code Map

- `packages/app/src/imports/import-statement.ts` -- remove the ledger seeding of `occurrenceMap` (~l.279-296) and keep per-file counting; the existing-fingerprint set stays the duplicate test.
- `packages/app/src/imports/undo-batch.ts` -- call a new tombstone step after the rows are soft-deleted.
- `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/ledger-repos.ts` (transactions), `packages/db/src/repositories/import-repos.ts` (batches), `packages/app/src/testing/memory-uow.ts` -- `TransactionRepo.tombstoneImportKeys(batchId)` and a batch `file_sha256` tombstone inside `markUndone`; viewer-less allow-list entry in `tx-repos-viewer.test.ts`; parity steps.
- `packages/app/src/imports/set-aside.ts` -- unchanged; note its own occurrence counting is out of scope.
- Tests: `import-statement.test.ts` (overlap, cross-format, same-day), `undo-batch.test.ts`, `opening-balance.test.ts` (undo then import), `packages/db/src/import-repos.test.ts` (SQLite: import, undo, re-import against the real unique indexes), `repo-parity.test.ts`.
- `docs/m1-gate.md`, `ReadOnlyCard.tsx` wording stay valid; add the sentence that re-import after undo works to `docs/m1-gate.md`.

## Tasks & Acceptance

**Execution:**
- [ ] Per-file occurrence counting in `importStatement`.
- [ ] Tombstone repo methods in SQLite and memory, wired into `undoImportBatch`, with parity and viewer-less allow-list entries.
- [ ] Tests for every matrix row, including a SQLite-backed import, undo and re-import.

**Acceptance Criteria:**
- Given two overlapping CSV files with no ids, when both are imported, then each shared line exists once.
- Given an undone batch, when its file (or a corrected overlapping file) is imported, then its rows commit and the unique indexes are not violated.
- Given a user-deleted line, when a file containing it is imported, then it is still skipped.

## Implementation Notes

Trade-off accepted: with the occurrence numbered by file position only, a later non-overlapping export that holds one genuine second identical same-day line is skipped as a duplicate. Bank exports cover whole days, so a day's lines appear in full in every file that includes that day; the case needs a mid-day split that dated exports do not produce.

Rows already duplicated by the old seeding (an overlapping CSV imported before this fix) are not repaired. The four statements imported on pang-dev were single files and are unaffected.

## Plan Change Log

## Review Triage Log

- Tombstone rewrites every row of the batch, so a line the user hand-deleted inside the batch is freed and returns after undo + re-import; plan, comment and docs say hand-deleted lines stay blocked (blind, edge, gap) -- verdict: high -- route: patch -- tombstone only the transactions that were live when the undo began (ids captured before the soft-delete loop); test delete, undo, re-import: stays blocked.
- External-id tombstone never exercised with a non-null external id (gap) -- verdict: medium -- route: patch -- OFX with FITIDs: import, undo, re-import (memory and SQLite) and a parity row with an external id.
- `fixSetAsideRow` still seeds its occurrence from the ledger, so two commit paths number occurrences differently (edge, gap) -- verdict: medium -- route: defer -- the plan excludes the set-aside path and which rule is right for a row that was never committed is a product decision; logged.
- Spine AD-20 text ("same file stays blocked") now differs from the code (blind) -- verdict: low -- route: defer -- spec reconciliation for the human; logged.
- A later non-overlapping export holding one genuine second same-day identical line is skipped as a duplicate (blind) -- verdict: low -- route: accept -- bank exports cover whole days, so a day's lines appear in full in every file that includes it; recorded in Implementation Notes.
- Batches undone before this change stay blocked (blind, gap) -- verdict: false -- undo has no route, CLI command or UI, so no production database holds an undone batch.
- Tombstone before `markUndone`, no `updatedAt` or audit on the key rewrite, parity scenario order, unused import, front-matter oddities (blind, edge, gap) -- verdict: false/low -- route: reject -- the write rolls back on `Conflict`, the undo audits each row and the batch, lint is clean.

## Verification

**Commands:**
- `npx vitest run` -- expected: all pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm check:strict` -- expected: clean.
