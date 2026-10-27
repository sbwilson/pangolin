---
title: 'Refactor sweep'
type: 'refactor'
ticket: 9
created: '2026-10-14'
status: done
baseline_revision: 'ae5a7afe578d11667e4de63712dff75fbb9c4e2c'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 12's build records and review findings, alongside epic 2's retrospective deferrals (A2–A4, I8, P10), leave small architectural debts: an import cycle between ledger view and list, generic Zod schemas in the accounts module, divergent private-owner lookups with plain 500 errors, import-time `needs_review` listener registration, missing system-viewer scope guards on private accounts, a table-scanning subquery in `listForSplit`, duplicated search query bounds, and minor frontend state edge cases in `TransactionList` and `RootLayout`.

**Approach:** Clean up this bounded set of 10 traceable items with zero external behavior regression, keeping types, linter, and the full test suite green after every change.

## Boundaries & Constraints

**Always:**
- Cleanup only: existing route endpoints, schemas, responses, error payloads, and HTTP statuses remain identical except where a typed `AppError` replaces a bare 500 `Error` (items 3 and 5).
- Every change traces to a named build record or deferred finding of this epic or to epic 2 retrospective deferrals A2–A4, I8, and P10.
- All 10 items in scope:
  1. **A2 (Import cycle):** Break `packages/app/src/ledger/transaction-view.ts` <-> `packages/app/src/ledger/list-transactions.ts` cycle by moving `LedgerTransaction`, `LedgerSplit`, and related types into `packages/app/src/ledger/types.ts`.
  2. **A3 (Generic Zod inputs):** Extract `dayInput` and `idInput` from `packages/app/src/accounts/inputs.ts` to `packages/app/src/inputs.ts`; update imports across `accounts`, `ledger` (`hide-name.ts`, `transfer-groups.ts`, `transaction-query.ts`), and `classify` modules to remove duplicate definitions.
  3. **A4 (Unified private owner lookup):** Unify `privateOwner` in `packages/app/src/ledger/split-targets.ts`, `create-transaction.ts`, and `scope.ts` to throw `AppError("Conflict", "This account has no owner")` on an ownerless private account instead of bare `Error`.
  4. **I8 (Explicit needs_review sync registration):** Replace side-effect `import "./needs-review.ts"` in `create-transaction.ts`, `update-transaction.ts`, `set-splits.ts`, `set-split-field.ts`, and `split-tags.ts` with explicit registration (`registerTransactionNeedsReviewSync()`) executed at application startup/initialization.
  5. **P10 (System-viewer scope guard on private accounts):** In `create-transaction.ts` and `split-tags.ts`, prevent the system viewer from attaching person X's scoped payee or tag to person Y's private account (`Conflict`).
  6. **12.8 / classify-repos listForSplit query:** In `packages/db/src/classify-repos.ts:345`, bound the `split` subquery with `eq(split.id, splitId)` to avoid evaluating all visible splits.
  7. **12.5 / search query length bound:** Move `SEARCH_QUERY_MAX = 200` into `packages/shared/src/index.ts` so `apps/web/src/routes/search.ts` (`MAX_QUERY`) and `packages/app/src/ledger/search-query.ts` share the single constant.
  8. **12.4 / account screens stray param:** In `apps/web/src/pages/TransactionList.tsx`, strip stray `search.account` when `accountId` is passed so `hasFilters` and `hasClearableFilters` reflect only active filters on `/accounts/:id`.
  9. **12.1 / RootLayout gate precedence:** Extract `selectGate(me, pathname)` into a pure function with node unit tests, normalize trailing slashes on `/setup` and `/recover`, and memoize session context in `apps/web/src/RootLayout.tsx`.
  10. **12.1 / Theme tokens:** Add missing shadcn tokens (`--destructive`, `--destructive-foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--secondary`, `--secondary-foreground`) and `@theme inline` mappings in `apps/web/src/styles.css`.

