---
title: 'Refactor sweep'
type: 'refactor'
ticket: '10'
created: '2026-10-25'
status: done
baseline_revision: 'a5696fa04a274684495c3e39f5c6494cbff294ee'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 4's feature build left two oversized UI components (`NetWorthPage.tsx` at 681 lines and `SankeyCard.tsx` at 486 lines), duplicated report queries across `CashFlowPage` and `SpendingPage`, and deferred review findings from stories 4.3 and 4.9 (accessibility attributes in report tables and missing 50k-row performance timing for `sharedApportionment`).

**Approach:** Decompose `NetWorthPage` and `SankeyCard` into focused subcomponents and helpers under 400 lines; unify report queries into a reusable hook; resolve deferred accessibility and performance items; update deferred work tracking; and verify lint, types, unit tests, boundary rules, and Playwright tests pass unchanged.

## Boundaries & Constraints

**Always:**
- Keep all components under 400 lines of code.
- Retain exact user-visible behaviors, URL contracts, search parameters, and report calculations.
- Preserve all existing tests and ensure no regressions in Vitest or Playwright suites.
- Follow WCAG 2.1.1 for scrollable containers (`tabIndex={0}`, `role="region"`, `aria-label`).
- Mark resolved findings in `_bmad-output/implementation-artifacts/deferred-work.md` with their disposition.

**Never:**
- Do not alter API schemas, route paths, or data contracts of report endpoints.
- Do not perform client-side monetary calculations or alter server-authoritative numbers.
- Do not add new external npm dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Report queries hook | `useReportQueries(range, { includePrev: true, share: "mine" })` | Returns TanStack query results for totals, share, P&L, merchants, and leaks | Retains `keepPreviousData` and `retry: false` |
| Table accessibility | `NetWorthTrendTable` rendered | Month cells use `<th scope="row">`; scroll container has `tabIndex={0}` and `role="region"` | Standard accessible table tree |
| Scrollable container | `SpendingCategoryBarsCard` rendered | Scroll container has `tabIndex={0}` and `role="region"` | Keyboard focusable |
| Import button label | `AccountRowItem` with stale account "Everyday" | Import button has `aria-label="Import statement for Everyday"` | Accessible button name |
| Perf test budget | `GET /api/reports/shared-apportionment?from=...&to=...` on 50k rows | Responds 200 with timing <= 300 ms | Fails if elapsed > 300 ms |

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/NetWorthPage.tsx` -- Main page component; simplify to <400 lines by delegating trend chart, trend table, and account row items.
- `apps/web/src/components/NetWorthTrendChart.tsx` -- Extracted 12-month ECharts trend chart component with canvas lifecycle and resize listener.
- `apps/web/src/components/NetWorthTrendTable.tsx` -- Extracted trend table component with `<th scope="row">` month headers and `tabIndex={0}` on `overflow-x-auto`.
- `apps/web/src/components/NetWorthAccountRow.tsx` -- Extracted account list item component with accessible `aria-label` on Import buttons.
- `apps/web/src/components/SankeyCard.tsx` -- Main Sankey container; simplify to <400 lines by delegating graph construction and styling helpers.
- `apps/web/src/components/sankey-layout.ts` -- Extracted Sankey node/link graph builder, color ramps, and ECharts option generator.
- `apps/web/src/hooks/useIsPhone.ts` -- Extracted viewport width hook for responsive chart/table switching.
- `apps/web/src/hooks/useReportQueries.ts` -- Unified hook for report queries (`sharedShare`, `pnlGroup`, `pnlCategory`, `incomeMerchants`, `expenseMerchants`, `leaks`, `accounts`, `categories`).
- `apps/web/src/hooks/useReportQueries.test.tsx` -- Unit tests for report query hook.
- `apps/web/src/pages/CashFlowPage.tsx` -- Refactor to use `useReportQueries` and maintain <400 lines.
- `apps/web/src/pages/SpendingPage.tsx` -- Refactor to use `useReportQueries`.
- `apps/web/src/components/SpendingCategoryBarsCard.tsx` -- Add `tabIndex={0}`, `role="region"`, and `aria-label` to `overflow-x-auto` container.
- `apps/server/src/http/ledger-perf.test.ts` -- Add `sharedApportionment` 50k-row timing assertion (<= 300 ms).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- Record dispositions for resolved findings.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/hooks/useIsPhone.ts` & `apps/web/src/components/sankey-layout.ts` -- Extract Sankey layout & responsive hook -- Extract graph generation, color logic, and resize logic so `SankeyCard.tsx` is under 400 lines.
- [x] `apps/web/src/components/SankeyCard.tsx` -- Refactor Sankey card -- Integrate `sankey-layout.ts` and `useIsPhone.ts` while preserving all chart interactions and click-throughs.
- [x] `apps/web/src/components/NetWorthTrendChart.tsx`, `NetWorthTrendTable.tsx`, `NetWorthAccountRow.tsx` -- Extract Net Worth subcomponents -- Break down `NetWorthPage.tsx` to under 400 lines, adding `<th scope="row">` for month cells, `tabIndex={0}` for scroll container, and descriptive `aria-label` on Import buttons.
- [x] `apps/web/src/pages/NetWorthPage.tsx` -- Refactor Net Worth page -- Integrate extracted components and verify page size is well under 400 lines.
- [x] `apps/web/src/components/SpendingCategoryBarsCard.tsx` -- Keyboard accessibility for scroll container -- Add `tabIndex={0}`, `role="region"`, and `aria-label="Category spending breakdown"`.
- [x] `apps/web/src/hooks/useReportQueries.ts` & `apps/web/src/hooks/useReportQueries.test.tsx` -- Deduplicate report queries -- Create shared hook encapsulating common report queries, query keys, and fetchers.
- [x] `apps/web/src/pages/CashFlowPage.tsx` & `apps/web/src/pages/SpendingPage.tsx` -- Adopt `useReportQueries` -- Replace repetitive inline `useQuery` blocks with the unified hook.
- [x] `apps/server/src/http/ledger-perf.test.ts` -- Add shared apportionment perf test -- Assert `/api/reports/shared-apportionment` responds in <= 300 ms over 50k rows.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- Update deferred work registry -- Update status of resolved review findings from Epic 4.
- [x] Verification -- Run full suite -- Verify `check-boundaries.ts`, `biome check`, vitest test suites, and Playwright e2e tests pass cleanly.

