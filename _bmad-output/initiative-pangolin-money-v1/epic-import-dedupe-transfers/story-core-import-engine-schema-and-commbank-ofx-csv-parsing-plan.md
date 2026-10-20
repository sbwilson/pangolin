---
title: 'Core import engine, schema, and CommBank OFX/CSV parsing'
type: 'feature'
ticket: 1
created: '2026-10-20'
baseline_revision: 'a137429aadf380c768a778b437fa90de7a24cb07'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran:
  - blind-hunter
  - edge-case-hunter
  - verification-gap
  - intent-alignment
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/import-pipeline.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Pangolin currently lacks database tables and pipeline mechanisms to stage imported bank statements, deduplicate rows with occurrence counts, normalise descriptions, and commit imported transactions idempotently.

**Approach:** Implement `import_batch` and `import_row` schema with migration 0015; create normalisers and parsers for CommBank OFX and CSV; build the fingerprint deduplication engine with occurrence counts; create mock statement generators across all v1 formats; and wire an idempotent import execution pipeline in `packages/app`.

## Boundaries & Constraints

**Always:**
- Keep tables `STRICT` with `foreign_keys = ON` in migration 0015.
- Generate ULID primary keys on the server for `import_batch` and `import_row`.
- Compute `file_sha256` as hexadecimal SHA-256 of the raw statement content; enforce uniqueness of `(account_id, file_sha256)`.
- Re-importing an identical file or overlapping transactions must be strictly idempotent (0 new transactions committed, 0 duplicate rows created).
- Deduplicate on `external_id` (when present) or `(account_id, fingerprint)` where fingerprint includes account, date, amount, normalised description, and occurrence index among same-day duplicates.
- Keep two genuine identical same-day transactions (e.g. two $4.50 coffees) distinct by occurrence number.
- Soft-deleted transactions still participate in deduplication checks so deleted bank lines are never re-imported.
- Every committed transaction gets an initial full split whose beneficiary is the account owner (private account) or `shared` (shared account).

