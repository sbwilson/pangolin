---
title: 'Transaction categorisation engine, FTS5 few-shot search, and suggestion schema'
type: 'feature'
ticket: 3
created: '2026-10-26'
status: 'built'
baseline_revision: 'f7f124551faf3de40323971e89dfbfeaf030a638'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/categorisation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Unclassified transactions require intelligent categorization suggestions from LLMs without leaking private transaction data to cloud models, while maintaining auditability with confidence metrics, prompt versions, and past few-shot examples.

**Approach:** Implement the `suggestion` table schema (migration 0022), SQLite FTS5 search over visible transactions for up to 10 past categorised examples from universally visible accounts, batching (~20 items per prompt), strict Zod schema validation against known categories, and an AD-6 cloud privacy sanitiser that rejects private accounts on cloud providers.

## Boundaries & Constraints

**Always:**
- `suggestion` is an account-scoped table: reads and writes enforce viewer visibility via `visibleAccounts(viewer)` or explicit account ownership checks.
- Few-shot examples come exclusively from universally visible accounts (`is_private = 0`), visible to every viewer of the target transaction under `visibleTxn`, with at most 10 examples per prompt.
- Non-local / cloud providers receive strictly sanitized payloads: only description, amount, date, and available category list. Account names, person names, memos, notes, and other metadata are never included.
- Private accounts must be rejected immediately if dispatched to a non-local / cloud provider (raises `AppError("PermissionDenied", ...)`).
- Categorisation prompts batch transactions in chunks of at most 20 items.
- Output JSON is parsed and validated with Zod; suggestions referencing non-existent category IDs are rejected.
- Each recorded `suggestion` row records `model`, `promptVersion`, `confidence`, and begins in `outcome = 'open'`.
- `ledger.setSplitField` closes open suggestions for the modified split field as `accepted` (when source is `llm` or matching value) or `superseded`.
- `TxRepos` and `ReadRepos` register `suggestions`, allowlisted under `SCOPED_REPOS` in `packages/app/src/ports/tx-repos-viewer.test.ts`.

