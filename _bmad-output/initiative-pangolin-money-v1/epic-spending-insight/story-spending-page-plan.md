---
title: 'Spending page'
type: 'feature'
ticket: '6'
created: '2026-10-24'
baseline_revision: '0b3a6420fcae9338f1adb47f24d81e924cbfdb39'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is currently no dedicated `/spending` route to explore spending patterns, breakdown income vs expenses by category/merchant, or view category bars sorted by amount with change comparisons against the previous equal period.

**Approach:** Build `/spending` with the date range header, the always-visible apportioned share line and My share toggle, two-column income and expense bar lists, and a "Spending by category" card displaying categories sorted by amount descending with flexible badges and change vs previous equal period, drilling through to filtered Transactions.

## Boundaries & Constraints

**Always:**
- Route `/spending` keeps the date range (`from`/`to`) and `share=mine` in the URL search params, defaulting to the current quarter and Everything when absent.
- The apportioned share line renders under the header: "Your share: $X of $Y shared (N%)", toggle at its right end ("Everything I can see" / "My share").
- Income and expense bar lists reuse `BarListsCard` backed by existing server use cases (`/api/reports/pnl` and `/api/reports/merchants`).
- "Spending by category" displays category expense rows sorted by amount descending, each with its group's chart ramp colour square, category name, a `flexible` tag when `isFixedCost === false`, group name in small muted text, horizontal SVG progress track bar (CSP-compliant, no inline styles), formatted amount, and change vs the previous equal period (`stepRange(range, -1, today)`).
- Change vs previous equal period displays `↑ $X` (increase), `↓ $X` (decrease), or `same as last <quarter/period>` (zero change).
- Clicking any category bar row or link drills through to `/transactions` with matching category filter (or `uncategorised=true`) and active date range.
- Empty states match Cash flow: empty database shows "Nothing to sniff at yet" with import prompt; zero transactions in range shows "Nothing in this period".
- App sidebar and mobile navigation include active links to `/spending`.
- Web never sums money: amounts, totals, and breakdowns are derived from server responses.

**Never:**
- No HTML tooltips, inline style attributes, or un-nonce'd styles violating the strict CSP.
- No client-side financial recalculations or mutating server reports.
- No changes to the server privacy boundary: hidden payees never leak across partners.
- No Biggest little leaks tile (deferred to Story 4.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default `/spending` | Navigating to `/spending` without search params | Current quarter selected, share line rendered, bar lists and category bars shown | Fallback error alert if query fails |
| Category row drill-down | User clicks Groceries category row | Navigates to `/transactions?category=<id>&from=<from>&to=<to>` | Preserves active date range |
| Uncategorised row drill-down | User clicks Uncategorised category row | Navigates to `/transactions?uncategorised=true&from=<from>&to=<to>` | Valid search params |
| Flexible category badge | Category has `isFixedCost === false` | Renders `flexible` badge beside category name | Clean typography |
| Change vs previous period | Groceries spent $2,718 this quarter vs $2,804 last quarter | Displays `↓ $86` | Formats difference clearly |
| No change vs previous period | Rent spent $9,360 this quarter vs $9,360 last quarter | Displays `same as last quarter` (or `last period`) | Graceful zero-diff display |
| New category (zero in prev) | Category with $1,640 spend this quarter, $0 last quarter | Displays `↑ $1,640` | Handles missing previous row |
| My share toggle | User toggles to "My share" | URL updates with `?share=mine`, reload keeps state | Valid URL search state |
| Empty database | 0 accounts / transactions in database | Renders "Nothing to sniff at yet" mascot card with import button | Empty state |
| Nothing in range | Active accounts, 0 transactions in selected range | Renders "Nothing in this period" card | In-range empty state |

</frozen-after-approval>

## Code Map

- `apps/web/src/routes/spending.tsx` -- define `/spending` route with `validateCashFlowSearch` (or `validateSpendingSearch`) and `SpendingPage`.
- `apps/web/src/router.tsx` -- register `spendingRoute` in the route tree.
- `apps/web/src/api.ts` -- include `isFixedCost?: boolean` in `CategorySummary` within `fetchCategories`.
- `apps/web/src/api.test.ts` -- update `fetchCategories` mock assertion to include `isFixedCost`.
- `apps/web/src/components/SpendingCategoryBarsCard.tsx` -- category bars card: amount-sorted expense rows, ramp color squares, flexible badges, SVG progress tracks, and previous equal period change.
- `apps/web/src/pages/SpendingPage.tsx` -- main page assembly: header with `DateRangeControl`, share line + toggle, `BarListsCard`, `SpendingCategoryBarsCard`, empty states.
- `apps/web/src/components/AppSidebar.tsx` -- add Spending navigation link between Cash flow and Transactions.
- `apps/web/src/components/MobileNav.tsx` -- enable Spending link in the mobile navigation "More" sheet.
- `apps/web/src/pages/SpendingPage.test.tsx` -- unit and component tests: rendering, bar lists, category sorting, flexible badges, previous period diffs, drill-down links.
- `e2e/spending.spec.ts` -- Playwright e2e test verifying category totals equal hand sum, change vs previous equal period is correct, and drill-down lands on `/transactions` with category filter.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/api.ts` & `apps/web/src/api.test.ts` -- update `fetchCategories` to return `isFixedCost` on `CategorySummary`.
- [x] `apps/web/src/components/SpendingCategoryBarsCard.tsx` -- implement spending category bars card with sorting, ramp colors, flexible badges, progress tracks, change calculations, and drill-down links.
- [x] `apps/web/src/routes/spending.tsx` & `apps/web/src/router.tsx` -- create and register the `/spending` route.
- [x] `apps/web/src/pages/SpendingPage.tsx` -- build Spending page assembling header, share line + toggle, bar lists, category bars card, and empty states.
- [x] `apps/web/src/components/AppSidebar.tsx` & `apps/web/src/components/MobileNav.tsx` -- add active Spending links to desktop sidebar and mobile navigation.
- [x] `apps/web/src/pages/SpendingPage.test.tsx` -- write comprehensive component and unit tests covering rendering, sorting, diff formatting, and navigation.
- [x] `e2e/spending.spec.ts` -- write e2e test on seeded household asserting category totals equal hand sums, previous period change is correct, and category click filters Transactions.

**Acceptance Criteria:**
- Given a user on `/spending`, when data is present for the date range, then the apportioned share line, income/expense bar lists, and category bars sorted by amount render correctly.
- Given category rows, when a category is not a fixed cost (`isFixedCost === false`), then a `flexible` tag is rendered beside its name.
- Given category rows, when compared against the previous equal period, then the change indicator shows `↑ $X`, `↓ $X`, or `same as last <quarter/period>`.
- Given a category row clicked, when clicked, then the browser navigates to `/transactions` with `category` filter and matching date range.
- Given the seeded household in e2e tests, when navigating to `/spending`, then category totals equal the hand sum of splits and change against previous equal period matches expectations.
- Given the verification suite, when run, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm e2e` pass cleanly.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment)

