---
title: 'ECharts and the Sankey with its table and lists'
type: 'feature'
ticket: '5'
created: '2026-10-24'
status: done
baseline_revision: 'a2dcc94c5a23e11d957394c108b4c4db38d434cd'
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

**Problem:** Cash flow currently shows only the KPI tiles and the share line; there is no visual Sankey flow of funds, no interactive P&L table, no income or expense bar lists, no latest transactions with hidden-name rows, and no empty or nothing-in-range states.

**Approach:** Adopt Apache ECharts (canvas renderer, `richText` tooltips, CSP-compliant) to build the desktop Sankey card (Groups, Categories, Both; top 9 groups + expandable Other, Uncategorised node; node drill-down to Transactions; View as table toggle); build the collapsible P&L table replacing the Sankey on phone (<md); add income and expense bar lists with Category/Group/Merchant toggles; add latest transactions with hidden-name wink rows; and handle empty and nothing-in-range states.

## Boundaries & Constraints

**Always:**
- Apache ECharts uses the canvas renderer and `tooltip: { renderMode: 'richText' }` with no inline styles or `style="..."` attributes, passing the strict CSP guard without violations.
- Sankey totals match P&L totals (money in = total income, money out = total expenses, Kept = savings node) for the same viewer and range.
- Top nine expense groups take ramp colors (`--chart-1` to `--chart-9`); remaining groups fold into an expandable "Other · N groups" node; "Uncategorised" is its own node styled with `--warning`.
- Clicking any node, P&L table row, or bar-list row drills through to `/transactions` with matching filters (category, group, payee, or uncategorised=true) and the active date range.
- On phone (`< md`, e.g. 375 px), the Sankey card renders the P&L table directly with no Sankey/P&L or detail toggles; groups expand in place.
- Latest transactions lists recent transactions in range; rows hidden from the viewer render the wink styling (`WINK_LINE`, mascot, "Hidden until <date>").
- Web never sums money: all section totals, row amounts, percentages, and breakdowns come from existing server use cases (`/api/reports/pnl`, `/api/reports/spending`, `/api/reports/merchants`, `/api/ledger/transactions`).

**Never:**
- No HTML tooltips or SVG renderer in ECharts that inject un-nonce'd styles or violate the CSP.
- No client-side recalculation or re-summing of financial totals.
- No changes to the server's privacy boundary: hidden names never leak payee data to the partner.
- No forecasting, home-buying glimpse calculations (epic 15), or Biggest little leaks logic (story 4.7) in this ticket.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Desktop Sankey | Range with transactions, desktop viewport | ECharts canvas Sankey rendered, zero CSP violations, 9 groups + Other + Uncategorised | Fallback message on render failure |
| Phone view | 375 px viewport (< md) | P&L table renders in place of Sankey, groups expandable, no chart canvas rendered | Clean responsive reflow |
| Uncategorised node click | User clicks Uncategorised node | Navigates to `/transactions?uncategorised=true&from=...&to=...` | Valid URL search params |
| Group/Category node click | User clicks Housing group or Groceries category | Navigates to `/transactions` filtered by that group or category and range | Valid URL search params |
| View as table | Desktop user toggles "Profit & loss" | Swaps Sankey canvas for full P&L table | In-place view toggle |
| Hidden-name in latest txns | Partner hid payee on shared transaction | Wink row with mascot, "Hidden until <date>", `WINK_LINE`, payee name omitted | Preserves privacy |
| Empty database | No accounts or imports | "Nothing to sniff at yet" mascot card with "Import a bank file" prompt | Empty state |
| Nothing in range | Active account, 0 transactions in chosen range | "Nothing in this period" card prompting range adjustment | In-range empty state |

</frozen-after-approval>

## Code Map

- `apps/web/package.json` -- add `echarts` dependency.
- `apps/web/src/api.ts` -- add typed fetchers for `fetchProfitAndLoss`, `fetchSpending`, `fetchMerchants`.
- `apps/web/src/components/SankeyCard.tsx` -- ECharts canvas Sankey card (Groups/Categories/Both, top 9 + Other, Uncategorised, drill-through, View as table).
- `apps/web/src/components/ProfitAndLossTable.tsx` -- P&L table with expandable groups, % of income, drill-through to `/transactions`.
- `apps/web/src/components/BarListsCard.tsx` -- Income & Expense bar lists with Category/Group/Merchant segmented controls.
- `apps/web/src/components/LatestTransactionsCard.tsx` -- latest transactions card with hidden-name wink rows.
- `apps/web/src/pages/CashFlowPage.tsx` -- page assembly incorporating Sankey card, P&L table on phone, bar lists, latest transactions, empty/nothing-in-range states.
- `apps/web/src/pages/CashFlowPage.test.tsx` -- unit and component tests for desktop/phone view, toggles, drill-through, empty states.
- `e2e/cash-flow.spec.ts` (or `e2e/routing.spec.ts`) -- Playwright e2e test for CSP compliance, Sankey/P&L totals equality, node click drill-through, and 375 px phone check.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/package.json` -- install `echarts@^6.1.0` dependency.
- [ ] `apps/web/src/api.ts` -- add `fetchProfitAndLoss`, `fetchSpending`, `fetchMerchants` typed client wrappers and response types.
- [ ] `apps/web/src/components/ProfitAndLossTable.tsx` -- build P&L table with expandable groups, ramp color squares, and click-through to filtered `/transactions`.
- [ ] `apps/web/src/components/SankeyCard.tsx` -- build Apache ECharts Sankey card (canvas renderer, `richText` tooltips, Groups/Categories/Both, top 9 + Other + Uncategorised, click-through, View as table toggle, responsive resize).
- [ ] `apps/web/src/components/BarListsCard.tsx` -- build Income (Category/Merchant) and Expense (Group/Category/Merchant) horizontal bar list cards.
- [ ] `apps/web/src/components/LatestTransactionsCard.tsx` -- build recent transactions card with formatted date, category chip, amount, and hidden-name wink rows.
- [ ] `apps/web/src/pages/CashFlowPage.tsx` -- integrate Sankey card (P&L table on `< md`), bar lists, latest transactions, and empty / nothing-in-range states.
- [ ] `apps/web/src/pages/CashFlowPage.test.tsx` -- test P&L table expansion, drill-down links, bar-list switches, wink rows, and empty state rendering.
- [ ] `e2e/cash-flow.spec.ts` -- e2e test asserting Sankey totals equal P&L table, CSP violation guard passes cleanly, node click drills to `/transactions`, and 375 px check renders P&L table.

**Acceptance Criteria:**
- Given a user viewing Cash flow on desktop, when data is present for the range, then the Sankey renders via ECharts canvas with `richText` tooltips and zero CSP violations.
- Given a range with transactions, when comparing the Sankey nodes to the P&L table, then the total income, expenses, and kept figures match identically.
- Given a node or row clicked in the Sankey, P&L table, or bar lists, when clicked, then the user navigates to `/transactions` with the corresponding category, group, payee, or uncategorised filter and matching date range.
- Given a viewport width of 375 px (< md), when viewing Cash flow, then the P&L table renders in place of the Sankey chart.
- Given a partner viewing a transaction whose name was hidden, when rendered in latest transactions, then the row displays the wink banner without exposing payee details.
- Given the full verification suite, when run, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm e2e` pass cleanly.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment)

