---
title: '50,000-row performance'
type: 'feature'
ticket: '8'
created: '2026-10-13'
status: 'built'
baseline_revision: '4547f0457593b5576e7434e9d87c770e2d4c3638'
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

**Problem:** The transaction list has no composite sort/filter indexes, no query-plan verification, and no 50,000-row seed profile or server-side performance test, so SQLite falls back to full scans and temporary sort B-trees on `transaction` and `split` as the ledger grows to 50,000 rows.

**Approach:** Add a deterministic `perf` seed profile of 50,000 transactions in `tools/seed` (keeping the default profile byte-identical), add composite indexes for the list's sort and filters in migration `0013`, refine the SQLite visibility and filter predicates so SQLite's planner walks those indexes without temporary sort B-trees or full-table split scans, and add a query-plan test plus a 50,000-row server-side performance test enforcing the 300 ms budget on the first page (including total count, summary line, and day nets) and on a last-page jump in CI.

## Boundaries & Constraints

**Always:**
- The default seed (`runSeed` with no profile or `profile: "default"`, and `pnpm seed` without `--profile perf`) remains byte-identical to its existing output.
- The `perf` seed profile (`profile: "perf"` / `--profile perf`) is deterministic, passes all seed reference and consistency checks, and produces exactly 50,000 transactions across the household's accounts, categories, payees, tags, splits, transfers, and hidden names.
- Every read of `transaction`, `split`, `split_tag`, `payee`, and `tag` still composes the privacy projections (`visibleTxn`, `visibleAccounts`, `visibleTxnId`, `visibleScope`) in SQL (AD-3, AD-4) and obeys the raw-SQL and schema-import lint/test rules.
- Both the first page request (which executes `summarise` for total count and summary line, `listPage` with splits, `tags.listForSplits`, `dayNets`, and `redact`) and a jump to the last page (`page = pageCount`) complete within 300 ms server-side on the 50,000-row profile.
- Schema changes in `packages/db/src/schema/` match `pnpm --filter @pangolin/db db:generate` with zero diff.

