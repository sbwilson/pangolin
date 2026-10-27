---
title: 'Biggest little leaks'
type: 'feature'
ticket: '7'
created: '2026-10-24'
status: done
baseline_revision: '845eab73ad6fb174d6845298de9fba712fcd38d7'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users have no visibility into recurring small expenses ("leaks") that quietly accumulate over time across Cash flow and Spending pages.

**Approach:** Add a `reports.leaks` use case and API route calculating the top five merchants by total spend in the date range with at least four transactions and a median amount of $25 or less based on `visibleTxn`, and display a "Biggest little leaks" tile on both `/cash-flow` and `/spending` with drill-down links to filtered Transactions and no flexible-category tag.

## Boundaries & Constraints

**Always:**
- Use `visibleTxn(viewer, today)` for payee visibility: payees of transactions with hidden names (`nameHiddenUntil` in the future for other users) or scoped to another person project as `null` and must never appear as a leak merchant.
- A qualifying merchant must have at least 4 visible expense transactions (`count >= 4`) in the inclusive date range (`from`..`to`) and a median transaction expense amount of $25 or less (`medianCents <= 2500`).
- Transactions evaluated are visible transactions with expense flow (`split.amountCents < 0` / flowKind `expense`), where transaction spend is the positive cents amount.
- Top five merchants returned, sorted by total spend descending, then payee name ascending, then payee id.
- Clicking any leak merchant card or link navigates to `/transactions?payee=<payeeId>&from=<from>&to=<to>`.
- Both `/cash-flow` and `/spending` render the "Biggest little leaks" card below their main report contents, reacting to the active date range.
- Empty states: when no merchants qualify as leaks in the period, the card renders a clear empty message ("No little leaks found in this period").
- Web never sums money: counts, totals, and medians are derived entirely on the server.
- New route `GET /api/reports/leaks?from=YYYY-MM-DD&to=YYYY-MM-DD` is in `route-manifest.ts`, replayed in `privacy.test.ts`, and observed by `hiddenNameScenario`.

**Never:**
- No flexible-category tag on the leak items (explicit requirement).
- No leakage of hidden or private payees across partners.
- No HTML tooltips or inline styles violating CSP.
- No client-side median or sum calculations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Qualifying leak | Merchant with 10 transactions of $9.20 ($92.55 total) | Appears in leaks list with count 10, total $92.55, median $9.20 | No error expected |
| Under 4 transactions | Merchant with 3 transactions of $5.00 | Excluded from leaks (< 4 transactions) | No error expected |
| Median > $25 | Merchant with 5 transactions of $30.00 | Excluded from leaks (median > $25) | No error expected |
| Even number of txns | Merchant with 4 transactions ($10, $20, $20, $30) | Median is ($20 + $20)/2 = $20.00; qualifies if <= $25 | No error expected |
| Hidden payee | Partner A hides a transaction's name | For Partner B, transaction has null payee and does not attribute to merchant | No error expected |
| No leaks in range | Date range with no merchants meeting criteria | `rows: []`, UI displays "No little leaks found in this period" | No error expected |
| Invalid date range | `from > to` or malformed date string | 400 Bad Request | Zod parse error |

</frozen-after-approval>

## Code Map

