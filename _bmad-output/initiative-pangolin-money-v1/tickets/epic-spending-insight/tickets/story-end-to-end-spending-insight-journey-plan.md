---
title: 'End-to-end spending-insight journey'
type: 'test'
ticket: '11'
created: '2026-10-25'
status: done
baseline_revision: '073b5916af7c9161525effb8ef866e5c47362562'
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

**Problem:** While individual unit, component, and isolated feature tests exist for Epic 4, there is no end-to-end Playwright journey verifying the complete cross-epic spending and cash-flow insight user journey for both partners on the seeded household.

**Approach:** Implement `e2e/spending-insight.spec.ts` to exercise a single cohesive Playwright journey for both household partners (Alex and Sam), validating the landing redirect, Sankey view switching and P&L totals, apportioned share line and toggle, household 50/50 attribution setting change, Spending page category bars, Biggest Little Leaks drill-down, and Net Worth private account privacy and 12-month trend against Done-when 1 to 4.

## Boundaries & Constraints

**Always:**
- Exercise the journey for both partners (Alex with credentials, Sam via partner session) on the seeded household without altering or mutating seeded ledger data.
- Validate Done-when 1 through 4:
  1. Hand-sum equality across KPI totals, Sankey, P&L table, and Spending category bars for the active period.
  2. Net worth private account privacy (each partner sees only their own private accounts, never the other's) and identity of shared figures.
  3. Apportioned share line reflects contribution percentages, updates when 50/50 setting is applied in Settings, and is restored afterwards.
  4. Landing redirect from `/` to `/cash-flow`, 12-month net worth trend chart and table view, Biggest little leaks tiles and drill-down, and 'My share / Everything I can see' toggle beneath the always-visible apportioned share line.
- Monitor all browser contexts with `watchCsp` to ensure zero Content Security Policy violations.
- Cleanly reset the household attribution setting to "By contribution" after testing 50/50 so subsequent specs remain unaffected.

**Never:**
- Do not mutate or delete existing transactions or accounts in the seeded database.
- Do not hardcode unstable dynamic IDs or timestamps that diverge from seeded fixtures.
- Do not add new external npm dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Landing redirect | User navigates to `/` | Redirects to `/cash-flow`; header displays "Cash flow"; 4 KPI tiles and apportioned share line render | Asserts URL pathname equals `/cash-flow` |
| Sankey & P&L totals | Detail toggles "Groups", "Categories", "Both"; switch to "Profit & loss" table | Chart options update; P&L table income, expenses, and kept equal KPI tile values | Fails if table figures diverge from KPI values |
| Share toggle | Click "My share" then "Everything I can see" | URL reflects `share=mine` and removes param; KPI tiles update to apportioned figures; share line remains visible | Asserts URL query parameter and tile text updates |
| Household 50/50 setting | Navigate to `/settings#household`, select "50/50" radio | PATCH `/api/system/household` succeeds; Cash flow share line indicates 50/50 split; toggle resets to "By contribution" | Fails if PATCH status != 200 or share line fails to update |
| Spending & leaks | Navigate to `/spending`; locate Biggest little leaks tile | Spending category breakdown renders with sum matching total; leaks tile lists qualifying merchants and drills to `/transactions` | Asserts drill-down URL contains filtered query |
| Net worth & privacy | Navigate to `/net-worth` as Alex, then as Sam | Each sees only their private accounts with lock icon; shared accounts and values are identical; trend table has 12 monthly rows | Fails if partner sees other partner's private account |

</frozen-after-approval>

## Code Map

- `e2e/spending-insight.spec.ts` -- New end-to-end journey spec covering ticket 4.11 and Done-when 1-4 for both partners.
- `e2e/helpers/account.ts` -- Account helpers (`loadAccount`, `partnerSessionFile`, `signInWithPassword`) for authenticating Alex and Sam.
- `e2e/helpers/csp.ts` -- CSP guard (`test`, `expect`, `watchCsp`) to detect any security policy violations across contexts.
- `e2e/cash-flow.spec.ts` -- Reference for Cash Flow tiles, Sankey controls, and P&L table assertions.
- `e2e/spending.spec.ts` -- Reference for Spending page bar lists, category breakdown sums, and period change calculations.
- `e2e/net-worth.spec.ts` -- Reference for Net Worth 3-up KPIs, asset/liability cards, private account lock checks, and 12-month trend toggle.
- `e2e/settings.spec.ts` & `e2e/ledger.spec.ts` -- Reference for `/settings#household` attribution radiogroup interactions and PATCH confirmation.

## Tasks & Acceptance

**Execution:**
- [x] `e2e/spending-insight.spec.ts` -- Implement end-to-end spending insight journey spec -- Build the complete user journey across `/cash-flow`, `/settings`, `/spending`, and `/net-worth` for both partners with CSP monitoring and Done-when 1-4 verification.
- [x] `playwright.config.ts` -- Verify spec inclusion and dependency ordering -- Ensure `spending-insight.spec.ts` executes within the chromium test suite following seeded ledger initialization.

**Acceptance Criteria:**
- Given a seeded household in CI, when `/` is requested, the browser lands on `/cash-flow` showing the 4 KPI tiles, the apportioned share line, and the share toggle.
- Given the Cash Flow page, switching between Sankey detail levels and P&L table view displays figures matching the KPI tiles and seeded splits.
- Given `/settings#household`, toggling shared attribution to 50/50 updates the share line on `/cash-flow` to equal halves for both partners, and reverting restores contribution apportionment.
- Given `/spending`, category totals equal the hand sum of expense categories, and Biggest little leaks shows qualifying merchants with working drill-downs to `/transactions`.
- Given `/net-worth`, Alex and Sam each see their own private accounts, never the other person's, while shared accounts and net worth totals are identical for shared components, and the trend table displays 12 monthly rows.
- Given all navigation and interactions across the journey, 0 CSP violations are recorded.

## Implementation Notes

- Implemented `e2e/spending-insight.spec.ts` testing the complete cross-epic user journey across Cash Flow, Settings, Spending, and Net Worth for both Alex and Sam on the seeded household.
- Verified Done-when 1: Hand-sum equality between KPI tiles and P&L table on Cash Flow, as well as category rows sum vs. total expenses on Spending.
- Verified Done-when 2: Net Worth private account privacy (neither partner can see the other's private accounts in UI or API) and verified exact identity of shared accounts and balances.
- Verified Done-when 3: Apportioned share line and 50/50 attribution toggle in Settings, checking both partners see 50/50 equal split on Cash Flow, wrapped in a `try...finally` block that safely restores "By contribution" setting for subsequent specs.
- Verified Done-when 4: Landing redirect from `/` to `/cash-flow`, 12-month net worth trend chart and table view toggle (12 monthly points), Biggest Little Leaks card and drill-down to `/transactions?payee=...`, and "My share / Everything I can see" toggle under the always-visible apportioned share line.
- Monitored all browser contexts with `watchCsp` to enforce 0 Content Security Policy violations.
- Verified `playwright.config.ts` test match configuration: `spending-insight.spec.ts` is matched by `**/*.spec.ts` under the `chromium` project and runs following seeded ledger initialization.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 0 medium, 5 low patches; 0 deferred; 1 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| low | patch | Drill-down links for P&L table and Biggest Little Leaks were guarded by `if ((await loc.count()) > 0)` which bypassed checks if rendering was asynchronous; replaced with `await expect(loc).toBeVisible()` auto-waiting assertions. |
| low | patch | Category rows count assertion used non-retrying `expect(await categoryRows.count()).toBe(...)`; replaced with auto-retrying `await expect(categoryRows).toHaveCount(...)`. |
| low | patch | `new URL(page.url()).searchParams` fallback was empty string if URL params had not synchronized, risking 400 Bad Request on reports API; added `quarterRange(today)` fallback so valid `from` and `to` params are always passed. |
| low | patch | Partner session checks were conditionally executed on `existsSync(partnerSessionFile)` without assertion, potentially silently skipping partner validations; added explicit `expect(existsSync(partnerSessionFile)).toBe(true)` assertion. |
| low | patch | Setting reversion in `finally` block relied solely on UI interaction which could throw if DOM changed; added API PATCH fallback in `catch` block to guarantee attribution reset. |
| low | reject | Finding suggested breaking the single journey test into isolated separate test blocks; rejected because ticket 4.11 and epic Done-when criteria explicitly specify "One Playwright journey across the epic for both partners on the seeded household". |

## Verification

**Commands:**
- `pnpm exec biome check e2e/` -- expected: No lint or formatting errors in e2e files.
- `pnpm --filter @pangolin/e2e typecheck` -- expected: TypeScript compilation passes with zero errors.
- `node scripts/check-boundaries.ts` -- expected: Monorepo boundaries valid (exit code 0).
