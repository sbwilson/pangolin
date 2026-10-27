---
title: 'Report core: groups, categories, merchants and the date range'
type: 'feature'
ticket: '2'
created: '2026-10-23'
status: done
baseline_revision: '3e8bb5cb3dd6498e278410e4623fca8f1fe0496b'
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

**Problem:** Cash flow shows only three totals for a fixed quarter: there is no P&L by group or category, no spending or merchant breakdown, no uncategorised total, and no way to pick the period.

**Approach:** One per-viewer SQL breakdown of visible splits by flowKind, category and visible merchant, feeding use cases and routes for P&L (by group or category), spending and merchants; a savings rate on the cash-flow report; and on `/cash-flow` a header date-range control (Quarter · FY to date · Custom, chevrons) held in the URL above a four-tile KPI row.

## Boundaries & Constraints

**Always:**
- Only `income` and `expense` splits (4.1 `flowKindSql`) count; `transfer` and `investing` appear nowhere. Sections are by flowKind; rows name the split's category and that category's group, including soft-deleted categories. P&L income total = 4.1 money in, expense total = money out, for the same viewer and range.
- Uncategorised splits (no category) are one row with `id: null` in each section, and the P&L response also carries `uncategorised: {inCents, outCents}`.
- Merchant = payee, grouped by `visibleTxn`'s projected `payeeId`/`payeeName`, so hidden-name and other-person-scoped rows fall into the one `payeeId: null` bucket with rows that have no payee; never group by the raw `payee_id`.
- Amounts are positive cents per row (money out as positive, like 4.1); rows sorted by amount desc, then name, then id. All sums on the server; the web formats only.
- Savings rate = kept ÷ money in, returned as `savingsRatePermille` (integer, rounded half away from zero, may be negative), `null` when money in ≤ 0; shown with one decimal ("37.3%", "—%" when null).
- Range: inclusive `from`/`to` in the `/cash-flow` URL; absent, malformed or reversed → current quarter. Quarter is pressed for any aligned calendar quarter, FY to date for 1 Jul–30 Jun or 1 Jul–today of the current FY, else Custom. Chevrons step by that unit (quarter ±1; FY ±1 full year, the current FY to date; Custom by its length in days); next is disabled when the stepped range would start after today.
- Every new `/api` route is in `route-manifest.ts`, replayed with real ranges in `privacy.test.ts`, and observed by `hiddenNameScenario`.

**Never:**
- No Sankey, bar lists, P&L table UI, share line, empty or nothing-in-range states, drill-through, greeting/freshness/Import header (entries 4.4, 4.5).
- No KPI note lines: tiles show label and figure only (decision 2026-10-23, user).
- No transaction counts, percent-of-income columns or stored totals; no change to the Transactions page's own range control.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| P&L by group | seeded range, `by=group` | income/expense rows per group, totals equal 4.1 in/out | No error expected |
| P&L by category | `by=category` | rows carry `groupId`/`groupName` | No error expected |
| Refund | +40 in Groceries | income section, row Groceries | No error expected |
| Hidden name on shared row | A hid a payee-bearing shared row | B's merchants: amount in `payeeId: null` bucket, no payee name anywhere; A sees the payee | No error expected |
| Deleted category | split's category soft-deleted | still its own named row | No error expected |
| No money in | range with only spending | `savingsRatePermille: null` | No error expected |
| Bad query | missing/bad `by`, `flow`, or range | 400 | Zod validation |
| URL junk | `/cash-flow?from=x&to=2026-01-01` | current quarter shown and requested | Dropped by validateSearch |

</frozen-after-approval>

## Code Map

