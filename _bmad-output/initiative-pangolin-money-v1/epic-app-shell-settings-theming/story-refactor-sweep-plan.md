---
title: 'Refactor sweep'
type: 'refactor'
ticket: '7'
created: '2026-10-19'
status: 'done'
baseline_revision: 'd4d5611a69a16c4c23db5a077aa1ea32be77b944'
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

**Problem:** CI is currently failing on `develop` because the `Migrations match the schema` check fails (`0014_person_preference` was committed without its companion `0014_snapshot.json` in `packages/db/migrations/meta/`, causing `drizzle-kit generate` to generate a diff in CI). In addition, `TransactionList.tsx` has grown to over 1,000 lines with intertwined state concerns (URL filtering, bulk selection/undo, CSV export with reauth, and queries), `formatCents` is duplicated between `AccountSettings.tsx` and `TransactionsTable.tsx` rather than living in `lib/money.ts`, and deprecated `HomePage.tsx` remains in the tree.

**Approach:** Fix CI at the beginning by adding the missing `packages/db/migrations/meta/0014_snapshot.json`; decompose `TransactionList.tsx` into focused hooks (`useTransactionFilters`, `useBulkSelection`, `useTransactionExport`); extract and unify `formatCents` into `apps/web/src/lib/money.ts`; delete `HomePage.tsx`; verify architectural package boundaries; and ensure the full CI pipeline is green.

## Boundaries & Constraints

**Always:**
- Ensure `drizzle-kit generate` reports no schema diff against `packages/db/migrations`.
- Keep all existing user-visible behaviors, URL search parameter contracts, and accessibility attributes intact.
- Keep `formatCents` in `lib/money.ts` formatting cents without floating point arithmetic issues and supporting currency code (defaulting to `"AUD"`).
- Ensure `node scripts/check-boundaries.ts`, `biome check .`, the vitest test suite, and GitHub Actions CI pass with green status.

**Never:**
- Do not introduce server math or floating-point rounding errors into web money utilities.
- Do not alter the API contracts of `@pangolin/shared` or `@pangolin/app`.
- Do not introduce new dependencies or break CSP directives.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migration schema check | `pnpm --filter @pangolin/db db:generate` | "No schema changes, nothing to migrate", 0 diff | Fails if snapshot doesn't match schema |
| `formatCents` standard AUD | `formatCents(14285)` | `"$142.85"` | Returns formatted string |
| `formatCents` negative amount | `formatCents(-450)` | `"-$4.50"` | Retains negative sign |
| `formatCents` custom currency | `formatCents(1200, "USD")` | `"$12.00"` (or USD formatted representation) | Uses cached `Intl.NumberFormat` |
| `formatCents` zero | `formatCents(0)` | `"$0.00"` | Proper zero representation |
| Filter state manipulation | Date range change, query text, or chip filter toggle | Paging (`page`, `after`, `before`) reset; URL search updated | Invalid values filtered per `validateTransactionsSearch` |
| Bulk action selection & undo | Multi-selection across rows + bulk categorise/tag/shared | Updates rows, provides toast with Undo action restoring prior snapshots | Errors surface in `notice` state banner |
| CSV export with re-auth | Export click when server returns `ReauthRequired` | Opens `ReauthDialog`; retries export on password/passkey success | Catches `ApiError`, manages `isExporting` state |

</frozen-after-approval>

## Code Map