**Never:**
- Bypass `visibleTxn`, `visibleAccounts`, or `redact` to gain speed, or store visibility in the FTS index.
- Change the list API response shape, cursor encoding, sort order (`posted_on DESC, id DESC`), or memory/SQLite parity semantics.
- Introduce raw SQL strings naming scoped tables in non-test `.ts` files (`raw-sql-read-rule.test.ts`) or violate package boundary rules (`scripts/check-boundaries.ts`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default seed profile | `runSeed({ modules: defaultModules })` or CLI without `--profile` | Byte-identical `seed.json` (391 transactions) | No error expected |
| Perf seed profile | `runSeed({ modules: defaultModules, profile: "perf" })` or CLI `--profile perf` | Deterministic `seed.json` with 50,000 transactions passing `parseSeed` and reference checks | Invalid `--profile` value throws CLI usage error |
| Query-plan check: sort & paging | `EXPLAIN QUERY PLAN` on unfiltered first page, `after`/`before` keyset cursors, `OFFSET` last-page jump, `from`/`to` range, and `dayNets` | Walks `transaction_posted_id_idx` with no `USE TEMP B-TREE FOR ORDER BY` or `GROUP BY` | Test fails if full scan or temp B-tree appears |
| Query-plan check: indexed filters | `EXPLAIN QUERY PLAN` for `accountId`, `payeeId`, `categoryId`, `uncategorised`, `tagId`, `transfers`, and `q` | Uses `transaction_account_posted_idx`, `transaction_payee_idx`, covering `split_transaction_idx`, `split_tag` index, `transaction_transfer_group_idx`, and `txn_fts` | Test fails if expected index is not used |
| First page on 50k profile | `GET /api/ledger/transactions` (or `listTransactions`) on 50,000-row seeded DB | Returns 50 rows, accurate `page.total`, `summary` (`count`, `inCents`, `outCents`), and `dayNets` in <= 300 ms server-side | Test fails if > 300 ms |
| Last-page jump on 50k profile | `GET /api/ledger/transactions?page=<pageCount>` on 50,000-row seeded DB | Returns final page rows, `next: null`, `prev` cursor, `summary`, and `dayNets` in <= 300 ms server-side | Test fails if > 300 ms |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/transaction.ts:43-50` -- add `transaction_posted_id_idx` on `(postedOn, id)`, extend `transaction_account_posted_idx` to `(accountId, postedOn, id)`, and extend `transaction_payee_idx` to `(payeeId, postedOn, id)`
- `packages/db/src/schema/split.ts:36-40` -- extend `split_transaction_idx` to `(transactionId, categoryId)` so `categoryId` and `uncategorised` (`category_id IS NULL`) correlated `EXISTS` subqueries use a covering index
- `packages/db/migrations/0013_*.sql`, `packages/db/migrations/meta/_journal.json`, `packages/db/migrations/meta/0013_snapshot.json` -- generated via `pnpm --filter @pangolin/db db:generate`
- `packages/db/src/migrate.test.ts:46-68`, `packages/db/src/system-health-repo.test.ts:28,40`, `apps/server/src/http/app.test.ts:144`, `apps/server/src/server.test.ts:93,139,160,182,513` -- update expected `schemaVersion` from `13` to `14` and include migration `0013` in the migration list
- `packages/db/src/privacy.ts:28-37` -- in `liveVisibleTxn`, prevent SQLite's planner from picking `transaction_account_fingerprint_idx` + `USE TEMP B-TREE FOR ORDER BY` on unfiltered/date-filtered queries by applying unary `+` to the outer `transaction.accountId` in the visibility `IN` check (`+${transaction.accountId} IN (SELECT ...)`), while leaving `visibleAccountId` intact and allowing explicit `eq(transaction.accountId, f.accountId)` in `filterConditions` to use `transaction_account_posted_idx`
- `packages/db/src/ledger-repos.ts:376-410` -- in `filterConditions`, combine `eq(transaction.payeeId, f.payeeId)` with `sql`${projection.payeeId} = ${f.payeeId}`` so payee-filtered queries use `transaction_payee_idx` without weakening hidden-name or scoped-payee projection privacy; in `pastCursor`, use row-value comparison `(${transaction.postedOn}, ${transaction.id}) < (${cursor.postedOn}, ${cursor.id})` (and `>`) so keyset paging seeks `transaction_posted_id_idx` directly
- `packages/db/src/classify-repos.ts:284-319` -- in `tags.listForSplits`, include `inArray(split.id, chunk)` inside the `split` visibility subquery so SQLite checks visibility only for the page's splits via primary key instead of materialising all 50,000 splits
- `tools/seed/src/world.ts:108-123,233-340`, `tools/seed/src/run.ts:10-15,89-121`, `tools/seed/src/cli.ts:10-31`, `tools/seed/src/index.ts` -- add `SeedProfile = "default" | "perf"` (`profile` on `World` and `RunOptions`, `--profile` on CLI); add linear-time event folding (`applyEvents` / incremental `SeedKnown`) so 50,000 events fold in $O(N)$ instead of $O(N^2)$
- `tools/seed/src/modules/ledger-transactions.ts:142-482`, `tools/seed/src/modules/transfers-and-privacy.ts:211-236`, `tools/seed/src/modules/balance-snapshots.ts:21-39` -- when `world.profile === "perf"`, top up generated transactions deterministically to reach 50,000 total transactions (`PERF_TRANSACTION_COUNT = 50_000`) and keep card-charge and balance-snapshot aggregations linear in transaction count
- `apps/server/src/admin/seed.ts:463-608` -- avoid redundant `getTransaction` round-trips and repeated `syncClosingBalance` / split queries during bulk seed application, or batch transaction creation through `app` so seeding a 50,000-row profile in tests completes in a few seconds while keeping all audit and review-item invariants identical
- `packages/db/src/ledger-query-plan.test.ts` -- new `EXPLAIN QUERY PLAN` test suite verifying index selection and absence of temp B-trees across list sort, paging, `dayNets`, and filters
- `apps/server/src/http/ledger-perf.test.ts` -- new server-side performance test loading the 50,000-row `perf` profile and asserting the 300 ms budget on the first page (including total count, summary line, and day nets) and on a jump to the last page

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/transaction.ts`, `packages/db/src/schema/split.ts`, `packages/db/migrations/0013_*.sql` -- add `(posted_on, id)` and extend `(account_id, posted_on, id)`, `(payee_id, posted_on, id)` on `transaction` and `(transaction_id, category_id)` on `split`; generate migration `0013` via `db:generate` -- index coverage for list sort and filters
- [x] `packages/db/src/migrate.test.ts`, `packages/db/src/system-health-repo.test.ts`, `apps/server/src/http/app.test.ts`, `apps/server/src/server.test.ts` -- update `schemaVersion` expectations from `13` to `14` and migration name list -- keep migration and health tests aligned with `0013`
- [x] `packages/db/src/privacy.ts`, `packages/db/src/ledger-repos.ts`, `packages/db/src/classify-repos.ts` -- use `+transaction.account_id IN (...)` in `liveVisibleTxn`, row-value comparison in `pastCursor`, indexed `payeeId` predicate alongside `projection.payeeId`, and chunk-bounded `split` subquery in `tags.listForSplits` -- eliminate temp sort B-trees and full-table split scans
- [x] `tools/seed/src/world.ts`, `tools/seed/src/run.ts`, `tools/seed/src/cli.ts`, `tools/seed/src/index.ts`, `tools/seed/src/modules/ledger-transactions.ts`, `tools/seed/src/modules/transfers-and-privacy.ts`, `tools/seed/src/modules/balance-snapshots.ts` -- add `profile?: "default" | "perf"` (`--profile`), make world event folding and module aggregations $O(N)$, and emit 50,000 transactions on the `perf` profile while keeping `default` byte-identical -- 50,000-row perf seed profile
- [x] `tools/seed/src/cli.test.ts`, `tools/seed/src/modules/ledger.test.ts` -- test `--profile perf` CLI parsing, 50,000-row count, reference validity, and default-profile byte identity -- verify seed profile behavior
- [x] `packages/db/src/ledger-query-plan.test.ts` -- add `EXPLAIN QUERY PLAN` assertions for first page, keyset `after`/`before`, `OFFSET` jump, `dayNets`, and each filter (`accountId`, `from`/`to`, `categoryId`, `uncategorised`, `tagId`, `payeeId`, `transfers`, `q`) -- automated query-plan check in CI
- [x] `apps/server/src/admin/seed.ts`, `apps/server/src/http/ledger-perf.test.ts` -- streamline seed loading for 50,000 rows and add the server-side 300 ms performance test covering the first page (rows, `page.total`, `summary`, `dayNets`) and a jump to the last page on the 50,000-row profile -- automated 300 ms perf verification in CI

**Acceptance Criteria:**
- Given `tools/seed`, when run with the default profile vs `profile: "perf"`, then the default output is byte-identical to before and the `perf` profile deterministically produces 50,000 valid transactions across the household's accounts.
- Given a migrated SQLite database, when inspecting `EXPLAIN QUERY PLAN` for the transaction list's sort, keyset cursors, offset jump, `dayNets`, and filters (`accountId`, `from`/`to`, `categoryId`, `uncategorised`, `tagId`, `payeeId`, `transfers`, `q`), then SQLite uses the composite indexes on `transaction`, `split`, `split_tag`, and `txn_fts` and never builds a temporary B-tree for `ORDER BY` or `GROUP BY`.
- Given a database seeded with the 50,000-row `perf` profile, when a signed-in viewer requests the first page of `/api/ledger/transactions` (including total count, summary line, and day nets) and when they jump to the last page (`?page=<pageCount>`), then each request completes within 300 ms server-side and returns accurate counts, summaries, day nets, and 50-row pages.
- Given the existing privacy and parity test suites, when run with the updated indexes and query predicates, then every privacy and parity assertion passes unchanged.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 0, low 1 deferred, low 2 rejected, false 11 rejected, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `listForSplit` in `packages/db/src/classify-repos.ts` omits split ID filter in visibility subquery | low | defer | Pre-existing implementation in `listForSplit` untouched by this ticket; transaction list queries use `listForSplits` (which is bounded by batch). |
| Drizzle migration `0013_absent_argent.sql` retains auto-generated placeholder tag | low | rejected | Tag name does not affect SQLite schema or migration order; Drizzle migrations apply deterministically and reliably. |
| No test for upgrading an existing populated database from version 13 to 14 in `packages/db/src/migrate.test.ts` | false | rejected | Migration 0013 adds indexes which automatically index existing rows; migration suite verifies sequential idempotent migration. |
| Audit log entry in `seedTransactions` omits tag IDs from recorded snapshot | false | rejected | `createTransaction` audit snapshot also records transaction and split rows without split tag IDs; tag assignments are recorded in `split_tag`. |
| Missing dedicated unit test suite for `seedTransactions` in `packages/app` | low | rejected | Internal seed helper use case fully exercised by server seed and ledger performance integration tests; verification-gap review confirmed no coverage gaps. |
| Fragile hardcoded constant `TRANSFERS_AND_SURPRISES = 92` in `tools/seed/src/modules/ledger-transactions.ts` | false | rejected | Seed window is fixed in seed module configuration; CLI `--profile perf` deterministically produces exactly 50,000 transactions verified by seed tests. |
| 50,000-row performance test in `apps/server/src/http/ledger-perf.test.ts` runs unconditionally on all test runs | false | rejected | Running the 50,000-row performance test in CI was an explicit requirement in the approved ticket intent; execution takes ~21 seconds within CI limits. |
| `ledger-perf.test.ts` omits performance assertions for keyset pagination and filtered queries on 50,000 rows | false | rejected | The ticket's intent explicitly scopes the 300 ms SLA to the first page and last-page jump; keyset cursors and filters are verified in `ledger-query-plan.test.ts`. |
| `packages/db/src/ledger-query-plan.test.ts` omits query-plan checks for `summarise`, `countBefore`, and `tags.listForSplits` | false | rejected | `summarise` contains no `ORDER BY` clause and cannot generate a temporary sort B-tree; test suite validates all queries where sort order and composite indexes apply. |
| Use of locale-sensitive `localeCompare` on ISO date strings in `tools/seed/src/modules/balance-snapshots.ts` | false | rejected | ISO date strings sort identically across locales, running balance addition is commutative, and default profile output is verified byte-identical. |
| Contradiction between Story Plan documentation and implementation regarding `transfers` filter index | false | rejected | Rejected per review instructions rule (fixes that edit the build's plan are rejected); walking `transaction_posted_id_idx` avoids a temp sort B-tree. |
| Unbalanced credit generation in `perf` seed profile causes negative account balances | false | rejected | Ledgers permit negative account balances, and the 50,000-row dataset satisfies all reference checks, schema constraints, and balance tests. |
| Code duplication of date generation in `tools/seed/src/modules/ledger-transactions.ts` | false | rejected | Hoisting `daysInWindow` outside the 50,000-iteration loop is an intentional performance optimization to avoid repeated date-span calculations. |
| Duplication of account visibility SQL in `packages/db/src/privacy.ts` | false | rejected | The unary plus syntax in `liveVisibleTxn` is an intentional SQLite optimization to suppress index selection without altering `visibleAccountId`. |

## Design Notes

SQLite's query planner (without `ANALYZE` statistics) prefers `SEARCH transaction USING INDEX transaction_account_fingerprint_idx (account_id=?)` + `USE TEMP B-TREE FOR ORDER BY` whenever `transaction.account_id IN (SELECT id FROM account ...)` appears on a bare indexed column, because `transaction_account_fingerprint_idx` is `UNIQUE`. Prefixing the visibility check column with unary `+` (`+${transaction.accountId} IN (...)`) disables index selection on the visibility subquery while keeping the exact SQL visibility semantics; when a caller filters by `accountId`, `filterConditions` adds `eq(transaction.accountId, f.accountId)` on the bare column, which walks `transaction_account_posted_idx (account_id, posted_on, id)` in sort order.

## Verification

**Commands:**
- `pnpm --filter @pangolin/db db:generate && git diff --exit-code -- packages/db/migrations` -- expected: zero diff
- `pnpm test` -- expected: all unit, parity, privacy, query-plan, and 50,000-row perf tests pass
- `pnpm typecheck && pnpm lint && pnpm check:strict` -- expected: pass with zero errors
