---
title: 'Partial import and set-aside rows'
type: 'feature'
ticket: 3
created: '2026-10-20'
baseline_revision: '7e9fb1dc52bb8eedc2724df9f2eae9321938e230'
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

**Problem:** When a CSV, OFX, or QIF bank statement contains unreadable or malformed lines, the entire import fails, blocking valid transactions from being committed to the ledger.

**Approach:** Implement partial import for CSV, OFX, and QIF: stage unreadable rows in `import_row` (`status: set_aside`) with line number and failure reason, commit valid rows to the ledger, raise an `import.set_aside` review item for the batch, and provide inline fix and discard actions that resolve the review item.

## Boundaries & Constraints

**Always:**
- For CSV, OFX, and QIF formats, unreadable or malformed rows must not block valid rows from being committed.
- Unreadable rows must be staged in `import_row` with `status: "set_aside"`, 1-based `row_number`, `raw_line`, and `reason`.
- Valid rows must be staged and committed to the ledger as normal transactions and splits, or marked `discarded` with reason `duplicate` if deduplicated.
- If an import batch contains one or more `set_aside` rows, raise an `import.set_aside` review item scoped to the target account with `entityRef: "import_batch:" + batchId` and `dedupeKey: "import.set_aside:" + batchId`.
- Fixing a set-aside row commits the corrected transaction to the ledger through the same batch (`importId: batchId`) and updates its `import_row` status to `"committed"`.
- Discarding a set-aside row updates its `import_row` status to `"discarded"` with an optional reason without creating a transaction.
- When all `set_aside` rows in a batch have reached terminal status (`"committed"` or `"discarded"`), the `import.set_aside` review item must be automatically resolved with `resolution: "all rows resolved"`.
- All `import_row` and review item operations must enforce viewer access boundaries via `visibleAccountId` (AD-3).
- PDF imports must remain all-or-nothing: any failed check blocks the whole batch (IMP-3, D5).
- Entirely empty files or completely unrecognizable formats must still fail validation with `AppError("Validation")`.

**Never:**
- Never commit `set_aside` rows directly to the ledger without user correction.
- Never allow a user to fix or discard `set_aside` rows in an account they do not have permission to view.
- Never modify existing database migrations 0000–0015 or alter schema tables (`import_row` already supports `set_aside` and `discarded` in 0015).
- Never build the frontend `/review` inbox UI in this ticket (deferred to entry 3.8).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CSV with invalid row | CSV with 3 valid rows and 1 row with malformed date | 3 rows committed to ledger; 1 row staged with `status: "set_aside"` and reason; `import.set_aside` review item raised; batch `new_count: 3` | Bad row isolated; no batch abort |
| OFX with corrupted transaction | OFX with 2 valid STMTTRN and 1 missing TRNAMT | 2 valid transactions committed; 1 STMTTRN staged as `set_aside`; review item raised | STMTTRN parse error caught and recorded |
| QIF with invalid record | QIF with 2 valid records and 1 unparseable amount | 2 valid transactions committed; 1 record staged as `set_aside`; review item raised | QIF record error caught and recorded |
| All rows invalid | CSV with 3 rows all having invalid dates | Batch created with 0 new, 0 dup, 3 `set_aside`; `import.set_aside` review item raised; no transactions created | Returns result with `newCount: 0, setAsideCount: 3` |
| Empty / unrecognizable file | Completely empty file or binary garbage | No batch created; no review item raised | Throws `AppError("Validation")` |
| Fix set-aside row | User submits corrected date, amount, description for set-aside row | Transaction created with `importId: batchId`; `import_row` updated to `committed`; batch `new_count` incremented | Throws `NotFound` if row not found, `Validation` if row not `set_aside` |
| Discard set-aside row | User requests discard of set-aside row | `import_row` updated to `status: "discarded"` with reason; no transaction created | Throws `NotFound` if row not found, `Validation` if row not `set_aside` |
| Last set-aside row resolved | Batch had 1 set-aside row; user fixes or discards it | `import_row` updated; `import.set_aside` review item automatically resolved | Review item status becomes resolved |
| Multiple set-aside rows resolved incrementally | Batch had 2 set-aside rows; user fixes the first | First row committed; review item remains open; user discards second row; review item resolves | Clean state transition |

</frozen-after-approval>

## Code Map