- `packages/db/migrations/meta/0014_snapshot.json` -- Drizzle-kit schema snapshot matching migration `0014_person_preference.sql` to satisfy CI `db:generate` check.
- `apps/web/src/lib/money.ts` -- Central money formatting and parsing utilities; add unified `formatCents`.
- `apps/web/src/lib/money.test.ts` -- Unit tests for money parsing and formatting; add tests for `formatCents`.
- `apps/web/src/pages/TransactionsTable.tsx` -- Re-export or import `formatCents` from `lib/money.ts`.
- `apps/web/src/pages/AccountsPage.tsx` -- Update `formatCents` import to `lib/money.ts`.
- `apps/web/src/pages/TransactionSheet.tsx` -- Update `formatCents` import to `lib/money.ts`.
- `apps/web/src/components/AccountSettings.tsx` -- Remove duplicate local `formatCents` and import from `lib/money.ts`.
- `apps/web/src/hooks/useTransactionFilters.ts` -- Extracted hook for URL search parameters, filter chips, date presets, and custom range state.
- `apps/web/src/hooks/useTransactionExport.ts` -- Extracted hook for CSV export execution, state, and `ReauthDialog` triggers.
- `apps/web/src/hooks/useBulkSelection.ts` -- Extracted hook for row selection (single, shift-range, select-all), bulk mutations, undo snapshots, and escape key listener.
- `apps/web/src/components/SearchBox.tsx` -- Extracted debounced search input component.
- `apps/web/src/pages/TransactionList.tsx` -- Decomposed orchestrator component integrating the hooks and rendering the UI layout.
- `apps/web/src/pages/HomePage.tsx` -- Deprecated page component; delete.
- `scripts/check-boundaries.ts` -- Monorepo architectural boundary checker.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/migrations/meta/0014_snapshot.json` -- Fix CI migration schema check -- Commit missing snapshot so `drizzle-kit generate` produces no diff in CI.
- [x] `apps/web/src/lib/money.ts` & `apps/web/src/lib/money.test.ts` -- Unify `formatCents` -- Add cached `Intl.NumberFormat` based `formatCents(cents, currency = "AUD")` and unit tests.
- [x] `apps/web/src/pages/TransactionsTable.tsx`, `AccountsPage.tsx`, `TransactionSheet.tsx`, `AccountSettings.tsx` -- Update `formatCents` imports -- Replace local definitions and imports to point to `lib/money.ts`.
- [x] `apps/web/src/pages/HomePage.tsx` -- Delete deprecated file -- Remove obsolete page superseded by Settings and transactions redirect.
- [x] `apps/web/src/hooks/useTransactionFilters.ts` -- Extract filter and date-range hook -- Manage search state, debouncing, presets, and pagination helpers.
- [x] `apps/web/src/hooks/useTransactionExport.ts` -- Extract CSV export hook -- Manage export in-flight state and reauth trigger.
- [x] `apps/web/src/hooks/useBulkSelection.ts` -- Extract bulk selection & undo hook -- Manage selection sets, bulk popovers, mutations, undo snapshots, and keyboard shortcuts.
- [x] `apps/web/src/components/SearchBox.tsx` -- Extract SearchBox component -- Clean modular debounced search input component.
- [x] `apps/web/src/pages/TransactionList.tsx` -- Refactor to use extracted hooks -- Reduce component complexity while maintaining identical behavior.
- [x] `scripts/check-boundaries.ts` & test suites -- Verify boundaries and tests -- Run boundary checks, biome check, and vitest suite.
- [x] CI Verification -- Verify CI is green -- Run full local verification checks, push changes, and verify GitHub Actions CI run completes with success status.

**Acceptance Criteria:**
- Given `pnpm --filter @pangolin/db db:generate`, it reports "No schema changes, nothing to migrate" with zero git diff in `packages/db/migrations`.
- Given a currency amount in cents, `formatCents` formats it correctly according to currency and locale.
- Given `TransactionList`, all filter interactions (chips, date ranges, search query, clearing, paging) function identically with tests passing.
- Given `TransactionList`, bulk actions (categorise, tag, mark shared) and undo functionality work without regressions.
- Given CSV export, requiring re-auth displays `ReauthDialog` and retries export upon success.
- Given the codebase, `HomePage.tsx` is removed and no broken imports remain.
- Given package boundary rules, `node scripts/check-boundaries.ts` passes with exit code 0.
- Given quality checks, `biome check .` and `./node_modules/.bin/vitest run apps/web` pass cleanly.
- Given GitHub Actions CI, all jobs (Lint, types, tests, STRICT, Container, e2e, axe) pass and CI conclusion is green.

## Implementation Notes

- Added missing `packages/db/migrations/meta/0014_snapshot.json` to resolve `drizzle-kit generate` diff in CI. Verified with `drizzle-kit generate` that schema matches with 0 diff.
- Unified `formatCents` with cached `Intl.NumberFormat` instances in `apps/web/src/lib/money.ts`. Added comprehensive test suite in `apps/web/src/lib/money.test.ts`.
- Updated all references across `AccountsPage.tsx`, `TransactionSheet.tsx`, `TransactionsTable.tsx`, and `AccountSettings.tsx` to use the unified `formatCents` utility.
- Deleted obsolete `apps/web/src/pages/HomePage.tsx`.
- Extracted `SearchBox` component into `apps/web/src/components/SearchBox.tsx`.
- Extracted `useTransactionFilters` hook into `apps/web/src/hooks/useTransactionFilters.ts`.
- Extracted `useTransactionExport` hook into `apps/web/src/hooks/useTransactionExport.ts`.
- Extracted `useBulkSelection` hook into `apps/web/src/hooks/useBulkSelection.ts`.
- Refactored `apps/web/src/pages/TransactionList.tsx` to consume the extracted hooks and component, reducing file size from >1,000 lines to ~580 lines with clean separation of concerns and exact behavioral parity.
- Verified package boundaries (`node scripts/check-boundaries.ts`), strict table mode (`node packages/db/src/cli/check-strict.ts`), linter (`biome check .`), and vitest suites for `apps/web` (207 passed) and `packages/` (803 passed).

## Plan Change Log

## Review Triage Log

- Total findings: 12 (Blind Hunter: 12, Edge Case Hunter: 0, Verification Gap: 0, Intent Alignment: 0)
- Verdict counts: High: 0, Medium: 0, Low: 7, False: 5, Maybe-false: 0
- Action counts: Patch: 4, Defer: 3, Reject: 5

| Finding | Lens | Verdict | Route | Evidence |
|---|---|---|---|---|
| Missing unit test coverage for newly extracted hooks | blind-hunter | low | defer | Existing integration test suite `TransactionList.test.tsx` (25 tests) verifies all behaviors; dedicated hook unit tests deferred to future test coverage sweep. |
| Loss of type safety in `useBulkSelection` options (`listSearch: unknown`) | blind-hunter | low | patch | Patched `listSearch: TransactionsSearch` in `UseBulkSelectionOptions` with proper type import. |
| Missing double-invocation / concurrency guard in `useTransactionExport` | blind-hunter | low | patch | Patched `isExportingRef` in `useTransactionExport` for immediate synchronous re-entrancy prevention. |
| Partial failure leaves un-undoable mutations in `runBulkAction` | blind-hunter | low | defer | Pre-existing logic faithfully retained from original `TransactionList.tsx`; transactional batch rollback deferred. |
| `withChanges` in `useTransactionFilters.ts` omits validation on merged result | blind-hunter | false | reject | TanStack router validates search parameters via route definition `validateSearch: validateTransactionsSearch`. |
| Leak of internal state `today` in `useTransactionFilters` API | blind-hunter | low | patch | Patched `useTransactionFilters` to remove unused `today` property from public hook return object. |
| Unvalidated currency casing in `formatCents` | blind-hunter | low | patch | Patched `formatCents` to normalize `currency.toUpperCase()` and added unit test. |
| Unbounded map growth in `FORMATTERS` cache | blind-hunter | false | reject | Currencies in Pangolin are controlled by account records and ISO standards, not arbitrary user inputs. |
| `SearchBox` resetKey handler can preserve stale query text | blind-hunter | false | reject | `TransactionList.test.tsx` contains 4 explicit tests validating debounce cancellation and prompt resetting on clear filters. |
| Global Escape key listener in `useBulkSelection` conflicts with dialogs/sheets | blind-hunter | low | defer | Exact behavior preserved from pre-refactor `TransactionList.tsx`; refined focus coordination deferred. |
| Incomplete cache invalidation on bulk mutations in `useBulkSelection` | blind-hunter | false | reject | Summary metrics are part of the `["ledger", "transactions"]` query payload, so invalidating transactions invalidates summary. |
| `effectiveSearch` calculated by `useTransactionFilters` is bypassed by `TransactionList` | blind-hunter | false | reject | When `accountId` is pinned, the Account dropdown is hidden, and all other filter parameters match `search` and `effectiveSearch`. |

## Design Notes

Decomposing `TransactionList.tsx` into modular hooks separates four orthogonal concerns:
1. **Search & Filter State:** `useTransactionFilters` encapsulates TanStack Router search param manipulation, date range preset calculations, and page reset rules.
2. **Bulk Selection & Mutations:** `useBulkSelection` encapsulates row selection mechanics (including shift-click ranges), batch split updates, snapshot generation for undo, and escape key dismissals.
3. **Export Execution:** `useTransactionExport` isolates CSV generation, download link creation, and re-authentication dialog orchestration.
4. **Presentation:** `TransactionList.tsx` focuses strictly on layout structure and wiring props between the hooks and child components (`TransactionsTable`, `TransactionSheet`, toolbar).

In addition, providing `packages/db/migrations/meta/0014_snapshot.json` aligns drizzle-kit's internal metadata snapshot with the existing `0014_person_preference.sql` migration, removing the spurious drift reported during CI schema checks.

## Verification

**Commands:**
- `pnpm --filter @pangolin/db db:generate && git diff --exit-code -- packages/db/migrations` -- expected: 0 diff, nothing to migrate
- `node packages/db/src/cli/check-strict.ts` -- expected: All tables are STRICT
- `node scripts/check-boundaries.ts` -- expected: `Package boundaries: ok`
- `./node_modules/.bin/biome check .` -- expected: Clean lint check
- `./node_modules/.bin/vitest run apps/web` -- expected: All unit tests pass
- `gh run list --limit 1` (after push) -- expected: CI conclusion `success`