**Never:**
- No database migrations or schema alterations.
- No changes to product-level privacy rules (AD-3, AD-7, AD-22).
- Large god-class splits (A5: `memory-uow.ts`, `unit-of-work.ts`, `http/app.ts`) and architectural reconciliations (A6 domain rules, A7 test conventions, A8 memory UoW privacy mirror) stay deferred to epic 13 / subsequent architecture sweeps.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Private account without owner | `privateOwner` called on private account with empty owner list | Throws `AppError("Conflict", "This account has no owner")` | HTTP 409 Conflict |
| System viewer cross-scoped payee on private account | System viewer creates transaction on Person B private account with Person A scoped payee | Throws `AppError("Conflict", "This payee cannot be used on this private account")` | HTTP 409 Conflict |
| System viewer cross-scoped tag on private account | System viewer calls `setSplitTags` on Person B private account with Person A scoped tag | Throws `AppError("Conflict", "This tag cannot be used on this private account")` | HTTP 409 Conflict |
| Account detail with stray account param | `/accounts/acc1?account=acc2` loaded | Pinned `acc1` used, `hasClearableFilters` ignores `account=acc2` | Stray param stripped from clearable filters |
| RootLayout path with trailing slash | User visits `/setup/` or `/recover/` | Treated identically to `/setup` or `/recover` by `selectGate` | No redirect loop or gate mismatch |
| Single split tag query | `tags.listForSplit(viewer, splitId)` | Query filters inner split by `splitId` and `visibleTxnId` | Only checks target split |

</frozen-after-approval>

## Code Map

