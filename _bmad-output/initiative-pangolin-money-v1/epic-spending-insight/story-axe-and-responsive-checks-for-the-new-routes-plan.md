---
title: 'Axe and responsive checks for the new routes'
type: 'feature'
ticket: '9'
created: '2026-10-25'
baseline_revision: '592e7d81e6a29057305a22e66236ac55bf2e0442'
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

**Problem:** The spending insight routes (`/cash-flow`, `/spending`, and `/net-worth`) require comprehensive accessibility verification in `axe.spec.ts` across light and dark modes, as well as automated checks for 375 px phone viewports and 320 px reflow (WCAG 1.4.10) with zero horizontal scrolling.

**Approach:** Add `/spending` and `/net-worth` (both chart view and table view) to the WCAG 2.2 AA audit suite in `axe.spec.ts`, and implement 375 px phone and 320 px reflow tests for `/cash-flow`, `/spending`, and `/net-worth` verifying zero horizontal scroll (`scrollWidth <= clientWidth`), proper component adaptation, and clean axe audits on mobile viewports.

## Boundaries & Constraints

**Always:**
- Audit `/spending` in both light and dark modes, asserting zero WCAG 2.2 AA violations with active share line, bar lists, category bars, and little leaks.
- Audit `/net-worth` in both light and dark modes, asserting zero WCAG 2.2 AA violations in both the default trend chart view and the "View as table" toggle view.
- Audit `/cash-flow`, `/spending`, and `/net-worth` at 320 px viewport width (WCAG 1.4.10 Reflow) ensuring `scrollWidth <= clientWidth` without horizontal scrollbar.
- Audit `/cash-flow`, `/spending`, and `/net-worth` at 375 px mobile viewport width ensuring proper phone layout adaptation (e.g. P&L table replacing Sankey chart on `/cash-flow`) with zero horizontal overflow and clean accessibility.
- Reuse standard test fixtures and helpers in `e2e/axe.spec.ts`: `alexSession(browser)`, `watchCsp(context, cspViolations)`, `setMode(page, mode)`, and `AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze()`.
- Preserve CSP compliance with zero CSP violations across all tests.

**Never:**
- No disabling or selective exclusion of WCAG 2.2 AA rules without documented upstream justification.
- No hacky `overflow-x: hidden` that truncates or clips critical numbers, action buttons, or interactive controls.
- No regression to existing page functionality or desktop layouts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `/spending` WCAG audit | Navigating to `/spending` in light/dark mode | 0 axe violations; share line, category bars, and bar lists compliant | Report violation details if any |
| `/spending` Custom date picker | Open Custom date range picker on `/spending` | Inputs (From/To) and buttons pass WCAG 2.2 AA audit | Report violation details if any |
| `/net-worth` chart view audit | Navigating to `/net-worth` in light/dark mode | 0 axe violations; KPIs, canvas chart, account cards compliant | Report violation details if any |
| `/net-worth` table view audit | Click "View as table" on `/net-worth` | 0 axe violations; 12-point trend table accessible with clean headers | Report violation details if any |
| 320 px Reflow (`/cash-flow`) | Viewport 320x800 on `/cash-flow` | `scrollWidth <= clientWidth`, no horizontal scrolling | Reflow failure if scrollWidth > clientWidth |
| 320 px Reflow (`/spending`) | Viewport 320x800 on `/spending` | `scrollWidth <= clientWidth`, no horizontal scrolling | Reflow failure if scrollWidth > clientWidth |
| 320 px Reflow (`/net-worth`) | Viewport 320x800 on `/net-worth` | `scrollWidth <= clientWidth`, no horizontal scrolling | Reflow failure if scrollWidth > clientWidth |
| 375 px Phone (`/cash-flow`) | Viewport 375x667 on `/cash-flow` | P&L table renders instead of canvas, 0 horizontal scroll | Layout assertion |
| 375 px Phone (`/spending`) | Viewport 375x667 on `/spending` | Cards stack vertically, 0 horizontal scroll | Layout assertion |
| 375 px Phone (`/net-worth`) | Viewport 375x667 on `/net-worth` | Account cards and KPIs stack cleanly, 0 horizontal scroll | Layout assertion |

</frozen-after-approval>

## Code Map

- `e2e/axe.spec.ts` -- primary test suite: add `/spending` and `/net-worth` audits, and 375 px phone / 320 px reflow test suite for `/cash-flow`, `/spending`, and `/net-worth`.
- `apps/web/src/pages/CashFlowPage.tsx` -- Cash flow page layout; check and fix any container styles that cause overflow at 320 px or 375 px.
- `apps/web/src/pages/SpendingPage.tsx` -- Spending page layout; check and fix any container or header styles that cause overflow at 320 px or 375 px.
- `apps/web/src/pages/NetWorthPage.tsx` -- Net worth page layout; check and fix any container, KPI tile, or table styles that cause overflow at 320 px or 375 px.
- `apps/web/src/components/SpendingCategoryBarsCard.tsx` -- verify category progress track and amounts don't overflow at 320 px.
- `apps/web/src/components/BarListsCard.tsx` -- verify two-column bar lists collapse/wrap cleanly at 320 px and 375 px.
- `apps/web/src/components/BiggestLittleLeaksCard.tsx` -- verify leak cards wrap without clipping or horizontal scroll at 320 px.

## Tasks & Acceptance