**Never:**
- Do not implement partial import set-aside UI or inline row fixing in this ticket (deferred to entry 3.3).
- Do not implement payee alias matching, auto-categorisation rules, or LLM categorisation in this ticket (deferred to entry 3.4 and epic 5).
- Do not implement transfer auto-linking or ±3 days transfer matching in this ticket (deferred to entry 3.5).
- Do not implement encrypted attachment storage or partner hand-off in this ticket (deferred to entry 3.6).
- Do not alter existing migrations 0000–0014.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First import of CommBank OFX | Valid OFX with 5 transactions, account exists | `import_batch` staged and committed; 5 transactions and 5 splits created; `new_count: 5, dup_count: 0` | Rejects with 404 if account not found |
| First import of CommBank CSV | Valid CSV with 4 transactions, account exists | `import_batch` staged and committed; 4 transactions and 4 splits created; `new_count: 4, dup_count: 0` | Rejects with 400 if CSV unparseable |
| Re-import identical file | Re-upload same file (matching `file_sha256`) | Returns existing batch status; 0 transactions created; idempotent | No error; returns batch with `new_count: 0` |
| Overlapping date range | New file sharing 3 existing transactions and 2 new | 2 new transactions committed; 3 existing skipped; `new_count: 2, dup_count: 3` | Idempotent duplicate skip |
| Same-day identical coffees | File contains two identical transactions on same date ($4.50 at same cafe) | Both transactions committed with occurrence indices 0 and 1; distinct fingerprints | Both transactions preserved |
| Re-import after soft delete | File contains a transaction previously soft-deleted in ledger | Transaction recognized as duplicate via fingerprint/external_id; not re-inserted | Silently skipped as duplicate |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/import-batch.ts` -- new schema definition for `import_batch` table (STRICT, status check, foreign key to `account`, unique index on account + file_sha256).
- `packages/db/src/schema/import-row.ts` -- new schema definition for `import_row` table (STRICT, status check, foreign key to `import_batch`).
- `packages/db/src/schema/index.ts` -- export `importBatch` and `importRow` schemas.
- `packages/db/migrations/0015_import_batch_and_row.sql` -- migration creating `import_batch` and `import_row` tables.
- `packages/app/src/ports/unit-of-work.ts` -- define `ImportBatchRow`, `ImportRowRow`, `ImportBatchRepo`, `ImportRowRepo`, and add them to `TxRepos` and `ReadRepos`.
- `packages/db/src/repositories/import-repos.ts` -- SQLite repository implementation of `ImportBatchRepo` and `ImportRowRepo`.
- `packages/db/src/unit-of-work.ts` -- register `importBatch` and `importRow` repositories.
- `packages/app/src/testing/memory-uow.ts` -- in-memory repository implementation for `importBatch` and `importRow`.
- `packages/domain/src/normalise/commbank.ts` -- normalisation rules for CommBank transaction descriptions (strip VISA DEBIT noise, trim, canonicalise).
- `packages/domain/src/dedupe/fingerprint.ts` -- fingerprint calculation with occurrence index for same-day duplicates.
- `packages/importers/src/parsers/commbank-ofx.ts` -- parser for CommBank OFX statement files extracting transactions, balances, and FITIDs.
- `packages/importers/src/parsers/commbank-csv.ts` -- parser for CommBank CSV statement files extracting date, amount, description, and running balance.
- `packages/importers/src/generators/mock-statements.ts` -- statement generator across all v1 formats (CommBank OFX, CommBank CSV, CommBank QIF, ubank CSV, Up CSV, FY2025 multi-bank format).
- `packages/app/src/imports/import-statement.ts` -- use case executing the import pipeline: parse, stage in `import_row`, dedupe against ledger, and commit new transactions.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db/src/schema/import-batch.ts` -- create `import_batch` table schema -- persists statement upload batches with status and row counts.
- [ ] `packages/db/src/schema/import-row.ts` -- create `import_row` table schema -- stages parsed statement rows before commit.
- [ ] `packages/db/src/schema/index.ts` -- export import batch and row tables -- registers schemas for Drizzle and migrations.
- [ ] `packages/db/migrations/0015_import_batch_and_row.sql` -- add migration 0015 with STRICT tables and indexes -- updates database schema.
- [ ] `packages/app/src/ports/unit-of-work.ts` -- add import batch and row interfaces and repository types to UoW -- establishes contract for imports.
- [ ] `packages/db/src/repositories/import-repos.ts` -- implement SQLite repositories for `import_batch` and `import_row` -- database persistence.
- [ ] `packages/db/src/unit-of-work.ts` -- wire import repositories into `UnitOfWork` -- expose repos to write transactions.
- [ ] `packages/app/src/testing/memory-uow.ts` -- implement in-memory import repositories -- enable fast isolated unit testing.
- [ ] `packages/domain/src/normalise/commbank.ts` -- implement CommBank description normalisation -- clean card prefixes and whitespace noise.
- [ ] `packages/domain/src/dedupe/fingerprint.ts` -- implement dedupe engine with occurrence counts -- ensure stable dedupe keys.
- [ ] `packages/importers/src/parsers/commbank-ofx.ts` -- implement CommBank OFX parser -- parse SGML OFX files into structured records.
- [ ] `packages/importers/src/parsers/commbank-csv.ts` -- implement CommBank CSV parser -- parse CommBank CSV format into structured records.
- [ ] `packages/importers/src/generators/mock-statements.ts` -- implement mock statement generator for all v1 formats -- test fixtures and seed pipeline.
- [ ] `packages/app/src/imports/import-statement.ts` -- implement core import use case -- stage batch, dedupe against existing rows, and commit new transactions.
- [ ] `packages/importers/src/importers.test.ts` -- unit tests for OFX/CSV parsers and mock generators -- verify parsing and generation fidelity.
- [ ] `packages/app/src/imports/import-statement.test.ts` -- integration tests for import engine -- verify dedupe, occurrence counting, and idempotency.