**Acceptance Criteria:**
- Given `apps/web/src/pages/NetWorthPage.tsx` and `apps/web/src/components/SankeyCard.tsx`, both files have fewer than 400 lines of code.
- Given `CashFlowPage.tsx` and `SpendingPage.tsx`, duplicated `useQuery` definitions for reports are replaced with `useReportQueries`.
- Given `NetWorthTrendTable`, month cells in tbody are `<th scope="row">` elements, and the scroll container has `tabIndex={0}`.
- Given `SpendingCategoryBarsCard`, the scroll container has `tabIndex={0}`, `role="region"`, and an `aria-label`.
- Given `NetWorthAccountRow`, the stale and empty import buttons include an account-specific `aria-label`.
- Given `apps/server/src/http/ledger-perf.test.ts`, the shared apportionment route is tested against 50k transactions and executes in <= 300 ms.
- Given `node scripts/check-boundaries.ts` and `pnpm test`, all checks and tests pass with 0 errors.

## Implementation Notes

- Extracted `useIsPhone` hook to `apps/web/src/hooks/useIsPhone.ts`.
- Extracted Sankey graph generation, color ramps, and option creation to `apps/web/src/components/sankey-layout.ts`. `SankeyCard.tsx` reduced from 486 lines to 232 lines.
- Extracted `NetWorthTrendChart.tsx`, `NetWorthTrendTable.tsx`, and `NetWorthAccountRow.tsx`. `NetWorthPage.tsx` reduced from 681 lines to 332 lines.
- Improved accessibility in `NetWorthTrendTable` (`<th scope="row">` month cells, `tabIndex={0}`, `role="region"`, `aria-label="12-month net worth trend"`), `SpendingCategoryBarsCard` (`tabIndex={0}`, `role="region"`, `aria-label="Category spending breakdown"`), and `NetWorthAccountRow` (`aria-label={`Import statement for ${account.name}`}`).
- Extracted unified report queries hook `useReportQueries` in `apps/web/src/hooks/useReportQueries.ts` and unit tested in `useReportQueries.test.tsx`. Adopted across `CashFlowPage.tsx` and `SpendingPage.tsx`.
- Added 50,000-row performance timing test for `/api/reports/shared-apportionment` in `apps/server/src/http/ledger-perf.test.ts` (executes in ~132 ms <= 300 ms budget).
- Marked Epic 4 review findings as fixed in `_bmad-output/implementation-artifacts/deferred-work.md`.
- Ran full lint, typecheck, boundary, and test suites.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 0 medium, 5 low patches; 1 deferred; 8 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| low | patch | Missing test assertion for `SpendingCategoryBarsCard` scroll container accessibility attributes (`tabIndex="0"`, `role="region"`, `aria-label="Category spending breakdown"`); added in `SpendingPage.test.tsx`. |
| low | patch | `useReportQueries.test.tsx` did not exercise `includeTotals: false`; added dedicated unit test. |
| low | patch | `ledger-perf.test.ts` shared apportionment timing test used weak `typeof number` assertions; strengthened to `toBeGreaterThan(0)` for sharedCents and shareCents. |
| low | patch | Keyboard-accessible scroll containers in `NetWorthTrendTable.tsx` and `SpendingCategoryBarsCard.tsx` lacked visible focus indicators; added `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`. |
| low | patch | `CashFlowPage.tsx` did not pass memoized `today` string to `useReportQueries`; updated options call to `{ share, today }`. |
| low | defer | `ProfitAndLossTable.tsx` scroll container lacks `tabIndex={0}`, `role="region"`, and `aria-label`; pre-existing from story 4.5, recorded in `deferred-work.md`. |
| low | reject | `NetWorthAccountRow.tsx:294-301`: "No imports yet" branch of Import button unexercised in test; sample test fixture has lastImport, cosmetic branch coverage gap. |
| low | reject | Missing unit tests for `useIsPhone`: extracted verbatim from `SankeyCard.tsx`, covered by integration tests. |
| low | reject | Missing unit tests for `sankey-layout.ts`: extracted verbatim pure layout logic, covered by `CashFlowPage.test.tsx` and e2e. |
| low | reject | Missing `ResizeObserver` in `NetWorthTrendChart`: pre-existing window resize listener from story 4.8. |
| low | reject | Duplicate Sankey links when multiple income rows share a name: pre-existing logic from story 4.5. |
| low | reject | Chart instance recreation on update in `SankeyCard`: pre-existing lifecycle logic from story 4.5. |
| low | reject | Consolidated `MONTHS` arrays: cosmetic duplication across isolated subcomponents. |
| low | reject | Inability to collapse "Other" groups in `SankeyCard`: pre-existing UI behavior from story 4.5. |

## Verification

**Commands:**
- `node scripts/check-boundaries.ts` -- expected: Architectural boundaries valid (exit code 0)
- `pnpm exec biome check .` -- expected: No lint or format violations
- `pnpm --filter @pangolin/server test` -- expected: Server unit and perf tests pass
- `pnpm --filter @pangolin/web test` -- expected: Web component and hook tests pass
- `pnpm test` -- expected: Monorepo test suite passes