- `packages/db/src/privacy.ts` -- `visibleTxn` (`payeeId`/`payeeName` projections), `flowKindSql`; add nothing that reads raw payee.
- `packages/db/src/ledger-repos.ts` `cashFlowTotals` -- model for the new `flowBreakdown`; join `category` and `category_group` directly (not `CategoryRepo.list`, which drops deleted).
- `packages/app/src/ports/unit-of-work.ts` (`CashFlowTotals`, `DayRange`, `ReadRepos` list), `packages/app/src/testing/memory-uow.ts` (`splitFlowKindFor`, hidden/payee-scope logic used by `transferLabelFor`/list views) -- port and mirror.
- `packages/app/src/testing/flow-kind-parity.test.ts` -- scenario + SQLite-vs-memory loops to extend.
- `packages/app/src/reports/cash-flow-totals.ts` -- use-case/Zod pattern; add `savingsRatePermille` here.
- `apps/server/src/http/app.ts` `/api/reports/cash-flow` -- route pattern; `app.test.ts` tests.
- `apps/server/src/http/cash-flow-seed.test.ts` `handSum` (~:137) -- extend to per group, category and visible payee (read seed `payee` and name-hidden events).
- `apps/server/src/privacy/{route-manifest.ts:225,privacy.test.ts:136 CASH_FLOW_QUERIES,privacy-scenarios.ts:106 hiddenNameScenario (observed paths ~:200)}`.
- `apps/web/src/lib/date-range.ts` -- `DateRange`, `quarterRange`, `fyToDateRange`, `localDay`; add unit detection, stepping, label.
- `apps/web/src/routes/search.ts:83` `isRealDay` / reversed-pair drop -- reuse for `/cash-flow` validateSearch.
- `apps/web/src/pages/TransactionList.tsx:142-215` -- existing preset buttons and Custom `DateInput`s to mirror (fieldset "Date range", `aria-pressed`); do not refactor it.
- `apps/web/src/pages/CashFlowPage.tsx`, `routes/cash-flow.tsx`, `api.ts` `fetchCashFlow`.
- `e2e/routing.spec.ts:92-112`, `e2e/axe.spec.ts:180`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/ledger-repos.ts`, `packages/app/src/testing/memory-uow.ts` -- `flowBreakdown(viewer, today, range)`: rows `{kind, groupId, groupName, categoryId, categoryName, payeeId, payeeName, cents}` grouped by kind, category and projected payee, income/expense only -- the one report aggregate.
- [x] `packages/app/src/testing/flow-kind-parity.test.ts` -- SQLite vs memory `flowBreakdown` per viewer, including hidden-name, scoped payee, deleted category and uncategorised rows.
- [x] `packages/app/src/reports/{profit-and-loss,spending,merchants}.ts` (+ tests, index exports) -- `profitAndLoss(ctx,{from,to,by})`, `spending(ctx,{from,to,by})` (expense section only), `merchants(ctx,{from,to,flow})` folding `flowBreakdown`; tests per viewer, including B's result unchanged when only A's private data changes.
- [x] `packages/app/src/reports/cash-flow-totals.ts` (+ test) -- add `savingsRatePermille`.
- [x] `apps/server/src/http/app.ts`, `app.test.ts`, `privacy/route-manifest.ts`, `privacy/privacy.test.ts`, `privacy/privacy-scenarios.ts` -- `GET /api/reports/pnl?from&to&by`, `/api/reports/spending?from&to&by`, `/api/reports/merchants?from&to&flow`; 200/400/401 tests; privacy replay and hidden-name observation.
- [x] `apps/server/src/http/cash-flow-seed.test.ts` -- per partner and range, P&L (both `by`), spending and merchants equal hand sums; P&L totals equal cash-flow in/out.
- [x] `apps/web/src/lib/date-range.ts` (+ test) -- `rangeUnit`, `stepRange`, `rangeLabel` ("Jul – Sep 2026"; "3 Feb – 14 Mar 2026" for custom).
- [x] `apps/web/src/components/DateRangeControl.tsx` (+ test) -- chevrons, range label, Quarter · FY to date · Custom, Custom From/To inputs; emits a `DateRange`.
- [x] `apps/web/src/routes/cash-flow.tsx`, `pages/CashFlowPage.tsx` (+ test) -- validateSearch `from`/`to`; header with title and control writing the URL; four tiles Money in, Money out, Kept, Savings rate.
- [x] `e2e/routing.spec.ts` -- preset, chevron and Custom change the URL and the request; reload keeps the range; axe still passes on `/cash-flow`.

**Acceptance Criteria:**
- Given a partner on `/cash-flow`, when they press FY to date, then the URL holds the FY range, the tiles refetch for it, and reloading shows the same range.
- Given the seeded household, when each partner requests P&L, spending and merchants for a range, then every row equals a hand sum of their visible splits.
- Given only A's private data or a hidden name changes, when B calls any new route, then the response bytes are unchanged.
- Given the full suite, when run, then lint, typecheck, unit, Playwright and axe pass.

## Implementation Notes

- Port: `TransactionRepo.flowBreakdown(viewer, today, range)` → `FlowBreakdownRow[]` (kind, group, category, projected payee, positive `cents`), ordered kind, category id, payee id (nulls first) on both SQLite and memory. SQL groups on `visibleTxn`'s `payeeId`/`payeeName` and joins `category`/`category_group` directly, so deleted categories keep their names.
- Shared fold in `packages/app/src/reports/breakdown.ts` (`rangeInput`, `section`, row sort: cents desc, name, id, nulls last). Uncategorised rows have `id`/`name` (and by-category `groupId`/`groupName`) null. By-group rows carry `{id, name, cents}`; by-category rows add `groupId`/`groupName`.
- `savingsRatePermille(kept, in)`: exact BigInt half-away-from-zero rounding, null when in ≤ 0; exported.
- Web: `rangeUnit`, `stepRange`, `isLastStep`, `rangeLabel` in `lib/date-range.ts`. Labels beyond the plan's two examples: a whole FY is "FY2026", the current FY to date "FY2027 to date", a custom range across years "3 Dec 2025 – 14 Jan 2026", one day "3 Feb 2026". Chevrons are text glyphs with aria-labels "Previous/Next quarter|year|period". A range that is both an aligned quarter and the FY to date (today = 30 Sep) shows as Quarter.
- `/cash-flow` validateSearch (`validateCashFlowSearch` in `routes/search.ts`) keeps `from`/`to` only as a real, ordered pair; otherwise neither (current quarter). The page does not write the default quarter into the URL.
- No web fetchers for the three new routes (no UI uses them until 4.4/4.5).
- Seed hand sums: the default seed's hidden names carry no payee, so the hidden-payee null bucket is proven by the parity, use-case and privacy suites rather than the seed test.
- Added perf cases for `pnl?by=category` and `merchants?flow=expense` beside the 4.1 cash-flow one in `ledger-perf.test.ts`.
- e2e: Playwright `getByRole("button", { name: "Quarter" })` also matches "Previous/Next quarter", so the e2e uses `exact: true`. Axe on `/cash-flow` now audits with Custom's From/To open.

## Plan Change Log

## Review Triage Log

### Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment)

Counts: high 0 · medium 1 · low 15 · false 5 · maybe-false 0 (21 findings).

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | blind ×2, edge, verification-gap | `customOpen` is set once at mount, so Custom stays pressed (and From/To open) after a chevron, back/forward or link moves the range to a preset | medium | patch | `DateRangeControl.tsx` `useState(unit === "custom")`, reset only in `pick()`. Reset it whenever `range` changes. |
| 2 | blind | e2e range test fails on 30 Sep (FY to date is then an aligned quarter) | low | patch | Real clock in `routing.spec.ts`; pin the browser clock for that test. |
| 3 | blind ×2, edge | Hard-coded `cash-flow-from`/`-to` ids clash if the control is reused | low | patch | Use `useId()`. |
| 4 | blind | Tiles vanish to "Loading…" on every range change | low | patch | New query key has no data; add `placeholderData: keepPreviousData`. |
| 5 | verification-gap (+ blind) | Row tie-break (name, then id, nulls last) untested | low | patch | All asserted arrays have distinct cents; seed test re-sorts. Add an equal-amounts case. |
| 6 | blind | `cashFlowTotalsInput` duplicates `rangeInput` | low | patch | Rebase it on `rangeInput({})` so the four routes validate alike. |
| 7 | blind | Stale `CashFlowTotals` doc comment in `apps/web/src/api.ts` | low | patch | Mention the savings rate. |
| 8 | edge | Seed hand sum can produce `-0` against the server's `0` for savings rate | low | patch | `Object.is` in `toEqual`; normalise with `\|\| 0` or call `savingsRatePermille`. |
| 9 | edge | A 0-cent split yields a 0-cent row in P&L, spending and merchants | low | patch | flowKind's ELSE makes it `expense`; drop zero-amount splits in SQL and memory. |
| 10 | blind | Every Custom edit pushes a history entry | low | reject | Fix needs a new `onChange` parameter for replace vs push; minor. |
| 11 | blind | Reversed/cleared From/To rejected silently | low | reject | Adds new UI (inline error). |
| 12 | blind | `privacy.test.ts` hidden-name assertion is weak | low | reject | Paired worlds prove B is independent of the hidden payee; `breakdown.test.ts` asserts B's exact merchant rows. |
| 13 | blind | Seed has no payee-bearing hidden name | low | reject | Needs a seed change that shifts every seeded expectation; covered by parity, use-case and privacy tests. |
| 14 | blind | Spending route has no perf case | low | reject | Same aggregate as the timed `pnl` case. |
| 15 | blind | Negative savings rate may use a different minus than money tiles | low | reject | Cosmetic; no evidence of a mismatch shown. |
| 16 | edge | Years 0000–0099 make `Date.UTC` jump centuries | low | reject | Unreachable in everyday use; fix adds bounds. |
| 17 | blind | By-group fold merges a category with a missing group into uncategorised | false | reject | `category.group_id` is a NOT NULL foreign key and groups are never deleted. |
| 18 | edge | SQLite `flowBreakdown` skips `requireDay` | false | reject | `visibleTxn` calls `requireDay(today, …)` first. |
| 19 | edge | AC "B unchanged when a hidden name changes" is false for merchants | false | reject | The property is B's independence from *which* payee is hidden (paired-world `hiddenNameScenario`), which holds; hiding itself moving a row to the null bucket is the designed behaviour. |
| 20 | blind | Plan record unfinished | false | reject | Fix edits this build's plan. |
| 21 | intent-alignment | Breakdowns reach the API, not the page | false | reject | Descriptive; the frozen Never list puts lists and tables in 4.4/4.5. |

## Design Notes

One breakdown, folded in `app`: P&L, spending and merchants are sums of the same rows, so one SQL aggregate and one memory mirror carry the parity, and the use cases cannot disagree. Folding integer cents in `app` is server-side summing, which the "web never sums" rule allows.

## Verification

**Commands:**
- `pnpm lint` -- expected: biome and boundaries clean
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass, including parity, privacy and seed hand sums
- `pnpm e2e` and `pnpm test:axe` (local seeded server as in 4.1) -- expected: green
