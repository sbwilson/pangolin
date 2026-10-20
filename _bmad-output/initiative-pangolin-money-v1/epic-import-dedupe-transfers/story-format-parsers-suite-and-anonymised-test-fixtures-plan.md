---
title: 'Format parsers suite and anonymised test fixtures'
type: 'feature'
ticket: 2
created: '2026-10-20'
baseline_revision: 'f83666c6493c66e1cef955854dd459e87f79fe01'
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

**Problem:** The import engine only parses CommBank OFX and CommBank CSV, preventing users from importing transactions from ubank, Up, standard QIF files, the FY2025 multi-bank export format, or custom CSV exports from other financial institutions.

**Approach:** Implement dedicated parsers for ubank CSV, Up CSV, QIF (standard and CommBank), FY2025 multi-bank CSV, and a configurable generic CSV mapper in `packages/importers`; commit anonymised sample fixtures for every format; and expand `importStatement` in `packages/app` to dispatch all formats with idempotent re-import verification.

## Boundaries & Constraints

**Always:**
- Parse statements into `readonly ParsedStatementRow[]` conforming to `@pangolin/app`'s `StatementParser` port.
- Amounts in cents must follow the single sign convention (AD-12): positive = money into account (credit), negative = money out of account (debit).
- Support standard Australian and ISO date conventions (`DD/MM/YYYY`, `YYYY-MM-DD`, `DD/MM/YY`, `YYYY-MM-DD HH:mm:ss`).
- Retain exact raw lines and 1-based row numbers in `ParsedStatementRow` for partial import set-aside staging (IMP-3).
- Commit anonymised sample test fixture files in `packages/importers/fixtures/` for every format (CommBank OFX, CommBank CSV, CommBank QIF, ubank CSV, Up CSV, FY2025 multi-bank CSV, and generic CSV).
- Verify strict idempotency across all formats: re-importing the same file or overlapping date ranges produces zero duplicate transactions.
- Generic CSV mapper must accept flexible column mapping configuration (by column index or header name), configurable date formats, delimiter, header presence, and debit/credit or signed amount columns.

**Never:**
- Do not implement partial import set-aside review item UI or inline error resolution in this ticket (deferred to entry 3.3).
- Do not implement payee matching, auto-categorisation rules, or LLM categorisation in this ticket (deferred to entry 3.4).
- Do not implement transfer matching or transfer auto-linking in this ticket (deferred to entry 3.5).
- Do not modify database migrations 0000–0015 or alter database schema tables.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ubank CSV import | Valid ubank CSV (`Date,Description,Amount,Balance`) | Parsed into `ParsedStatementRow[]`, committed to ledger with correct dates, amounts, and descriptions | Throws `Validation` error on malformed lines or missing columns |
| Up CSV import | Valid Up CSV (`Time,Settled Date,Description,Amount,Status`) | Parses settled transactions; `postedOn` uses settled date; amounts converted to cents | Non-settled / pending transactions without settled dates handled or skipped |
| QIF import | Standard QIF (`!Type:Bank` with `D`, `T`, `P`, `M`, `N`, `^`) | Parsed into `ParsedStatementRow[]`; `N` field mapped to `externalId`; amounts signed per AD-12 | Throws `Validation` error on unrecognized headers or malformed records |
| FY2025 multi-bank CSV | Valid FY2025 CSV (`Timestamp,Account,Amount,Description,Balance`) | Timestamps converted to `YYYY-MM-DD`; amounts converted to cents; all rows parsed | Throws `Validation` error if timestamp or amount unparseable |
| Generic CSV with signed amount | CSV with arbitrary headers and `CsvColumnMapping` specifying `date`, `description`, `amount` | Columns extracted per mapping, dates parsed per `dateFormat`, amounts parsed per sign convention | Throws `Validation` error if mapped columns missing from row |
| Generic CSV with debit/credit | CSV with separate `Debit` and `Credit` columns and `CsvColumnMapping` | Debit converted to negative cents, credit converted to positive cents | Throws `Validation` error if both or neither amounts are present |
| Re-import identical sample file | Re-uploading any format's committed sample file into the same account | Existing batch returned with `new_count: 0, dup_count: N`; zero new transactions created | Idempotent duplicate skip; no error |
| Overlapping date import | Second statement file containing 2 overlapping transactions and 2 new | 2 new transactions committed; 2 overlapping skipped; `new_count: 2, dup_count: 2` | Clean deduplication via fingerprint/externalId |

