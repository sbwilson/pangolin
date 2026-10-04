---
title: 'Ledger and classification schema'
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'built'
baseline_revision: '1697f3f044775c32fadbc2f3aaf5727f27d00033'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.1 built only the core columns of account, account_owner, transaction and split. Entries 4 and 5 (accounts, classify) cannot add use cases and routes until the rest of the schema, its repositories, ports and in-memory mirrors exist.

**Approach:** One migration adds the remaining tables and columns, turns the placeholder ids into foreign keys, and adds `review_item.account_id`'s foreign key. The same story creates every repository, port and memory unit-of-work stub the accounts, classify and ledger modules will fill, with no new use cases or routes.

## Boundaries & Constraints

**Always:** STRICT tables, ULID text ids, integer `_cents`/`_bp`, `created_at`/`updated_at` on every table, `deleted_at` on user-facing records (excluded from every read, kept for dedupe). `logo_attachment_id` and `property_id` stay nullable with no foreign key; every other `*_id` is a real foreign key. Repo reads take the viewer first and compose `visibleAccounts`/`visibleTxn`. The memory unit of work mirrors every new repo, including unique keys and visibility. Existing rows survive table rebuilds; `foreign_key_check` passes.

**Decisions:** `fingerprint` and `fingerprint_version` are NOT NULL: existing rows are backfilled and `createTransaction` computes a version-1 hash of account, date, amount and description (identical manual lines in one account collide on the unique index). Payee, payee_alias, tag and activity carry a nullable `scope_person_id` (FK person, owner-only scope) and a nullable `origin_account_id` (FK account, never serialised); both NULL means shared, and name uniqueness is a unique index per scope.

**Never:** No use cases, routes, UI or seeding of default categories (entry 4/5). No `import_batch`, `rule`, `suggestion`, `budget` tables (other epics). No change to migrations 0000–0008, auth tables or existing CLI commands. Account-scoped payee/alias/tag/activity data never appears in a row type as an origin account id (AD-18).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upgrade | DB at 0008 with accounts, transactions, a review item | Migrates to 0009, rows intact | `foreign_key_check` clean |
| Duplicate key | Two transactions, same `(account_id, external_id)` or `(account_id, fingerprint)` | Second insert rejected | Unique violation |
| Review item FK | Insert `review_item` with unknown `account_id` | Rejected | FK violation |
| Name per scope | Same payee name in shared scope and in an owner's scope | Both allowed; same name twice in one scope rejected | Unique violation |
| Soft delete | Soft-deleted category or payee | Excluded from every repo read | No error expected |
| Memory mirror | Same sequence on SQLite repos and memory repos | Same results | No error expected |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/{account,transaction,split,review-item}.ts`, `schema/index.ts` -- add columns and `references`; one new file per new table (kebab-case).
- `packages/db/migrations/0009_*.sql`, `meta/0009_snapshot.json`, `_journal.json` -- from `pnpm --filter @pangolin/db db:generate`; hand-add `) STRICT;` and named CHECKs; no BEGIN/COMMIT; table rebuilds for `transaction`, `split`, `review_item` (recreate indexes and CHECKs, e.g. `review_item_dedupe_key_open_idx`, `review_item_resolution`, `review_item_scope`).
- `packages/db/src/ledger-repos.ts`, `review-item-repo.ts`, `unit-of-work.ts` -- `createXRepo(orm, check)` pattern; wire into `txRepos()` and the `read` block.
- `packages/app/src/ports/unit-of-work.ts`, `testing/memory-uow.ts` -- row types, repo interfaces, `TxRepos`/`ReadRepos`, `MemoryState`.
- `packages/app/src/{accounts,ledger}/create-account.ts`, `create-transaction.ts` -- supply the new NOT NULL columns.
- `packages/db/src/migrate.test.ts` -- migration names and `schemaVersion` 9→10 (four places).
- `packages/db/src/review-item-repo.test.ts` -- uses `accountId: "acc1"`; needs real accounts under the new FK.
- `tools/seed`, `apps/server/src/admin/seed.ts` -- keep the seed working with the new columns.
- Repos to create: institution, balance_snapshot, transfer_group, category_group, category, tag (+split_tag), activity, payee, payee_alias, tax_category; extend account and transaction repos.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db` schema, migration 0009, `migrate.test.ts`, `review-item-repo.test.ts` -- data layer
- [ ] `packages/db` repos plus tests on real SQLite (STRICT, unique keys, FK, soft delete, upgrade from 0008 with rows)
- [ ] `packages/app` ports, memory UoW, use-case and seed adjustments -- mirrors and callers
- [ ] Tests asserting memory and SQLite repos agree on the matrix rows

**Acceptance Criteria:**
- Given a database at migration 0008 with data, when migrated, then 0009 applies, rows are intact and `check:upgrade`, `check:strict` and `db:generate` plus `git diff --exit-code` pass.
- Given the full test run, when it finishes, then lint, typecheck and the 2.1 e2e-relevant unit tests still pass.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 3 medium, 2 low patches; 11 deferred; 5 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | Audit-rollback test no longer reaches the audit failure: second call is an identical line, so it dies on the unique fingerprint first (verification-gap, pre-verified). |
| medium | patch | No test pins `createTransaction`'s fingerprint, version or duplicate rejection (verification-gap). |
| medium | patch | Identical manual line leaks a raw unique-constraint error (blind, edge-case, verification-gap); map to `Conflict`. |
| low | patch | Test `forPrivateSplitAsOther` uses a non-existent split id, so the private-split exclusion is untested. |
| medium | defer | Scoped-row `softDelete`/`attach` take no viewer or scope check (AD-18 write path); no caller exists yet, entries 4 and 5 must check visibility first. |
| medium | defer | Memory mirror enforces fewer CHECKs than SQLite; parity covers the matrix rows only. |
| low | defer | v0 backfilled fingerprints never match v1 lines; description not normalised in v1; hand-rolled SHA-256 lacks a node:crypto cross-check. |
| low | defer | `./testing/memory-uow` is now a public package export. |
| low | defer | No date-order CHECKs, case-sensitive name uniqueness, no `balance_snapshot` uniqueness, missing FK indexes, soft-delete of referenced parents, scope/origin mismatch, `visibleTxn` exposes `payeeId` of scoped payee. |
| false | reject | Migration aborts on dangling pre-existing ids: those columns were never written before 0009 (2.1 wrote none). |
| false | reject | Seed not verified/changed: seed goes through `createAccount`/`createTransaction`; `seed.test.ts` and e2e unit tests pass. |
| false | reject | `import_id` has no FK against the Always clause: no `import_batch` table exists, Design Notes record the exception. |
| false | reject | Plan file stale, malformed doc comment: plan edits and cosmetics are out of scope for a fix. |

## Design Notes

Soft delete (`deleted_at`) on institution, category, tag, activity, payee and payee_alias; not on category_group, tax_category, balance_snapshot, transfer_group or the join tables. `performed_by` and `name_hidden_by` reference `person`. `deductible_bp` is checked 0..10000. `import_id` has no FK until the import epic adds `import_batch`. Default categories are not seeded here.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green (known unrelated failures: `deploy/install.test.ts` x2, `backup.test.ts` restic timeout)
- `pnpm check:strict && pnpm check:upgrade` -- expected: green
- `pnpm --filter @pangolin/db db:generate` -- expected: no schema changes