**Acceptance Criteria:**
- Given a CommBank OFX file with 5 transactions, when imported, then 5 transactions and 5 splits are created in the ledger under `import_batch` with `new_count: 5, dup_count: 0`.
- Given a CommBank CSV file with transactions, when imported, then transactions are normalised, fingerprinted, and committed to the ledger.
- Given an already imported CommBank file, when re-imported into the same account, then 0 transactions are created and `dup_count` equals the total row count.
- Given two identical transactions on the same day in one statement, when imported, then both transactions are committed with distinct occurrence indices in their fingerprints.
- Given a soft-deleted transaction in the ledger, when a statement containing the matching transaction is imported, then it is skipped as a duplicate.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `packages/app/src/imports/import-statement.ts:881` -- verdict: high -- route: patch -- `occurrenceMap` starts empty and ignores existing transactions in the ledger on that date, causing legitimate same-day identical transactions across separate statements to be discarded as false duplicates.
- `packages/app/src/imports/import-statement.ts:922` -- verdict: medium -- route: patch -- Duplicate rows remain permanently in `staged` status with null reason instead of being updated to `discarded` with reason `duplicate`.
- `packages/db/src/repositories/import-repos.ts:1621` -- verdict: medium -- route: patch -- SQLite import repositories (`importBatches`, `importRows`) and dedupe methods (`listForDedupe`, `findByExternalId`, `findByFingerprint`) are unverified against a real SQLite database.
- `packages/importers/src/parsers/commbank-ofx.ts:2795` -- verdict: medium -- route: patch -- `<LEDGERBAL>` closing balance is assigned to every individual transaction's `balanceCents`, misrepresenting transaction-level running balances.
- `packages/importers/src/parsers/commbank-ofx.ts:2733` -- verdict: low -- route: patch -- OFX parser returns empty array instead of throwing when statement contains no transactions.
- `packages/app/src/imports/import-statement.ts:818` -- verdict: medium -- route: patch -- Existing batch check does not exclude failed batches (`status === "failed"`), permanently blocking retry of failed statement imports.
- `packages/db/src/ledger-repos.ts:1545` -- verdict: medium -- route: patch -- `inArray(transaction.postedOn, dates)` exceeds SQLite parameter limit when dates array exceeds 999 elements.
- `packages/domain/src/normalise/commbank.ts:2041` -- verdict: medium -- route: patch -- Description normaliser misses Mastercard noise patterns (`MASTERCARD PURCHASE`, `DEBIT MASTERCARD`) and character casing differences.
- `packages/app/src/ports/unit-of-work.ts:1187` -- verdict: medium -- route: patch -- `ImportRowRepo.updateStatus` lacks optional `reason` parameter to document why a row was discarded or set aside.
- `packages/app/src/ports/unit-of-work.ts:1190` -- verdict: medium -- route: patch -- `ImportRowRepo.listForBatch` does not accept `Viewer` to enforce account visibility.
- `packages/app/src/imports/import-statement.test.ts:23` -- verdict: low -- route: patch -- `alexViewer` test fixture uses `kind: "user"` instead of `kind: "person"` and string timestamp instead of Temporal.Instant.
- `packages/importers/src/parsers/commbank-csv.ts:2627` -- verdict: low -- route: patch -- CSV line number tracking is off-by-one when header row is skipped without incrementing line counter.
- `packages/domain/src/dedupe/fingerprint.ts:1936` -- verdict: low -- route: false -- Pure-JS SHA-256 implementation is required by domain purity invariants (no Node/runtime built-ins in domain) and benchmark overhead is negligible for normal statement files.
- `packages/importers/src/parsers/commbank-csv.ts:2627` -- verdict: low -- route: false -- CommBank NetBank CSV exports never contain embedded newlines in descriptions.


## Design Notes

Dedupe key formula:
`fingerprint = sha256Hex(accountId + "\n" + postedOn + "\n" + amountCents + "\n" + normalisedDescription + "\n" + occurrence)`
Where `occurrence` is the 0-based index of identical `(postedOn, amountCents, normalisedDescription)` rows on that day. When importing, existing transactions in the ledger on that day with the same `(postedOn, amountCents, normalisedDescription)` are enumerated to assign and match occurrence counts accurately.

## Verification

**Commands:**
- `npx vitest run packages/importers` -- expected: all parser and mock statement generator tests pass.
- `npx vitest run packages/app/src/imports` -- expected: all import use-case, dedupe, and idempotency tests pass.
- `npx vitest run packages/db/src/strict-check.test.ts` -- expected: migration 0015 tables pass STRICT checks.
- `node scripts/check-boundaries.ts` -- expected: clean boundary check with 0 violations.
- `pnpm biome check` -- expected: 0 lint or formatting errors.