Counts: high 0 · medium 2 · low 6 · false 1 · maybe-false 0 (patch 8, reject 1).

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | blind + edge + gap | `prevPnlCategory` pending / error omitted from page state, and card renders before previous period loads | medium | patch | Included `prevPnlCategory.isPending` in `isPending`, `prevPnlCategory.isError` in `isError`, only render card when `prevPnlCategory.data` is loaded, default fallback `prevRange` to `stepRange(range, -1, today)`. |
| 2 | blind + edge | Sub-dollar diffs round to `↑ $0` or `↓ $0` | low | patch | If `Math.round(Math.abs(diffCents) / 100) === 0`, return `same as last <quarter/period>`. |
| 3 | gap + blind | Missing assertions in `e2e/spending.spec.ts` for category row amount matches and period change indicator text | medium | patch | Added assertions in `e2e/spending.spec.ts` for row amounts matching server and change indicators (`↑`, `↓`, `same as last`). |
| 4 | blind | Missing router test for `/spending` | low | patch | Added tests for `/spending` in `router.test.ts`. |
| 5 | blind | Unmemoized `Intl.NumberFormat` on render | low | patch | Cached `WHOLE_DOLLAR_FORMATTER` at module level. |
| 6 | blind | Ramp styling mismatch for groups past index 8 (`fill-primary` vs `bg-muted-foreground`) | low | patch | Unified fallback `fillClass` to `fill-muted-foreground`. |
| 7 | blind | Client sort dropped secondary name tie-breaker | low | patch | Added `(a.name ?? "").localeCompare(b.name ?? "")` secondary key. |
| 8 | blind | Row link lacked `group` for title hover underline | low | patch | Added `group` to `<Link>` and `group-hover:underline` to title. |
| 9 | intent | `share=mine` does not pass `share` to report queries | false | reject | By design per Story 4.4 boundaries and AD-23, `share=mine` scopes `cashFlowTotals` money out, while `profitAndLoss` and `spending` breakdowns have no `share` parameter. |

## Verification

**Commands:**
- `pnpm --filter @pangolin/web test apps/web/src/pages/SpendingPage.test.tsx` -- expected: all Spending page tests pass.
- `pnpm lint` -- expected: zero lint errors.
- `pnpm typecheck` -- expected: TypeScript compiles with zero errors.
- `pnpm test` -- expected: full unit test suite passes.
- `pnpm --filter @pangolin/e2e test e2e/spending.spec.ts` -- expected: e2e test passes.