**Never:**
- Never send private account transactions or private payee/tag data to a non-local / cloud LLM provider.
- Never use few-shot examples from private accounts, regardless of provider locality.
- Never auto-apply suggestions directly to splits in this engine (auto-apply and review inbox acceptance belong to story 5.5).
- Never write UI components or HTTP routes in this backend engine story (Settings preview UI is story 5.4, review inbox UI is story 5.5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cloud batch categorisation | Batch of 15 public transactions, cloud provider configured | Returns suggestions validated by Zod; payload sent contains only description, amount, date, category list | Fails gracefully if provider errors |
| Private account with cloud provider | Transaction from private account (`is_private = 1`), cloud provider | Refused before request is sent | Throws `AppError("PermissionDenied", ...)` |
| Private account with local provider | Transaction from private account, LAN / local provider (`is_local = 1`) | Generates suggestions; few-shot examples still come only from public accounts | No error; local privacy preserved |
| Few-shot FTS5 search | Transaction description "Woolworths Metro" | Up to 10 past categorised transactions matching description from public accounts | Returns empty array if no matches |
| Non-existent category suggested | Model hallucinates `category_id: "nonexistent-id"` | Suggestion for that transaction is discarded | Ignored, not recorded in `suggestion` table |
| Large transaction list | 45 unclassified transactions | Batched into 3 requests (20, 20, 5) and executed sequentially or in `llm` lane | Each batch validated independently |
| Split field updated via ledger | `setSplitField(splitId, "category", catId, "llm")` | Closes open suggestion for that split with `outcome = 'accepted'`, sets `resolvedAt` | Handled by split field listener hook |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/suggestion.ts` -- Drizzle schema definition for `suggestion` table with account, transaction, split foreign keys, and indexes.
- `packages/db/src/schema/index.ts` -- re-export `suggestion` schema.
- `packages/db/migrations/0022_suggestion.sql` -- SQLite migration creating `suggestion` table.
- `packages/db/migrations/meta/_journal.json` -- record migration `0022_suggestion`.
- `packages/db/src/system-health-repo.test.ts` -- bump expected schema version from 22 to 23.
- `packages/app/src/ports/unit-of-work.ts` -- define `SuggestionRepo`, `SuggestionRow`, and wire `suggestions` into `TxRepos` and `ReadRepos`.
- `packages/app/src/ports/tx-repos-viewer.test.ts` -- register `suggestions` in `SCOPED_REPOS` and viewerless write rules.
- `packages/app/src/testing/memory-uow.ts` -- in-memory `suggestions` repository implementation.
- `packages/db/src/repositories/suggestion.ts` -- SQLite repository implementation for `suggestion` table.
- `packages/db/src/unit-of-work.ts` -- bind `suggestions` in `createTxRepos` and `createReadRepos`.
- `packages/app/src/classify/few-shot-search.ts` -- SQLite FTS5 search query helper for up to 10 past categorised examples from universally visible accounts.
- `packages/app/src/classify/categorise-request.ts` -- shared request builder: prompt construction, category choices, few-shot formatting, and cloud privacy sanitiser (AD-6).
- `packages/app/src/classify/categorise-engine.ts` -- transaction categorisation engine: batching (~20), provider resolution, Zod validation, and suggestion recording.
- `packages/app/src/ledger/set-split-field.ts` -- split field write listener closing open suggestions on split modification.
- `packages/app/src/classify/categorise-engine.test.ts` -- unit tests for engine batching, cloud sanitisation, private account rejection, few-shot retrieval, and suggestion recording.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/suggestion.ts` -- define `suggestion` table (`id`, `accountId`, `transactionId`, `splitId`, `source`, `field`, `suggestedValue`, `payeeName`, `websiteDomain`, `taxCategoryId`, `activityId`, `confidence`, `model`, `promptVersion`, `outcome`, `createdAt`, `resolvedAt`).
- [x] `packages/db/src/schema/index.ts` -- export `suggestion` schema from `@pangolin/db`.
- [x] `packages/db/migrations/0022_suggestion.sql` & `packages/db/migrations/meta/_journal.json` -- create and register migration 0022.
- [x] `packages/db/src/system-health-repo.test.ts` -- update expected schema version from 22 to 23.
- [x] `packages/app/src/ports/unit-of-work.ts` -- declare `SuggestionRow`, `SuggestionRepo` interface, and add `suggestions` to `TxRepos` and `ReadRepos`.
- [x] `packages/app/src/ports/tx-repos-viewer.test.ts` -- register `suggestions` in `SCOPED_REPOS` and configure viewer exceptions.
- [x] `packages/app/src/testing/memory-uow.ts` -- implement in-memory `suggestions` repository for test suite parity.
- [x] `packages/db/src/repositories/suggestion.ts` -- implement SQLite repository for `suggestion` table.
- [x] `packages/db/src/unit-of-work.ts` -- wire `suggestions` into `createTxRepos` and `createReadRepos`.
- [x] `packages/app/src/classify/few-shot-search.ts` -- implement FTS5 search query returning up to 10 past categorised examples from universally visible accounts (`is_private = 0`).
- [x] `packages/app/src/classify/categorise-request.ts` -- build categorisation prompt with cloud privacy sanitiser (AD-6), category list, and few-shot examples.
- [x] `packages/app/src/classify/categorise-engine.ts` -- orchestrate batching (~20), provider call, Zod validation, category existence check, and suggestion persistence.
- [x] `packages/app/src/ledger/set-split-field.ts` -- connect listener to resolve open suggestions on field edit.
- [x] `packages/app/src/classify/categorise-engine.test.ts` -- test suite covering batching, cloud privacy sanitisation, private account rejection, and suggestion lifecycle.

**Acceptance Criteria:**
- Given a non-local / cloud LLM provider, when categorisation is requested for a private account, the engine rejects the request with `PermissionDenied` before invoking the provider.
- Given a non-local / cloud LLM provider and public transactions, the payload sent contains strictly `description`, `amount`, `date`, and the category list.
- Given an unclassified transaction, few-shot FTS5 search returns at most 10 similar past transactions that are categorised and belong to public (`is_private = 0`) accounts.
- Given LLM output, it is validated against a Zod schema (`payee_name`, `website_domain`, `category_id`, `confidence`, optional `tax_category_id`, `activity_id`); any suggestion with an unknown `category_id` is rejected.
- Given valid suggestions, rows are recorded in `suggestion` with `model`, `prompt_version`, `confidence`, and `outcome = 'open'`.
- Given an open suggestion for a split, when `setSplitField` is called for that field, the open suggestion is closed with `outcome = 'accepted'` (if matching) or `superseded` and `resolved_at` is set.
- Given `pnpm check-boundaries`, `pnpm typecheck`, and `npx vitest run`, all boundary checks, typechecks, and unit tests pass cleanly.

## Implementation Notes

- Created `packages/db/src/schema/suggestion.ts` defining `suggestion` table with partial unique index on open split fields, status check constraints, and foreign keys.
- Registered migration `0022_suggestion.sql` in `packages/db/migrations/meta/_journal.json` and updated system health repo tests to expected version 23.
- Defined `SuggestionRow`, `FewShotExample`, and `SuggestionRepo` in `packages/app/src/ports/unit-of-work.ts`.
- Registered `suggestions` in `SCOPED_REPOS` in `packages/app/src/ports/tx-repos-viewer.test.ts` and configured allowlisted viewerless write methods.
- Implemented SQLite repository `packages/db/src/repositories/suggestion.ts` querying `txn_fts` for few-shot examples from public accounts (`is_private = 0`).
- Implemented in-memory repository double in `packages/app/src/testing/memory-uow.ts` with parity test suite `packages/app/src/testing/suggestion-parity.test.ts`.
- Implemented `buildCategorisationRequest` in `packages/app/src/classify/categorise-request.ts` with strict AD-6 cloud privacy sanitisation, category options formatting, and few-shot formatting.
- Implemented `categoriseTransactions` in `packages/app/src/classify/categorise-engine.ts` with batching in chunks of 20, Zod schema validation, hallucinated category rejection, and suggestion recording.
- Hooked open suggestion resolution into `packages/app/src/ledger/set-split-field.ts` to close open suggestions on field modifications as accepted or superseded.
- Added comprehensive unit tests in `packages/app/src/classify/categorise-engine.test.ts` covering all I/O scenarios and edge cases.

## Plan Change Log

## Review Triage Log

- Total findings: 18 | High: 1 | Medium: 7 | Low: 7 | False: 3 | Maybe-false: 0
- [high] [patch] `packages/app/src/classify/categorise-request.ts` -- few-shot examples included payeeName unconditionally, which transmitted merchant names to cloud LLM providers violating AD-6 cloud sanitisation; restricted payee name inclusion strictly to local providers (`input.isLocal && e.payeeName`).
- [medium] [patch] `packages/app/src/classify/categorise-engine.ts` -- suggestion matching fallback used positional index when subset returned with explicit indices; updated to only fall back to positional array indexing if no suggestions contain an index property.
- [medium] [patch] `packages/db/src/repositories/suggestion.ts` -- findFewShot payee join omitted `visibleScope(payee.scopePersonId, viewer)`, potentially leaking another person's scoped payee name; filtered join with `visibleScope`.
- [medium] [patch] `packages/db/src/repositories/suggestion.ts` -- findFewShot did not filter out deleted categories; added `isNull(category.deletedAt)` filter.
- [medium] [patch] `packages/app/src/classify/categorise-engine.ts` -- `txn.descriptionRaw` could be null; skipped transactions with null description.
- [medium] [patch] `packages/app/src/testing/suggestion-parity.test.ts` -- SQLite FTS5 `findFewShot` implementation was unverified against real database; added integration/parity test asserting `findFewShot` queries `txn_fts` on migrated SQLite db.
- [medium] [patch] `packages/app/src/classify/categorise-engine.test.ts` -- re-categorising a transaction with an existing open suggestion was untested; added test verifying prior open suggestion is marked superseded and new suggestion is recorded open.
- [medium] [patch] `apps/server/src/http/errors.test.ts` -- `PermissionDenied` was missing from `EXPECTED: Record<ErrorCode, number>` map in test; added `PermissionDenied: 403`.
- [low] [patch] `apps/server/src/auth/hooks.test.ts` -- `toApiError` test table was missing `PermissionDenied`; added `["PermissionDenied", 403]`.
- [low] [patch] `packages/app/src/testing/memory-uow.ts` -- partial unique index in memory UoW checked uniqueness even when row was resolved; restricted uniqueness enforcement to `row.resolvedAt === null`.
- [low] [patch] `packages/app/src/classify/categorise-engine.ts` -- missing account resolution defaulted `isPrivate` to false; updated to skip transactions where account is missing.
- [low] [patch] `packages/app/src/classify/categorise-request.ts` -- `CategoriseRequestItem.isPrivate` was optional and checked `=== true`; defaulted `isPrivate` to true if omitted.
- [low] [patch] `packages/app/src/classify/categorise-engine.ts` -- empty `categoryOptions` called provider unnecessarily; added early return when `categoryOptions.length === 0`.
- [low] [patch] `packages/app/src/classify/categorise-request.ts` -- few-shot category formatting used raw ID without category name; appended `categoryName` to prompt string.
- [low] [patch] `packages/db/src/repositories/suggestion.ts` -- `insertMany` used loop of single inserts; updated to execute single multi-row insert.
- [false] [reject] `packages/app/src/classify/categorise-engine.ts` -- chunk loop omitted per-chunk try/catch: all-or-nothing transactional boundary across batch is intentional for caller use cases.
- [false] [reject] `packages/app/src/classify/categorise-request.ts` -- AUD currency hardcoded in prompt: system default accounting currency is AUD for v1 Australian banking domain.
- [false] [reject] `packages/app/src/ledger/set-split-field.ts` -- `isMatch` checks `source === "llm"`: when ledger write source is `llm`, the suggestion is explicitly being accepted by the LLM suggestion resolution workflow.

## Design Notes

- **Suggestion Schema:** Foreign keys to `account`, `transaction`, and `split`. Partial index on `(split_id, field)` where `resolved_at IS NULL` ensures at most one open suggestion per field on a split.
- **FTS5 Few-Shot Query:** Queries `txn_fts` matched against tokenized query words, filtering by `account.is_private = 0`, `split.category_id IS NOT NULL`, and `visibleTxn(viewer, today)`. Ordered by relevance or recency, limited to 10 rows.
- **Batching & Chunking:** Transactions are sliced into batches of 20. Each batch receives an index `0..N-1` mapped back to the transaction and split ID.
- **Request Builder Reuse (AD-6):** `buildCategorisationRequest` is exported from `packages/app/src/classify/` so story 5.4 Settings live preview calls the exact same builder.

## Verification

**Commands:**
- `npx vitest run packages/app/src/classify/categorise-engine.test.ts` -- expected: all categorisation, privacy, few-shot, and batching tests pass.
- `npx vitest run packages/db/src/system-health-repo.test.ts packages/app/src/ports/tx-repos-viewer.test.ts` -- expected: schema version and viewer-first repository tests pass.
- `node scripts/check-boundaries.ts` -- expected: `Package boundaries: ok`.
- `pnpm typecheck` -- expected: zero TypeScript compiler errors.