**Execution:**
- [x] `e2e/axe.spec.ts` -- add `/spending` accessibility audit across light and dark modes with date range controls and cards.
- [x] `e2e/axe.spec.ts` -- add `/net-worth` accessibility audit across light and dark modes for both chart view and table view.
- [x] `e2e/axe.spec.ts` -- add 320 px reflow test block verifying zero horizontal scroll (`scrollWidth <= clientWidth`) on `/cash-flow`, `/spending`, and `/net-worth`.
- [x] `e2e/axe.spec.ts` -- add 375 px phone test block verifying mobile layout adaptation and zero horizontal scroll on `/cash-flow`, `/spending`, and `/net-worth`.
- [x] `apps/web/src/` (as needed) -- inspect and fix any styling issues or element overflows identified on the three routes at 320 px or 375 px viewports.

**Acceptance Criteria:**
- Given a user viewing `/spending` in light or dark mode, when audited with AxeBuilder for WCAG 2.2 AA tags, then zero accessibility violations are found.
- Given a user viewing `/net-worth` in light or dark mode in chart view and table view, when audited with AxeBuilder for WCAG 2.2 AA tags, then zero accessibility violations are found.
- Given any of `/cash-flow`, `/spending`, or `/net-worth` loaded at a 320 px viewport width, then `document.documentElement.scrollWidth <= document.documentElement.clientWidth` (no horizontal scrollbar).
- Given any of `/cash-flow`, `/spending`, or `/net-worth` loaded at a 375 px viewport width, then `document.documentElement.scrollWidth <= document.documentElement.clientWidth` and mobile-adapted components (such as P&L table on Cash flow) render properly.
- Given the verification suite, then `pnpm lint`, `pnpm typecheck`, and `pnpm test:axe` (or e2e) pass cleanly with zero CSP violations.

## Implementation Notes

- Added `/spending` light & dark mode WCAG 2.2 AA audit tests including custom date picker controls in `e2e/axe.spec.ts`.
- Added `/net-worth` light & dark mode WCAG 2.2 AA audit tests covering both chart view and "View as table" toggle in `e2e/axe.spec.ts`.
- Added WCAG 1.4.10 320 px reflow test suite in `e2e/axe.spec.ts` asserting zero horizontal scroll (`scrollWidth <= clientWidth`) and clean axe audit for `/cash-flow`, `/spending`, and `/net-worth`.
- Added 375 px phone responsive audit test suite in `e2e/axe.spec.ts` asserting mobile component adaptation, zero horizontal scroll, and clean axe audit for `/cash-flow`, `/spending`, and `/net-worth`.
- Replaced inline style on `AccountRowItem` in `apps/web/src/pages/NetWorthPage.tsx` with an SVG circle fill to adhere strictly to CSP. Added `scope="col"` to table header cells.
- Enhanced KPI tile responsiveness with `min-w-0` and responsive text sizing in `apps/web/src/pages/CashFlowPage.tsx`.

## Plan Change Log

## Review Triage Log

### Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment)
- **VG1** (verification-gap): `medium` -> `patch`. 320 px reflow audit checked `scrollWidth` before dynamic content loaded; patch waits for representative content testid (`cash-flow-tiles`, `bar-lists-card`, `net-worth-kpis`) before evaluating overflow, and checks `Math.max(documentElement.scrollWidth, body.scrollWidth)`.
- **BH1** (blind-hunter): `low` -> `patch`. Table view on `/net-worth` at 320 px reflow is unverified; patch toggles table view in 320 px reflow audit.
- **BH2** (blind-hunter): `false` -> rejected. WCAG 1.4.10 reflow focuses on viewport geometry and layout overflow; color and theme contrast are verified comprehensively across all themes in the desktop audit.
- **BH3** (blind-hunter): `low` -> `patch`. `setMode` called after UI interaction on `/spending`; patch calls `setMode` upon load and audits both initial state and custom date range.
- **BH4** (blind-hunter): `low` -> `defer`. Missing `<th scope="row">` in `NetWorthTrendTable`; pre-existing from story 4.8.
- **BH5** (blind-hunter): `low` -> `defer`. Horizontally scrollable tables lack `tabIndex={0}`; pre-existing pattern across the app.
- **BH6** (blind-hunter): `low` -> `defer`. Responsive sizing on Net Worth KPIs; already stacked in single column (`grid-cols-1`) on mobile.
- **BH7** (blind-hunter): `false` -> rejected. `NetWorthPage.tsx` already uses `<h2>`, not `<h1>`.
- **BH8** (blind-hunter): `low` -> `defer`. Ambiguous import button label on stale account; pre-existing from story 4.8.
- **BH9** (blind-hunter): `low` -> `patch`. `scrollWidth` check only tested `documentElement`; patch uses `Math.max(documentElement.scrollWidth, body.scrollWidth)`.

## Verification

**Commands:**
- `./node_modules/.bin/biome check .` -- expected: Checked files, no fixes needed
- `node scripts/check-boundaries.ts` -- expected: Package boundaries: ok
- `./node_modules/.bin/tsc -p tsconfig.json` -- expected: 0 errors
- `./node_modules/.bin/tsc -p e2e/tsconfig.json` -- expected: 0 errors
- `pnpm test:axe` (or `npx playwright test axe.spec.ts --no-deps`) -- expected: All axe and responsive tests pass
