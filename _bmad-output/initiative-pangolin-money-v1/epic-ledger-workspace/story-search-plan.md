---
title: 'Search (FTS5 index, search API, list text filter, basic UI)'
type: 'feature'
ticket: '5'
created: '2026-10-07'
status: 'built'
baseline_revision: 'e9fa95c38e7285aa03846ec3f101599d67382c04'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter','edge-case-hunter','verification-gap','intent-alignment']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The ledger has no text search, so people cannot find a transaction by name, notes or amount, and a search must never reveal a hidden-name row to the partner.

**Approach:** Add an FTS5 index on transactions keyed on a stable integer and kept by triggers through table rebuilds, a search API, a `q` text filter on the list API that runs through the index, amount search by magnitude beside text matching, and a search box in the transactions list.

## Boundaries & Constraints

**Always:** A hidden-name row is excluded from the partner's results by every field (name, amount, notes), while its owner still finds it; exclusion is applied at query time from `projection.hidden` and also to counts, totals and summaries; sign is ignored in amount search; user input must never cause an FTS syntax error; keyset paging order is unchanged (the index is a filter, never the sort); the memory adapter matches the SQLite behaviour.

**Decisions:** The index covers description, notes, payee name, tags and split memos, so triggers also sit on the payee, tag-link and split tables and are recreated by any rebuild of them. A numeric query is OR'd with text matching: a row matches on text or on amount magnitude (`142.8` matches $142.80–$142.89).

**Never:** Rank-ordered results; 12.7's privacy-suite scenarios beyond swapping the pending `GET /api/ledger/search` manifest entry for a real one; storing visibility in the index; SQL naming scoped tables in non-test `.ts` files (raw-SQL read-rule guard).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Whole-dollar amount | `142` | Matches $142.00–$142.99, in and out; not $143.00 | No error expected |
| Exact amount | `142.85` | Matches only $142.85 | No error expected |
| Hidden by name, partner | Row's name hidden by owner | Never matches the partner by name, amount or notes | No error expected |
| Hidden, owner | Same row | Owner finds it by each | No error expected |
| Operator input | `"`, `*`, `AND`, empty | No FTS error; empty means no filter | Input quoted or rejected, never a 500 |
| Rebuild | Table rebuild migration | Index and triggers still match and fire | Migration fails if not |

</frozen-after-approval>

## Code Map