- `packages/app/src/ports/unit-of-work.ts` -- `LeakMerchantRow` interface, `TransactionRepo.merchantLeaks(viewer, today, range)` method signature, and `ReadRepos.transactions` exposure.
- `packages/db/src/ledger-repos.ts` -- `merchantLeaks` SQLite query joining `transaction`, `split`, and `visibleTxn(viewer, today)` grouping by transaction and payee.
- `packages/app/src/testing/memory-uow.ts` -- In-memory `merchantLeaks` implementation filtering visible rows, grouping by projected payee, computing count and median.
- `packages/app/src/testing/flow-kind-parity.test.ts` -- Parity tests ensuring SQLite and memory implementations yield identical `merchantLeaks` results.
- `packages/app/src/reports/leaks.ts` -- `reports.leaks` use case validating `rangeInput` and invoking `repos.transactions.merchantLeaks`.
- `packages/app/src/reports/index.ts` -- Export `leaks`, `leaksInput`, `LeaksReport`, `LeakMerchant`.
- `apps/server/src/http/app.ts` -- `GET /api/reports/leaks` route handler.
- `apps/server/src/privacy/route-manifest.ts` -- Add `read("/api/reports/leaks")`.
- `apps/server/src/privacy/privacy.test.ts` -- Add `/api/reports/leaks?${range}` to `REPORT_QUERIES`.
- `apps/server/src/privacy/privacy-scenarios.ts` -- Add `/api/reports/leaks?${REPORT_RANGE}` to `hiddenNameScenario` observed paths.
- `apps/server/src/http/cash-flow-seed.test.ts` -- Hand-sum test verifying seeded leaks for each partner.
- `apps/web/src/api.ts` -- `fetchLeaks` client function and report types.
- `apps/web/src/components/BiggestLittleLeaksCard.tsx` -- Responsive leak tiles rendering merchant name, count, total spend, and drill link.
- `apps/web/src/pages/CashFlowPage.tsx` -- Query `fetchLeaks` and render `BiggestLittleLeaksCard`.
- `apps/web/src/pages/SpendingPage.tsx` -- Query `fetchLeaks` and render `BiggestLittleLeaksCard`.
- `e2e/routing.spec.ts` -- End-to-end test confirming card renders and drill-down navigates to filtered transactions.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/ledger-repos.ts`, `packages/app/src/testing/memory-uow.ts` -- Add `merchantLeaks(viewer, today, range)` returning `{payeeId, payeeName, count, totalCents, medianCents}[]` for merchants with >=4 expense transactions and median <= $25, top 5 by total spend desc.
- [x] `packages/app/src/testing/flow-kind-parity.test.ts` -- Parity tests for `merchantLeaks` across SQLite and memory UoW.
- [x] `packages/app/src/reports/leaks.ts` (+ tests in `packages/app/src/reports/leaks.test.ts`, export in `index.ts`) -- `reports.leaks` use case with `leaksInput` schema.
- [x] `apps/server/src/http/app.ts`, `apps/server/src/http/app.test.ts` -- Register `GET /api/reports/leaks` route with authentication and validation.
- [x] `apps/server/src/privacy/{route-manifest.ts,privacy.test.ts,privacy-scenarios.ts}` -- Privacy manifest entry, replay in `REPORT_QUERIES`, and observation in `hiddenNameScenario`.
- [x] `apps/server/src/http/cash-flow-seed.test.ts` -- Seed verification test ensuring leaks match hand calculations for each partner.
- [x] `apps/web/src/api.ts` -- Add `fetchLeaks` and leak types.
- [x] `apps/web/src/components/BiggestLittleLeaksCard.tsx` (+ tests in `BiggestLittleLeaksCard.test.tsx`) -- UI card displaying up to 5 leak tiles with transaction drill links and no flexible-category tag.
- [x] `apps/web/src/pages/CashFlowPage.tsx`, `apps/web/src/pages/SpendingPage.tsx` -- Integrate `BiggestLittleLeaksCard` on both pages with query key caching and range synchronization.
- [x] `e2e/routing.spec.ts` -- E2E test verifying card presence on Cash flow and Spending, and clicking a leak navigates to `/transactions?payee=...`.

**Acceptance Criteria:**
- Given the seeded household, when requesting leaks on Cash flow or Spending, then the tile lists the top merchants matching hand calculation (e.g. Corner Cafe).
- Given a transaction with a hidden name for Partner B, when Partner B views leaks, then that payee never appears.
- Given a leak merchant tile, when clicked, then the user lands on `/transactions` filtered to that payee with the active date range preserved.
- Given a date range where no merchant has >= 4 transactions with median <= $25, then the card shows the empty state without error.
- Given the full verification suite (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`), all checks pass.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment)

Counts: high 0 · medium 1 · low 7 · false 3 · maybe-false 0 (11 findings).

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | blind | Flaky condition and missing drill-down assertion in E2E (`e2e/routing.spec.ts`) | medium | patch | Targeted seeded range `/spending?from=2026-04-01&to=2026-06-30` and used `await expect(firstLeakTile).toBeVisible()` before clicking and verifying drill-down. |
| 2 | blind | Asymmetric and fragile error/loading handling across pages (`SpendingPage.tsx`) | low | patch | Removed `leaks` from page-level `isError` and `isPending` in `SpendingPage.tsx` so leaks errors don't crash the page, matching `CashFlowPage.tsx`. |
| 3 | blind | Text truncation failure on long merchant names (`BiggestLittleLeaksCard.tsx`) | low | patch | Added `min-w-0` to the flex container wrapping merchant name. |
| 4 | blind | Missing accessibility landmarks and screen reader context | false | reject | All dashboard cards on Cash Flow and Spending (`BarListsCard`, `LatestTransactionsCard`, `SankeyCard`) use generic `<div>` within the page section landmark. |
| 5 | blind | Unused orphan barrel file `packages/app/src/reports/index.ts` | low | reject | Benign barrel file with clean re-exports; causes no runtime, build, or typecheck harm. |
| 6 | blind | Unnecessary helper duplication in `e2e/spending.spec.ts` | false | reject | Inlining helpers in `e2e/spending.spec.ts` was necessary to prevent package boundary violation flagged by `check-boundaries.ts`. |
| 7 | blind | Collation and sorting divergence in seed tests (`cash-flow-seed.test.ts`) | low | patch | Used `byText` instead of `localeCompare` in `handLeaks` sorting to strictly match SQLite binary collation. |
| 8 | blind | Missing expiration check for hidden names in seed calculations | false | reject | Matches established precedent of `handSum` in `cash-flow-seed.test.ts`; all seed hidden names are unexpired in the test range. |
| 9 | blind | Positive expense splits ignored in visit spend calculation | low | reject | Hypothetical edge case not present in real data or seed; expense splits are negative in practice. |
| 10 | blind | Missing test coverage for top-5 capping (`leaks.test.ts`) | low | patch | Added test case in `leaks.test.ts` with 6 qualifying merchants asserting that only top 5 by spend are returned. |
| 11 | blind | Gaps in page integration tests for empty state | low | reject | Empty state is already thoroughly covered in `BiggestLittleLeaksCard.test.tsx`. |

## Design Notes

The leak rule identifies frequent low-value merchant spend ("death by a thousand coffees"). By computing median transaction amount and grouping at the transaction level rather than raw splits, multi-split transactions at a single merchant correctly count as single visits. Sorting by total spend descending surfaces the largest leaks first, capped at top 5.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean with no Biome or import boundary errors
- `pnpm typecheck` -- expected: TypeScript compiles with 0 errors
- `pnpm test` -- expected: all unit, integration, parity, privacy, and seed tests pass
- `pnpm e2e` -- expected: Playwright tests pass including leak card and navigation checks