</frozen-after-approval>

## Code Map

- `packages/app/src/ports/statement-parser.ts` -- define `CsvColumnMapping`, `DateFormat`, `SignConvention` types and export them for use across app and importers.
- `packages/importers/src/parsers/commbank-csv.ts` -- existing CommBank CSV parser; keep intact and export for reuse.
- `packages/importers/src/parsers/commbank-ofx.ts` -- existing CommBank OFX parser; keep intact and export for reuse.
- `packages/importers/src/parsers/ubank-csv.ts` -- new parser for ubank CSV (`Date,Description,Amount,Balance`), extracting dates (`DD/MM/YYYY`), signed amounts, running balances, and descriptions.
- `packages/importers/src/parsers/up-csv.ts` -- new parser for Up CSV (`Time,Settled Date,Description,Amount,Status`), extracting settled dates, signed amounts, and descriptions.
- `packages/importers/src/parsers/qif.ts` -- new parser for QIF statement files (`!Type:Bank`), extracting transaction dates, amounts, payees, memos, and check/reference numbers as `externalId`.
- `packages/importers/src/parsers/fy2025-multibank-csv.ts` -- new parser for FY2025 multi-bank CSV (`Timestamp,Account,Amount,Description,Balance`), extracting `YYYY-MM-DD` dates from timestamps and signed amounts.
- `packages/importers/src/parsers/generic-csv.ts` -- new configurable generic CSV parser mapping arbitrary column structures, date formats, delimiters, and debit/credit or signed amount columns.
- `packages/importers/src/index.ts` -- re-export all new parsers and `StatementParser` implementations.
- `packages/importers/fixtures/` -- committed anonymised test files for every format: `commbank.ofx`, `commbank.csv`, `commbank.qif`, `ubank.csv`, `up.csv`, `fy2025-multibank.csv`, `generic.csv`.
- `packages/app/src/imports/import-statement.ts` -- expand `importStatementInput` format enum to support `commbank_qif`, `ubank_csv`, `up_csv`, `fy2025_multibank_csv`, `generic_csv`, and dispatch to appropriate parser.
- `packages/importers/src/importers.test.ts` -- unit tests verifying every parser against generated and committed sample files.
- `packages/app/src/imports/import-statement.test.ts` -- end-to-end import and idempotency tests verifying each sample file imports and re-imports with 0 duplicate rows.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/ports/statement-parser.ts` -- define CSV mapping configuration interfaces -- exports `CsvColumnMapping`, `DateFormat`, `SignConvention`.
- [x] `packages/importers/src/parsers/ubank-csv.ts` -- implement ubank CSV parser and `ubankCsvParser` adapter -- parses ubank format statement rows.
- [x] `packages/importers/src/parsers/up-csv.ts` -- implement Up CSV parser and `upCsvParser` adapter -- parses Up format statement rows.
- [x] `packages/importers/src/parsers/qif.ts` -- implement QIF parser and `qifParser` adapter -- parses standard and CommBank QIF format statements.
- [x] `packages/importers/src/parsers/fy2025-multibank-csv.ts` -- implement FY2025 multi-bank CSV parser and `fy2025MultiBankCsvParser` adapter -- parses FY2025 format statement rows.
- [x] `packages/importers/src/parsers/generic-csv.ts` -- implement generic CSV mapper and `createGenericCsvParser` factory -- parses arbitrary CSV files based on column mapping config.
- [x] `packages/importers/src/index.ts` -- export all parsers and mapper factories -- expose parser suite from importers package.
- [x] `packages/importers/fixtures/` -- create committed anonymised test fixture files for all 7 statement formats -- provides permanent committed sample files.
- [x] `packages/app/src/imports/import-statement.ts` -- update input schema and parser dispatch for all statement formats -- enables end-to-end import of all format types.
- [x] `packages/importers/src/importers.test.ts` -- add unit tests for ubank, Up, QIF, FY2025, generic CSV parsers and fixtures -- verifies parsing fidelity and error handling.
- [x] `packages/app/src/imports/import-statement.test.ts` -- add integration and idempotency tests for all statement formats -- verifies sample file imports and re-import duplicate suppression.

**Acceptance Criteria:**
- Given committed anonymised sample files for CommBank OFX, CommBank CSV, CommBank QIF, ubank CSV, Up CSV, FY2025 multi-bank CSV, and generic CSV, when each is imported, then transactions and splits are successfully staged and committed to the ledger with accurate dates, amounts, and descriptions.
- Given an imported statement file of any format, when re-imported into the same account, then zero new transactions are committed and `dup_count` equals the total row count.
- Given an import containing transactions overlapping an existing date range in the ledger, when imported, then only genuine new transactions are committed and overlapping transactions are skipped as duplicates.
- Given a generic CSV file with custom header names or separate debit/credit columns, when parsed with a corresponding `CsvColumnMapping`, then rows are correctly extracted and converted into standard `ParsedStatementRow` records.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `packages/app/src/imports/import-statement.ts:50` -- verdict: medium -- route: patch -- `importStatementInput` omitted `"qif"` from format enum and dispatch, blocking imports using `qifParser` or format `"qif"`. Patched: added `"qif"` to schema and dispatch switch, and added integration tests.
- `packages/app/src/imports/import-statement.ts:252` -- verdict: medium -- route: patch -- `parseBuiltinUbankCsv` lacked 2-digit year support (`DD/MM/YY`), failing ubank statements with 2-digit years. Patched: added 2-digit year support matching `packages/importers` and test coverage.
- `packages/importers/src/parsers/` -- verdict: medium -- route: patch -- Statement parsers lacked UTF-8 BOM (`\uFEFF`) stripping, causing valid browser/Excel exports with BOM to fail header checks. Patched: added `content.replace(/^\uFEFF/, "")` across all parsers and tests.
- `packages/importers/src/parsers/qif.ts:74` -- verdict: low -- route: patch -- Trailing or empty QIF records delimited by `^` without date/amount threw validation error. Patched: skipped empty blocks cleanly and reset state.
- `packages/importers/src/parsers/generic-csv.ts:225` -- verdict: low -- route: patch -- Debit/credit parsing used `Math.abs` overriding explicit signs and mishandled explicit zero strings (`0.00`) in inactive columns. Patched: avoided `Math.abs` and parsed explicit signs with non-zero check.
- `packages/app/src/imports/import-statement.ts:43` -- verdict: low -- route: patch -- `csvColumnMappingSchema` permitted multi-character delimiter strings that did not match single-char scanner. Patched: restricted delimiter to single character via `z.string().length(1)`.
- `packages/app/src/imports/import-statement.test.ts:556` -- verdict: low -- route: patch -- Verification gaps: generic CSV `dateFormat: "MM/DD/YYYY"`, `memo` column concatenation, and builtin custom delimiter/headerless CSV lacked test assertions. Patched: added comprehensive test coverage for all three cases.
- `packages/app/src/imports/import-statement.ts:1` -- verdict: low -- route: false -- Claimed architectural duplication between `packages/app` and `packages/importers`. Refuted: monorepo dependency hierarchy prevents `@pangolin/app` from importing `@pangolin/importers`; `packages/app` provides fallback builtin parsers.
- `packages/importers/src/parsers/commbank-csv.ts:42` -- verdict: low -- route: false -- Claimed RFC-4180 multiline quoted field support needed. Refuted: bank statement exports in v1 do not produce multiline CSV fields.
- `packages/importers/src/parsers/qif.ts:81` -- verdict: low -- route: false -- Claimed US `MM/DD/YYYY` QIF format support required. Refuted: Australian QIF exports follow `DD/MM/YYYY`.
- `packages/importers/src/parsers/up-csv.ts:60` -- verdict: low -- route: false -- Claimed Up CSV timestamp should map to `externalId`. Refuted: Up CSV has no external ID column and transactions use calendar dates.

## Design Notes

Generic CSV mapping specification:
```ts
export interface CsvColumnMapping {
  readonly date: number | string;
  readonly dateFormat?: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD-MM-YYYY";
  readonly description: number | string;
  readonly amount?: number | string;
  readonly debit?: number | string;
  readonly credit?: number | string;
  readonly balance?: number | string;
  readonly externalId?: number | string;
  readonly memo?: number | string;
  readonly signConvention?: "normal" | "inverted";
  readonly hasHeader?: boolean;
  readonly delimiter?: string;
}
```

## Verification

**Commands:**
- `npx vitest run packages/importers` -- expected: all parser tests and committed fixture tests pass.
- `npx vitest run packages/app/src/imports` -- expected: all import, dedupe, and re-import idempotency tests pass across all formats.
- `node scripts/check-boundaries.ts` -- expected: clean boundary check with 0 violations.
- `pnpm biome check` -- expected: 0 lint or formatting errors.