- `packages/app/src/ledger/types.ts` -- New file holding `LedgerTransaction`, `LedgerSplit`, and related query/view types extracted from `list-transactions.ts`.
- `packages/app/src/ledger/list-transactions.ts` -- Re-export types from `types.ts`, keep query and paging logic.
- `packages/app/src/ledger/transaction-view.ts` -- Import types from `types.ts`, breaking cycle with `list-transactions.ts`.
- `packages/app/src/inputs.ts` -- Shared input validation schemas (`dayInput`, `idInput`).
- `packages/app/src/accounts/inputs.ts` -- Re-export `dayInput` and `idInput` from `../inputs.ts`, keeping account-specific schemas.
- `packages/app/src/ledger/hide-name.ts`, `packages/app/src/ledger/transfer-groups.ts`, `packages/app/src/ledger/transaction-query.ts` -- Import `dayInput`/`idInput` from `../inputs.ts`.
- `packages/app/src/ledger/split-targets.ts` -- Update `privateOwner` to throw `AppError("Conflict")`.
- `packages/app/src/ledger/create-transaction.ts` -- Reuse `privateOwner`, add P10 system viewer scope check for scoped payee on private account.
- `packages/app/src/ledger/split-tags.ts` -- Add P10 system viewer scope check for scoped tag on private account.
- `packages/app/src/ledger/needs-review.ts` -- Export `registerTransactionNeedsReviewSync()`, remove top-level registration call.
- `apps/server/src/index.ts` / composition root -- Call `registerTransactionNeedsReviewSync()` on server boot.
- `packages/db/src/classify-repos.ts` -- Add `eq(split.id, splitId)` to `listForSplit` subquery.
- `packages/shared/src/index.ts` -- Export `SEARCH_QUERY_MAX = 200`.
- `apps/web/src/routes/search.ts` -- Import `SEARCH_QUERY_MAX` from `@pangolin/shared`, alias to `MAX_QUERY`.
- `apps/web/src/pages/TransactionList.tsx` -- Strip `search.account` when `accountId` prop is set.
- `apps/web/src/RootLayout.tsx` -- Extract `selectGate(me, pathname)`, normalize slashes, memoize session context.
- `apps/web/src/RootLayout.test.ts` -- Pure unit tests for `selectGate`.
- `apps/web/src/styles.css` -- Add missing shadcn tokens and `@theme inline` declarations.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/ledger/types.ts` -- Extract `LedgerTransaction` and `LedgerSplit` types to eliminate A2 import cycle between `transaction-view.ts` and `list-transactions.ts`.
- [x] `packages/app/src/inputs.ts` -- Create shared input helpers (`dayInput`, `idInput`) resolving A3; update imports in `accounts/inputs.ts`, `hide-name.ts`, `transfer-groups.ts`, and `transaction-query.ts`.
- [x] `packages/app/src/ledger/split-targets.ts` -- Unify `privateOwner` lookup to throw `AppError("Conflict")` on missing owner resolving A4, and reuse across `create-transaction.ts`.
- [x] `packages/app/src/ledger/create-transaction.ts` and `packages/app/src/ledger/split-tags.ts` -- Add P10 system viewer scope guard forbidding cross-partner scoped payee or tag on private accounts, with unit tests.
- [x] `packages/app/src/ledger/needs-review.ts` -- Export explicit `registerTransactionNeedsReviewSync()`, remove side-effect import execution across ledger use cases, and invoke at composition root resolving I8.
- [x] `packages/db/src/classify-repos.ts` -- Add `eq(split.id, splitId)` filter to `listForSplit` subquery resolving 12.8 finding.
- [x] `packages/shared/src/index.ts` and `apps/web/src/routes/search.ts` -- Share `SEARCH_QUERY_MAX` between shared and web search route resolving 12.5 finding.
- [x] `apps/web/src/pages/TransactionList.tsx` -- Ignore stray `account` search param when `accountId` is pinned resolving 12.4 finding.
- [x] `apps/web/src/RootLayout.tsx` and `apps/web/src/RootLayout.test.ts` -- Extract pure `selectGate`, normalize slashes, memoize session context, and add test coverage resolving 12.1 finding.
- [x] `apps/web/src/styles.css` -- Add complete shadcn theme tokens resolving 12.1 finding.

**Acceptance Criteria:**
- Given the codebase, when boundary checks and linting run, then no circular dependencies exist between `transaction-view.ts` and `list-transactions.ts`.
- Given a private account with no owner, when `privateOwner` is queried, then an `AppError` with status Conflict (409) is thrown.
- Given a system viewer, when attempting to attach person A's scoped payee or tag to person B's private account, then the write is refused with Conflict (409).
- Given `/api/ledger/transactions` or search execution, when `listForSplit` is executed, then the subquery targets only the requested `splitId`.
- Given `/accounts/:id` rendered with a stray `?account=other` URL search parameter, then `hasClearableFilters` evaluates to false and the account's transactions render correctly.
- Given `selectGate`, when evaluated against various `me` query states and pathnames (including trailing slashes), then all gate branches are covered by unit tests.
- Given the entire repository, when `pnpm lint`, `pnpm -r typecheck`, and `pnpm test` run, then all checks pass green.

## Implementation Notes

- **Item 1 (A2 Import Cycle):** Extracted `LedgerSplit`, `LedgerTransaction`, `LedgerPage`, and `LedgerTransactionList` to `packages/app/src/ledger/types.ts`. Re-exported them from `list-transactions.ts` and imported them in `transaction-view.ts`, severing the import cycle cleanly. Verified with `scripts/check-boundaries.ts`.
- **Item 2 (A3 Shared Zod Inputs):** Extracted `dayInput` and `idInput` to `packages/app/src/inputs.ts` and re-exported from `accounts/inputs.ts`. Replaced inline schemas and cross-domain imports in `ledger/` and `classify/`.
- **Item 3 (A4 Unified privateOwner):** Standardized `privateOwner(tx, viewer, accountId)` in `split-targets.ts` to throw `AppError("Conflict", "This account has no owner")` instead of a bare `Error`. Reused in `create-transaction.ts` and tested.
- **Item 4 (I8 Explicit needs_review Sync Registration):** Exported `registerTransactionNeedsReviewSync()` from `needs-review.ts` and re-exported from `@pangolin/app`. Removed side-effect imports across ledger mutations; registered at startup in `server.ts` and `app.ts` as well as test setups.
- **Item 5 (P10 System-Viewer Scope Guard on Private Accounts):** Enforced in `create-transaction.ts` and `split-tags.ts` that if an account is private and an item has `scopePersonId !== null`, it must match the account owner (`scopePersonId === owner`), otherwise throwing `AppError("Conflict")`. Tested in `ledger.test.ts` and `splits.test.ts`.
- **Item 6 (12.8 classify-repos listForSplit Query):** Added `eq(split.id, splitId)` to `listForSplit` subquery in `classify-repos.ts` to eliminate full visible splits scan.
- **Item 7 (12.5 Search Query Length Bound):** Exported `SEARCH_QUERY_MAX = 200` from `@pangolin/shared`, reused in `search-query.ts` and aliased in `apps/web/src/routes/search.ts`.
- **Item 8 (12.4 Account Screens Stray Parameter Cleanup):** Computed `effectiveSearch` in `TransactionList.tsx` stripping stray `search.account` when `accountId` is pinned. Tested in `TransactionList.test.tsx`.
- **Item 9 (12.1 RootLayout Gate Precedence):** Extracted `selectGate` and `normalizePath` pure functions with 16 unit tests covering all gate conditions and trailing slashes in `RootLayout.test.ts`.
- **Item 10 (12.1 Theme Tokens):** Added shadcn theme tokens (`--card`, `--popover`, `--secondary`, `--destructive`) and `@theme inline` mappings to `styles.css`.
- **Review Patches:**
  - Added unit test coverage for `oneTimeLink` with trailing slashes in `apps/web/src/router.test.ts`.
  - Upgraded `normalizePath` to `pathname.replace(/\/+$/, "") || "/"` in `routes/search.ts` and shared across `RootLayout.tsx` and `RootLayout.test.ts`.
  - Adopted `idInput` in `ownersInput`, `deleteTransactionInput`, and `getTransactionInput`.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 0, low 4 patched, low 5 rejected, false 4 rejected, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `oneTimeLink` trailing-slash token extraction unverified (`apps/web/src/router.test.ts`) | low | patch | Added unit tests in `apps/web/src/router.test.ts` asserting token extraction on `/setup/` and `/recover/`. |
| Missing private owner scope guard in `requireActivity` (`packages/app/src/ledger/split-targets.ts`) | false | reject | Refuted: Retro finding P10 specifically targets scoped payees and tags (`create-transaction.ts`, `split-tags.ts`); activities are shared classification entities across the household and lack cross-partner private scoping in current schemas. |
| Incomplete trailing slash normalization for repeated slashes in `normalizePath` (`apps/web/src/RootLayout.tsx`) | low | patch | Updated `normalizePath` to `pathname.replace(/\/+$/, "") || "/"` and added unit tests in `RootLayout.test.ts` covering `/setup//`, `/recover///`, and `//`. |
| Duplicated path normalization between `RootLayout.tsx` and `search.ts` | low | patch | Exported `normalizePath` from `apps/web/src/routes/search.ts` and reused it across `RootLayout.tsx` and tests. |
| Incomplete adoption of `idInput` in `ownersInput` and `deleteTransactionInput` / `getTransactionInput` | low | patch | Applied `idInput` to `ownersInput` (`personId`), `deleteTransactionInput` (`id`), and `getTransactionInput` (`id`). |
| Unfulfilled unification of `privateOwner` in `scope.ts` | false | reject | Refuted: `classify` package cannot import from `ledger` without violating package architecture boundaries; `scope.ts` already throws typed `AppError("Conflict")`. A4's defect was ledger throwing bare `Error`, which was resolved in `split-targets.ts`. |
| Redundant account lookup in `create-transaction.ts` | low | reject | Negligible in-memory lookup overhead; separate calls preserve clear use-case preconditions without complicating `privateOwner` parameter contracts. |
| Duplicate consecutive calls to `privateOwner` in `set-split-field.ts` | low | reject | Pre-existing lookup pattern; negligible overhead within unit-of-work transaction. |
| Redundant listener registration across `server.ts` and `app.ts` | low | reject | `createApp` may be invoked standalone in HTTP test suites without `startServer`, and `startServer` boots background jobs; registering in both ensures the listener is always registered, and `registerEntitySync` handles idempotent registrations cleanly. |
| Silent failure risk for `needs_review` sync in standalone use cases | false | reject | Refuted: All relevant standalone use-case test suites (`ledger.test.ts`, `ledger-repos.test.ts`) call `registerTransactionNeedsReviewSync` in setup hooks; production always runs via `createApp` or `startServer`. |
| Redundant dependency in `listSearch` memoization (`TransactionList.tsx`) | low | reject | Standard React hook dependency declaration with zero runtime or rendering penalty. |
| Missing test coverage for pinned account interaction with filter clearing (`TransactionList.test.tsx`) | false | reject | Refuted: Test in `TransactionList.test.tsx` specifically verifies that with pinned `accountId`, stray query parameters are ignored and Clear filters is not rendered. |
| Inconsistent filter clearing semantics on error state in `TransactionList.tsx` | low | reject | Pre-existing error reset fallback (`onSearch(() => ({}))`); out of scope of refactor sweep. |

