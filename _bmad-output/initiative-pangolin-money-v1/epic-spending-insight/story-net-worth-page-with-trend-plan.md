---
title: 'Net worth page with trend'
type: 'feature'
ticket: '8'
created: '2026-10-24'
status: 'built'
baseline_revision: '97cd3215bdfa5c9746afd90658182fc48192ff0a'
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

**Problem:** Users have no unified view of current household or individual net worth across accounts, no 12-month historical trend line, no visibility into asset and liability breakdowns, and no way to spot stale balances or jump directly to statements on the `/net-worth` page.

**Approach:** Implement the `netWorth(viewer, asOf)` use case over cash, card and loan accounts using `balanceAsOf` (AD-19), with assets, liabilities, subtotals by account type, and a 12-point monthly trend derived on read; build the `/net-worth` page with 3-up KPIs, 12-month trend chart with a "View as table" toggle, account cards grouped by type, owner badges, private lock indicator, stale-account import shortcuts, empty state, and a disabled Forecast link card.

## Boundaries & Constraints

**Always:**
- Net worth equals hand sum of the visible accounts (public + own private accounts); another partner's private accounts are strictly excluded (AD-3).
- Balances are signed net-worth values (AD-12): cash/savings/offset are assets (positive unless overdrawn), card/loan accounts are liabilities (negative). Net worth is `assetsCents + liabilitiesCents`.
- All balances on `asOf` and each trend point come strictly from `accounts.balanceAsOf(viewer, account, date)` (AD-19).
- The 12-point trend reflects 12 month-end balances up to and including `asOf`'s month (using `asOf` when mid-month).
- Date-range filters do not appear on `/net-worth` (view is as of today).
- Stale accounts (>45 days since `lastImport.through`, via `isStale`) display the warning styling and an "Import" link shortcut opening the import flow.
- Private accounts show the lock icon with `aria-label="Private: only you can see this"`.
- When the viewer has zero visible accounts, render the empty state ("Nothing to calculate yet").
- The Forecast link card is rendered with a disabled link (`aria-disabled="true"`).

**Never:**
- No recalculation or summing of financial ledger totals on the client; all totals and subtotals come from `netWorth`.
- No leakage of private account names or balances to the other partner.
- No implementation of property valuations (epic 14) or brokerage investments (epic 9) beyond empty/zero slots.
- No date-range query parameters used to filter net-worth figures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Active household | Simon views `/net-worth` | Net worth KPI, Assets KPI, Liabilities KPI, 12-point trend, Cash and Savings under Assets, Cards and Loans under Liabilities | Clean presentation |
| Privacy boundary | Carissa views `/net-worth` | Simon's private account omitted, Carissa's private account included, shared figures match Simon's | No private leak |
| 12-point trend | 12 months of balance history | 12 points matching month-end balances; table toggle displays 12 rows | Fallback if 0 points |
| Stale account | Account with `lastImport.through` > 45 days ago | Account row shows stale date in warning color with clickable "Import" shortcut | Valid popover open |
| Private account row | Viewer owns private savings account | Row displays lock icon with "Private: only you can see this" aria-label | Only on private |
| Zero accounts | Fresh user with no accounts | Empty state card prompting import or account creation | Empty state UI |
| Table view toggle | User clicks "View as table" | Swaps trend chart canvas for tabular list of 12 trend points | In-place view toggle |

</frozen-after-approval>

## Code Map

- `packages/app/src/reports/net-worth.ts` -- `netWorth(ctx, input)` usecase: aggregates cash, card, loan accounts, subtotals by type, and derives 12-point trend on read.
- `packages/app/src/reports/net-worth.test.ts` -- unit tests for `netWorth`: hand sums, private isolation, shared parity, 12 month-end trend points, and empty accounts.
- `packages/app/src/reports/index.ts` -- export `netWorth`, `netWorthInput`, `NetWorthReport`.
- `packages/app/src/index.ts` -- re-export net worth types and use case.
- `apps/server/src/http/app.ts` -- add `GET /api/reports/net-worth` route with `asOf` query param.
- `apps/web/src/api.ts` -- export `NetWorthReport` and `fetchNetWorth()` API client function.
- `apps/web/src/routes/net-worth.tsx` -- create TanStack router route for `/net-worth`.
- `apps/web/src/router.tsx` -- register `netWorthRoute` in `routeTree`.
- `apps/web/src/components/AppSidebar.tsx` -- add `Net worth` navigation link between Cash flow and Spending.
- `apps/web/src/components/MobileNav.tsx` -- enable `Net worth` navigation action in More sheet.
- `apps/web/src/pages/NetWorthPage.tsx` -- `/net-worth` page: 3-up KPIs, trend card (chart + table toggle), Assets & Liabilities cards, account rows with staleness & private locks, empty state, disabled Forecast link.
- `apps/web/src/pages/NetWorthPage.test.tsx` -- component tests for `/net-worth`: KPIs, trend table toggle, account rows, stale import shortcut, empty state.
- `e2e/net-worth.spec.ts` -- Playwright e2e test verifying `/net-worth` navigation, KPI totals, private account isolation, and table view.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/reports/net-worth.ts` -- implement `netWorth(ctx, input)` use case over cash, card, and loan accounts using `balanceAsOf`, computing assets, liabilities, subtotals by type, and 12-point trend.
- [x] `packages/app/src/reports/net-worth.test.ts` -- unit test `netWorth` against hand sums, partner privacy isolation, shared accounts match, 12-point month-end trend, and empty accounts.
- [x] `packages/app/src/reports/index.ts` and `packages/app/src/index.ts` -- export net worth use case and types.
- [x] `apps/server/src/http/app.ts` -- register `GET /api/reports/net-worth` route.
- [x] `apps/web/src/api.ts` -- add `fetchNetWorth` client helper.
- [x] `apps/web/src/routes/net-worth.tsx` and `apps/web/src/router.tsx` -- declare and register `/net-worth` route.
- [x] `apps/web/src/components/AppSidebar.tsx` and `apps/web/src/components/MobileNav.tsx` -- activate `/net-worth` link in desktop sidebar and mobile navigation.
- [x] `apps/web/src/pages/NetWorthPage.tsx` -- build `/net-worth` page with KPIs, trend chart + table toggle, Assets and Liabilities cards, account rows, stale captions, private lock, empty state, and disabled Forecast card.
- [x] `apps/web/src/pages/NetWorthPage.test.tsx` -- unit and component tests for `/net-worth` page rendering, view toggle, and interactions.
- [x] `e2e/net-worth.spec.ts` -- e2e test asserting partner privacy, report totals matching hand sum, and empty state.

**Acceptance Criteria:**
- Given either partner viewing `/net-worth`, when accounts exist, then Net worth equals a hand sum of the accounts they can see, never includes the other partner's private accounts, and shared figures match for both partners.
- Given 12 months of balance history, when viewing the trend, then the trend has 12 points that match month-end balances.
- Given an account whose last import is older than 45 days, when rendered in an account card, then it displays the stale warning and an Import shortcut link.
- Given an account marked private, when rendered for its owner, then it displays the lock icon and `Private: only you can see this` indicator.
- Given a household with zero accounts, when viewing `/net-worth`, then the page renders its empty state with no accounts.
- Given the full verification suite, when run, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm e2e` pass cleanly.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment)