- `packages/app/src/ports/statement-parser.ts` -- define and export `SetAsideStatementRow` and `StatementParseResult` interfaces; update `StatementParser` return type to allow `StatementParseResult | readonly ParsedStatementRow[]`.
- `packages/importers/src/parsers/commbank-csv.ts` -- update `parseCommBankCsv` to capture malformed rows in `setAside` instead of throwing, returning `StatementParseResult`.
- `packages/importers/src/parsers/commbank-ofx.ts` -- update `parseCommBankOfx` to capture malformed `STMTTRN` blocks in `setAside` instead of throwing.
- `packages/importers/src/parsers/qif.ts` -- update `parseQif` to capture malformed QIF records in `setAside` instead of throwing.
- `packages/importers/src/parsers/ubank-csv.ts` -- update `parseUbankCsv` to isolate unparseable rows into `setAside`.
- `packages/importers/src/parsers/up-csv.ts` -- update `parseUpCsv` to isolate unparseable rows into `setAside`.
- `packages/importers/src/parsers/fy2025-multibank-csv.ts` -- update `parseFy2025MultiBankCsv` to isolate unparseable rows into `setAside`.
- `packages/importers/src/parsers/generic-csv.ts` -- update `parseGenericCsv` to isolate unparseable rows into `setAside`.
- `packages/app/src/ports/unit-of-work.ts` -- add `find(viewer: Viewer, id: string): ImportRowRow | undefined` to `ImportRowRepo`.
- `packages/db/src/repositories/import-repos.ts` -- implement `find` on `ImportRowRepo` with viewer visibility check against `import_batch.accountId`.
- `packages/app/src/testing/memory-uow.ts` -- implement `find` on `ImportRowRepo` in memory UoW.
- `packages/app/src/imports/import-statement.ts` -- update builtin statement parsers to return `StatementParseResult`; update `importStatement` pipeline to stage `set_aside` rows in `import_row`, commit valid rows, and raise `import.set_aside` review item when set-aside rows exist.
- `packages/app/src/imports/set-aside.ts` -- new use cases: `defineReviewKind` for `import.set_aside`, `fixSetAsideRow`, `discardSetAsideRow`, and `listSetAsideRowsForBatch`.
- `packages/app/src/index.ts` -- re-export `fixSetAsideRow`, `discardSetAsideRow`, `listSetAsideRowsForBatch`, and `IMPORT_SET_ASIDE_REVIEW`.
- `packages/importers/src/importers.test.ts` -- unit tests for parser partial-parsing behavior on invalid rows.
- `packages/app/src/imports/set-aside.test.ts` -- unit and integration tests for fixing, discarding, and auto-resolving set-aside rows.
- `packages/app/src/imports/import-statement.test.ts` -- integration tests for partial import execution and review item raising.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/ports/statement-parser.ts` -- define `SetAsideStatementRow` and `StatementParseResult` -- types for partial parsing.
- [x] `packages/app/src/ports/unit-of-work.ts` -- add `find` to `ImportRowRepo` -- lookup single import row by ID with viewer scoping.
- [x] `packages/db/src/repositories/import-repos.ts` -- implement `find` in SQLite `createImportRowRepo` -- repository persistence for single import row.
- [x] `packages/app/src/testing/memory-uow.ts` -- implement `find` in `memoryUnitOfWork` `importRowRepo` -- in-memory test parity.
- [x] `packages/importers/src/parsers/commbank-csv.ts` -- collect invalid rows into `setAside` -- partial CSV parsing.
- [x] `packages/importers/src/parsers/commbank-ofx.ts` -- collect invalid `STMTTRN` blocks into `setAside` -- partial OFX parsing.
- [x] `packages/importers/src/parsers/qif.ts` -- collect invalid records into `setAside` -- partial QIF parsing.
- [x] `packages/importers/src/parsers/ubank-csv.ts` -- collect invalid rows into `setAside` -- partial ubank CSV parsing.
- [x] `packages/importers/src/parsers/up-csv.ts` -- collect invalid rows into `setAside` -- partial Up CSV parsing.
- [x] `packages/importers/src/parsers/fy2025-multibank-csv.ts` -- collect invalid rows into `setAside` -- partial FY2025 CSV parsing.
- [x] `packages/importers/src/parsers/generic-csv.ts` -- collect invalid rows into `setAside` -- partial generic CSV parsing.
- [x] `packages/app/src/imports/import-statement.ts` -- update builtin parsers and `importStatement` pipeline -- stages set-aside rows and raises review item.
- [x] `packages/app/src/imports/set-aside.ts` -- implement `fixSetAsideRow`, `discardSetAsideRow`, and `listSetAsideRowsForBatch` -- inline resolution use cases.
- [x] `packages/app/src/index.ts` -- export new set-aside use cases and review kind -- expose public module API.
- [x] `packages/importers/src/importers.test.ts` -- add unit tests for partial parsing across statement formats -- verify parser error isolation.
- [x] `packages/app/src/imports/set-aside.test.ts` -- add use case tests for fixing, discarding, and review item auto-resolution -- verify resolution logic and boundaries.
- [x] `packages/app/src/imports/import-statement.test.ts` -- add integration tests for partial import pipeline -- verify end-to-end partial import flow.

**Acceptance Criteria:**
- Given a CSV, OFX, or QIF file containing both valid and invalid transaction rows, when imported via `importStatement`, then valid rows are committed to the ledger, invalid rows are staged in `import_row` with `status: "set_aside"` and failure reason, and an `import.set_aside` review item is raised for the batch.
- Given an import batch with staged `set_aside` rows, when a user fixes a set-aside row with valid transaction parameters, then a new transaction is committed to the ledger with `importId` set to the batch ID, the `import_row` status updates to `"committed"`, and `batch.new_count` is incremented.
- Given an import batch with staged `set_aside` rows, when a user discards a set-aside row, then the `import_row` status updates to `"discarded"` and no transaction is created.
- Given an open `import.set_aside` review item for a batch, when all `set_aside` rows belonging to that batch are resolved (all status values are `"committed"` or `"discarded"`), then the review item is automatically resolved.
- Given a user attempting to view, fix, or discard a set-aside row in an account they cannot see, when the use case is called, then access is denied with a `NotFound` or visibility error.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `packages/app/src/imports/set-aside.ts:2409` -- verdict: medium -- route: patch -- `fixSetAsideRow` lacked check for duplicate `externalId` in account, causing unhandled SQLite unique constraint failure on conflicting external IDs. Patched: added `tx.transactions.findByExternalId` check throwing `Conflict`.
- `packages/app/src/imports/set-aside.ts:2544` -- verdict: medium -- route: patch -- `discardSetAsideRow` omitted audit logging for `import_row` mutation and wiped existing failure reason to `null` when no custom reason was provided. Patched: added audit event and preserved existing `row.reason`.
- `packages/importers/src/parsers/generic-csv.ts:168` -- verdict: medium -- route: patch -- `parseOptionalCents` silently swallowed `toCents` errors as `null`, allowing invalid debit amounts to be treated as empty when credit was valid. Patched: propagated syntax errors so malformed debit/credit values trigger set-aside.
- `packages/app/src/imports/import-statement.ts:904` -- verdict: low -- route: patch -- Custom parser returning object with omitted `rows` or `setAside` caused TypeError on `.length`. Patched: guarded with `?? []`.
- `packages/app/src/imports/set-aside.ts:2454` -- verdict: low -- route: patch -- `fixSetAsideRow` did not clear previous failure `reason` upon updating row status to `"committed"`. Patched: passed `null` to clear `reason`.
- `packages/app/src/imports/set-aside.ts:2538` -- verdict: low -- route: patch -- `discardSetAsideRow` omitted explicit `tx.accounts.findVisible` check. Patched: added explicit account check matching `fixSetAsideRow`.
- `packages/importers/src/parsers/qif.ts:74` -- verdict: low -- route: patch -- Corrupted non-empty QIF block lacking date and amount was silently dropped instead of set aside. Patched: staged non-empty malformed blocks in `setAside`.
- `packages/app/src/imports/import-statement.ts:840` -- verdict: low -- route: false -- Claimed re-import of previously set-aside file inaccurately reports duplicates. Refuted: duplicate detection operates at the batch file SHA level; re-uploading the exact same file is a no-op duplicate file event.
- `packages/importers/src/parsers/fy2025-multibank-csv.ts:42` -- verdict: low -- route: false -- Claimed unrecognised formats are set aside rather than throwing. Refuted: parser validates `parseCsvLine(l).length >= 2` and throws "Unrecognised CSV format", which fails validation.
- `packages/importers/src/parsers/commbank-ofx.ts:106` -- verdict: low -- route: false -- Claimed closing balance dropped by parser adapter. Refuted: statement parser port contract does not carry file-level closing balances; per-row `balanceCents` is preserved.
- `packages/importers/src/parsers/commbank-ofx.ts:48` -- verdict: low -- route: false -- Claimed unclosed STMTTRN block dropped. Refuted: unclosed tags fail overall OFX structure checks; regex parsing is standard for OFX SGML.
- `packages/app/src/imports/import-statement.ts:1024` -- verdict: low -- route: false -- Claimed 100% set-aside batch should not have status "committed". Refuted: import batch completion records total/new/dup/set-aside counts; "committed" marks batch processing completion.
- `packages/importers/src/parsers/*.ts` -- verdict: low -- route: false -- Claimed parser return shape inconsistency. Refuted: `Object.assign([...rows], { rows, setAside })` is an intentional backwards-compatibility measure for legacy array callers while satisfying `StatementParseResult`.

## Design Notes

`StatementParseResult` interface:
```ts
export interface SetAsideStatementRow {
  readonly rowNumber: number;
  readonly rawLine: string;
  readonly reason: string;
}

export interface StatementParseResult {
  readonly rows: readonly ParsedStatementRow[];
  readonly setAside: readonly SetAsideStatementRow[];
}
```

Review item contract:
- Kind: `import.set_aside`
- Module: `imports`
- Scope: `account`
- `entityRef`: `import_batch:${batchId}`
- `dedupeKey`: `import.set_aside:${batchId}`
- Resolution: `"all rows resolved"`

## Verification

**Commands:**
- `npx vitest run packages/importers` -- expected: all parser unit and fixture tests pass.
- `npx vitest run packages/app/src/imports` -- expected: all partial import, set-aside resolution, and idempotency tests pass.
- `node scripts/check-boundaries.ts` -- expected: 0 boundary violations.
- `pnpm biome check` -- expected: 0 lint or formatting errors.