## Design Notes

- **A2 Type Extraction:** `list-transactions.ts` defined `LedgerSplit` and `LedgerTransaction` which `transaction-view.ts` imported, while `list-transactions.ts` imported `toLedgerTransaction` from `transaction-view.ts`. Moving shared types to `packages/app/src/ledger/types.ts` cleanly severs the cycle while retaining backward compatibility through re-exports.
- **I8 Registration Pattern:** Follows the existing `registerEntitySync` infrastructure in `packages/app/src/system/review-items.ts`. We export `registerTransactionNeedsReviewSync()` and invoke it in the server bootstrap (`apps/server/src/index.ts`) and test setup files so module imports remain free of side-effects.
- **P10 Scope Guard:** On shared accounts, scoped payees/tags are refused (`"This payee/tag cannot be used on a shared account yet"`). On private accounts, payees and tags must either be shared (`scopePersonId === null`) or match the private account's sole owner (`scopePersonId === owner`). A system viewer supplying a partner's scoped item violates owner isolation and will throw `AppError("Conflict")`.

## Verification

**Commands:**
- `pnpm lint` -- expected: green with no Biome errors
- `pnpm -r typecheck` -- expected: clean with no TypeScript errors
- `pnpm vitest run packages/app packages/db apps/web` -- expected: all unit and component tests pass
- `node scripts/check-boundaries.ts` -- expected: clean with no boundary or cycle violations
- `pnpm check:strict` -- expected: clean with no violations