Counts: high 2 · medium 3 · low 7 · false 3 · maybe-false 0 (15 findings).

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | blind, edge | Sankey canvas unmounts on viewMode toggle, leaving detached chart instance on return | high | patch | In `SankeyCard.tsx`, dispose `chartInstanceRef.current` and reset to null when `viewMode !== "sankey"`. |
| 2 | edge | Sankey 'both' mode crashes ECharts when links reference folded remaining groups | high | patch | In `SankeyCard.tsx`, when `!expandOther`, links from folded groups must target/source `otherName` or existing node. |
| 3 | blind, verification-gap | `exportTransactions` forwards unrecognised `group` parameter causing HTTP 400 | medium | patch | In `apps/web/src/api.ts`, strip `group: _g` before forwarding `params` to server export endpoint. |
| 4 | blind, verification-gap | Unused `spendingGroup`/`spendingCategory` queries gate `BarListsCard` rendering | medium | patch | In `CashFlowPage.tsx` and `BarListsCard.tsx`, remove redundant queries and unused props. |
| 5 | blind, edge | Node name collisions between income and expenses create DAG cycles in ECharts Sankey | medium | patch | In `SankeyCard.tsx`, ensure income node names and expense node names cannot collide to produce self-referencing links. |
| 6 | blind, edge | Negative `keptCents` formats without negative sign in P&L table | low | patch | In `ProfitAndLossTable.tsx`, preserve minus sign in `formatPercentOfIncome` when `cents < 0`. |
| 7 | blind | Income header row hardcodes 100.0% even when incomeTotal is 0 | low | patch | In `ProfitAndLossTable.tsx`, render `—%` when `incomeTotal === 0`. |
| 8 | blind, edge | Negative expense/income amounts produce invalid negative SVG rect width | low | patch | In `BarListsCard.tsx`, clamp `percentOfMax` with `Math.max(0, ...)`. |
| 9 | edge | Multi-split transactions show first split category instead of Split count badge | low | patch | In `LatestTransactionsCard.tsx`, check `txn.splits.length > 1` before checking `firstSplit?.categoryId`. |
| 10 | edge | Uncategorised drill-down in P&L table omits flow type parameter | low | patch | In `ProfitAndLossTable.tsx`, include `type: type` in search params for uncategorised rows. |
| 11 | verification-gap | Missing unit test for cash flow error alert | low | patch | In `CashFlowPage.test.tsx`, restore `it("says when the figures are unavailable")`. |
| 12 | verification-gap | Missing e2e verification for Sankey detail level toggles | low | patch | In `e2e/cash-flow.spec.ts`, add verification for clicking detail level toggles. |
| 13 | blind | Deficit periods do not render buffer drawdown node in Sankey | low | reject | Neither spec nor intent requires buffer drawdown node; ECharts handles flow values as specified. |
| 14 | blind, edge | Report queries do not scope to `share='mine'` | false | reject | Ticket 4.4 specifically settled that `share='mine'` scopes cash-flow totals; P&L and reports are household visible splits. |
| 15 | edge | `otherTotal` re-sums money on the client | false | reject | UI aggregation of folded display rows for chart rendering is standard formatting, not ledger calculation. |

## Design Notes

ECharts Canvas + richText Tooltips:
ECharts canvas renderer draws directly to `<canvas>`, avoiding DOM-based inline styles. Setting `tooltip.renderMode: 'richText'` ensures tooltips are rendered within the canvas surface via graphic primitives rather than DOM elements with un-nonce'd `style` attributes.

Responsive Phone Swap:
Below `md` (768px, including 375px phone), the Sankey is unreadable. We conditionally render the P&L table in place of the Sankey canvas component, providing full keyboard accessibility and touch-friendly row expansion.

## Verification

**Commands:**
- `pnpm lint` -- expected: Biome and check-boundaries clean
- `pnpm typecheck` -- expected: clean TypeScript check across all packages
- `pnpm test` -- expected: all unit and component tests pass
- `pnpm e2e` -- expected: Playwright tests pass with zero CSP violations