- `packages/db/migrations/0012_*.sql`, `meta/_journal.json` -- new migration: add `search_id` INTEGER (unique), backfill, create `txn_fts`, triggers on `transaction`, payee, tag-link and split tables (table names per `packages/db/src/schema`); hand-edit STRICT
- `packages/db/src/migrate.ts`, `strict-check.ts:15` -- the STRICT invariant would fail on FTS5 shadow tables; exempt them
- `packages/db/migrations/0009_ledger_classification_schema.sql:181-220` -- rebuild pattern that reassigns rowids and drops triggers; any rebuild must carry `search_id` and recreate triggers
- `packages/db/src/schema/transaction.ts:17-60` -- add `search_id`
- `packages/db/src/privacy.ts:43-85` -- `visibleTxn`; `projection.hidden` drives exclusion
- `packages/db/src/ledger-repos.ts:336-364` -- `filterConditions`: add FTS and amount-magnitude conditions; apply to counts and summaries too
- `packages/app/src/testing/memory-uow.ts:942` -- `filtered()` mirror; add matcher
- `packages/app/src/ports/unit-of-work.ts:446`, `ledger/transaction-query.ts:33,65,74`, `ledger/list-transactions.ts:79` -- add `q`; new `searchTransactions` use case; export in `packages/app/src/index.ts`
- `apps/server/src/http/app.ts:311-322` -- add `GET /api/ledger/search` beside the list route
- `apps/server/src/privacy/route-manifest.ts:339-346,447` -- swap pending entry for a `person` entry
- `apps/web/src/routes/search.ts:38-125`, `pages/TransactionList.tsx:87-136` -- `q` param in the validator and filters; search box in the filter bar
- `packages/db/src/raw-sql-read-rule.test.ts` -- keep FTS SQL in the `.sql` file or drizzle fragments

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db` migration 0012, schema, strict-check -- index over description, notes, payee name, tags and split memos, key, triggers on each source table, shadow-table exemption -- storage
- [ ] `packages/db/src/ledger-repos.ts`, `packages/app` filter, query parsing, memory adapter, `searchTransactions` -- search path with hidden exclusion and amount magnitude -- behaviour
- [ ] `apps/server/src/http/app.ts`, `route-manifest.ts` -- search route and manifest entry -- API
- [ ] `apps/web` `search.ts`, `TransactionList.tsx` -- `q` URL param and debounced search box -- UI
- [ ] Tests: `migrate.test.ts` (version 13, rebuild keeps index and triggers), `transaction-list-parity.test.ts`, `transaction-query.test.ts`, `ledger-repos.test.ts`, `app.test.ts`, web component test, e2e check -- I/O matrix rows

**Acceptance Criteria:**
- Given a hidden-name row, when the partner searches by name, amount or notes, then it never appears in rows, total or summary, and the owner finds it by each.
- Given $142.00, $142.99 (in and out) and $143.00, when searching `142`, then the first two match and not the third; `142.85` matches only $142.85.
- Given the index, when a rebuild migration runs, then search still matches and triggers still fire on insert, update and delete.
- Given a payee rename, a tag change or a split memo edit, when searching the new text, then the transaction is found and the old text no longer matches.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; high 0, medium 2, low 7, false 9, maybe-false 2)

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | Erased text lingers in `txn_fts_data` after DELETE; verified by probe (token present after delete, gone after `optimize`). Fix inside the db adapter's erase path, with a shadow-table scan test. |
| medium | patch | Payee reassignment, `split_tag` UPDATE and split moves never exercised, so a trigger missing those columns passes. |
| low | patch | No cap on term count; many prefix terms run a heavy scan on the single writer. |
| low | patch | SearchBox keeps stale text and re-applies q after Clear filters during a pending debounce; late echo resets typing. |
| low | defer | Punctuation-only `q` gives an unfiltered list with a filter chip; no feedback in the UI. |
| low | defer | `unicode61` and the memory tokenizer can disagree on non-Latin combining marks and letters like "ø". |
| low | defer | The reindex SELECT is copied into the backfill and every trigger; a missed copy fails silently on a future column. |
| low | defer | Deleted payees may still match by name (`deleted_at` not in the trigger's UPDATE OF list). |
| low | defer | Per-row triggers reindex whole transactions; a payee or tag rename reindexes every linked row. |
| low | defer | `/api/ledger/search` has no web client and `MAX_QUERY` is declared twice. |
| maybe-false | defer (low, rejected) | A zero-token phrase could raise an FTS error; parity tests cover operator input, so nothing shows it reachable. |
| maybe-false | defer (low, rejected) | `search_id` reuse after deleting the top row; the delete trigger fires first and a test pins it. |
| false | rejected | Missing strict-check exemption; SQLite reports FTS shadow tables as type `shadow`, which the check ignores. |
| false | rejected | Plan unfinished or drifting (Design Notes wording); a fix would edit the plan. |
| false | rejected | Memory `searchKeeps` with empty terms; unreachable because amount parsing needs digits. |
| false | rejected | Hard-coded schema versions, backfill DELETE no-op, nullable `search_id`, e2e notes gap; no demonstrated bad outcome. |

## Design Notes

FTS rowid is the explicit `search_id` column, never the table rowid, which the 0009-style rebuilds reassign. Quote every term and add a trailing `*` for prefix matching so the SQLite and memory matchers agree.

## Verification

**Commands:**
- `npx vitest run packages apps` -- expected: pass
- `pnpm -r typecheck` -- expected: pass
- `pnpm lint` -- expected: no new warnings