Counts: high 1 · medium 4 · low 9 · false 0 · maybe-false 0 (14 findings).

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | blind, verification-gap | Account closure filtering in netWorth omits historical balances from trend calculation | high | patch | In `net-worth.ts`, filter accounts per trend point by `!isClosed(a, date)`. |
| 2 | blind, edge | Malformed negative currency formatting on trend chart Y-axis outputs `$-50k` | medium | patch | In `NetWorthPage.tsx`, format negative values with minus sign before dollar sign (`-$50k`). |
| 3 | blind, edge | `Math.min`/`Math.max` on empty trend evaluates to Infinity in chart aria-label | low | patch | In `NetWorthPage.tsx`, guard with `trend.length > 0 ? ... : 0`. |
| 4 | blind | Trend chart line and axis styling uses unparsed CSS variables in Canvas 2D | low | patch | In `NetWorthPage.tsx`, provide valid hex colors or resolved styles. |
| 5 | blind | Trend chart tooltip omits Assets and Liabilities breakdown | low | patch | In `NetWorthPage.tsx`, include Assets and Liabilities breakdown in tooltip. |
| 6 | blind | Last point in trend chart hardcodes "Today" even for past asOf dates | low | patch | In `NetWorthPage.tsx`, label as "Today" only when `p.date === today`. |
| 7 | blind | Account rows display account name as plain text without drill-down link | medium | patch | In `NetWorthPage.tsx`, wrap account names in `<Link to="/accounts/$id">`. |
| 8 | blind | Trend table displays raw ISO dates and oldest-first | low | patch | In `NetWorthPage.tsx`, format Month column with month/year and sort reverse-chronological. |
| 9 | blind | Accounts with no prior imports display "No imports yet" without an Import button | low | patch | In `NetWorthPage.tsx`, add inline Import shortcut button for unimported accounts. |
| 10 | blind | Duplicate LockIcon SVG component | low | patch | In `NetWorthPage.tsx`, import and reuse `LockIcon` from `AccountsPage.tsx`. |
| 11 | blind | Accumulating totals inside `Array.prototype.map` | low | patch | In `net-worth.ts`, refactor accumulating totals into a clean loop. |
| 12 | verification-gap | Unverified exclusion of closed accounts on or before asOf | medium | patch | In `net-worth.test.ts`, add test verifying closed accounts are excluded from asOf but included in historical trend points when open. |
| 13 | verification-gap | Unverified statement import freshness resolution on populated accounts | low | patch | In `net-worth.test.ts`, add test verifying `latestImport` resolution selects the newest import. |
| 14 | verification-gap | MobileNav "Net worth" navigation action lacks test coverage | low | patch | In `e2e/shell.spec.ts`, add test asserting clicking "Net worth" in MobileNav More sheet reaches `/net-worth`. |

## Design Notes

Net worth uses `accounts.balanceAsOf` (AD-19) for each account across today (`asOf`) and 12 monthly points (`month.toPlainDate({ day: month.daysInMonth })`). Assets comprise `transaction`, `savings`, and `offset`; Liabilities comprise `credit_card` and `home_loan`. Per AD-12, liabilities are signed negative. Net worth is `assetsCents + liabilitiesCents`.
The `/net-worth` page follows the light/dark Clay & Linen design in `key-net-worth.html`, using ECharts canvas/SVG line chart for the trend with full "View as table" toggle for accessibility.

## Verification

**Commands:**
- `pnpm lint` -- expected: Biome and check-boundaries clean
- `pnpm typecheck` -- expected: clean TypeScript check across all packages
- `pnpm test` -- expected: all unit and component tests pass
- `pnpm e2e` -- expected: Playwright tests pass
