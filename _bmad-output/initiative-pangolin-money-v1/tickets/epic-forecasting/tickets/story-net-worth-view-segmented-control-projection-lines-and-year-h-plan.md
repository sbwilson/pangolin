---
title: 'Net-worth view: segmented control, projection lines, and year horizons'
type: 'feature'
ticket: '6'
created: '2026-11-13'
status: 'built'
baseline_revision: '7f2091e2fb45cad7fc9de156a6323a5979419474'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Entry 8.5 shipped the net-worth projection query and `GET /api/planning/forecast-net-worth`, but `/planning/forecast` only draws cash flow — no way to see where net worth could be on low/mid/high return lines, no "In N years" headline, no year horizons or table view (Flow 7's long-term climax).

**Approach:** A Cash flow · Net worth segmented control held in the URL. Net worth mode fetches `?horizon=years`, draws three monthly lines with a hover tooltip, the mockup headline block built from the lines, a 1/2/5/10-year button group, and a chart/table toggle like the Net worth page's trend card. Pure web change on the built API.

**Decisions (human, 2026-11-14):**
- "View as table" is under **both** charts, per UX Component Pattern and the mockup: the cash flow card gains the same toggle and a table of its own (every projected day as a row, one column per visible account — no sampling).

## Boundaries & Constraints

**Always:**
- `mode` ("cashflow"|"networth", default cashflow) and `years` ("1"|"2"|"5"|"10", default 2) as URL search params — the segmented control's choice lives in the URL (UX Component Pattern); allowlist validator, junk falls back to defaults.
- "View as table" under **each** chart in both modes; the table lists every point the server returned — no sampling, no web-side math.
- Lines: low/mid/high in muted-foreground / primary / muted-foreground, mid thicker (DESIGN § Forecast chart); point 0 = today on all three; tooltip shows date and value per line; each line carries its name (same-colour low/high must stay distinguishable).
- Headline figure = mid line's last point, rounded whole dollars; sub-line names low and high final points; every number comes from fetched points — the web never does the math.
- Net worth card carries the mockup subtitle "Starting from today's $X. Estimates, not advice." using the shared point-0 value.
- Pure option-builder + canvas-guarded chart component (ForecastCashFlowChart pattern) so jsdom tests exercise the option.

**Never:**
- No assumption chips (8.7), threshold editing (8.8), not-enough-data/all-clear states (8.9).
- No server, domain, app, or API changes — 8.5 shipped them; no new endpoints.
- Cash flow mode keeps its behaviour, layout, and tests.
- No e2e/axe specs (8.11); no Monte Carlo (spec non-goal).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------| ----------------|
| Default arrival | `/planning/forecast` | Cash flow mode exactly as built: months buttons, chart, warnings | — |
| Switch to Net worth | click "Net worth" | URL gains `mode=networth`; fetch `horizon=2`; three lines + headline + year group (2 yrs pressed) | fetch failure → `role="alert"` copy, no chart/headline |
| Deep link | `?mode=networth&years=10` | Net worth mode, 10 yrs pressed, 121-point report drawn and tabled | — |
| Junk params | `?mode=networth&years=3` | Net worth mode with years default 2 | validator drops junk silently |
| Horizon click | click "10 yrs" | URL gains `years=10`; refetch; headline "In 10 years" | — |
| Headline | report lines | "In 2 years" / "about $X" / "mid estimate · low $A · high $B", whole dollars | — |
| Table view — Net worth | click "View as table" | Month-ordered table, Low/Mid/High cents columns; label flips to "View as chart" | — |
| Table view — Cash flow | click "View as table" | Day-ordered table, one column per visible account, every projected day; label flips | — |
| Back to Cash flow | click "Cash flow" | Existing card as before; own months horizon preserved | — |

</frozen-after-approval>

## Code Map

- `apps/web/src/routes/search.ts:171-179` — `ForecastSearch`/`validateForecastSearch`: add `mode` and `years` string allowlists beside `horizon`.
- `apps/web/src/api.ts:1748-1785` — add `ForecastNetWorthReport/Line/Point` types mirroring `packages/app/src/planning/forecast-networth.ts:50-76` (`asOf`, `horizonYears`, `lines.{low,mid,high}` each `{returnBps, annualReturnPercent, points[{month,date,netWorthCents}]}`) and `fetchForecastNetWorth(years)` in the plain-fetch + `apiError` style of `fetchForecast`; pin the URL contract in `apps/web/src/api.test.ts:310` style.
- `apps/web/src/pages/ForecastPage.tsx` — mode from search; segmented control reuses the horizon fieldset pattern (:49-69, `aria-pressed`); horizon group swaps months ↔ years by mode; per-mode `useQuery` keyed `["planning","forecast",mode,horizon]`; net-worth card (title, subtitle, headline block, chart/table toggle).
- `apps/web/src/components/ForecastNetWorthChart.tsx(.test)` — **new**: pure `buildNetWorthChartOption(report)` + canvas-guarded component; copy `ForecastCashFlowChart.tsx` structure; axis patterns from `NetWorthTrendChart.tsx:62-105` (k/M y formatter), tooltip formatter style `:70-78`.
- `apps/web/src/components/ForecastNetWorthTable.tsx(.test)` — **new**: copy `NetWorthTrendTable.tsx:28-71` (scroll region, thead caps, `tabular-nums`); rows = all monthly points.
- `apps/web/src/components/ForecastCashFlowTable.tsx(.test)` — **new**: same scroll-region styling; rows = projected days (point 0 labelled "Today"), one column per visible account from `ForecastAccountData.points`.
- `apps/web/src/pages/NetWorthPage.tsx:186-200` — "View as table" toggle precedent; `:339-344` — enable the disabled "Where will we be in 2 years? →" span as a `Link` to `/planning/forecast` with `mode=networth` (closes Flow 9).
- `apps/web/src/lib/money.ts` — `formatCents`; add a whole-dollar display helper (en-AU currency, `maximumFractionDigits: 0`) for headline/tooltip figures.
- `apps/web/src/pages/ForecastPage.test.tsx:18-21,65-88` — `vi.mock("../api.ts")` + `renderPage(url)` memory-router patterns; extend.
- Do not touch: `apps/server/src/http/app.ts:645-651`, `packages/app|domain` forecast-networth modules, `ForecastCashFlowChart.tsx`.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/routes/search.ts` — `mode`/`years` params + validator, keeping junk fallback per matrix.
- [ ] `apps/web/src/api.ts` + `apps/web/src/api.test.ts` — net-worth types, `fetchForecastNetWorth`, request-URL contract test.
- [ ] `apps/web/src/lib/money.ts(.test)` — whole-dollar formatter helper.
- [ ] `ForecastNetWorthChart.tsx(.test)` — option builder: three lines (colours/widths per DESIGN), tooltip date+value, end labels naming lines, "Today" at point 0, every matrix row the option can prove.
- [ ] `ForecastNetWorthTable.tsx(.test)` — monthly table with region semantics; point 0 labelled "Today".
- [ ] `ForecastCashFlowTable.tsx(.test)` — daily table, one column per account, region semantics.
- [ ] `ForecastPage.tsx(.test)` — segmented control, mode-swapped horizon group, per-mode fetch, headline block + subtitle, per-mode chart/table toggle (cash flow card gains its own toggle above the chart), error branch, deep-link and junk-param tests; all existing cash-flow tests stay green.
- [ ] `NetWorthPage.tsx(.test)` — forecast link card navigates with `mode=networth`.

**Acceptance Criteria:**
- Given default arrival, when the page loads, then cash flow mode renders exactly as before, plus a working "View as table" toggle under its chart (regression).
- Given click Net worth, then the URL carries `mode=networth`, the server is asked with `horizon=2`, three lines draw with mid bold/primary, and the headline shows the mid final point in whole dollars with the "mid estimate · low $A · high $B" sub-line.
- Given `?mode=networth&years=10`, then net worth mode arrives with 10 yrs pressed and 121 points drawn; given junk `years`, then 2 applies without error.
- Given View as table clicked in either mode, then every projected point shows with formatted values (net worth: monthly Low/Mid/High; cash flow: per-account daily balances) and the toggle label flips.
- Given the net-worth fetch fails, then a `role="alert"` message shows and no chart or headline renders.
- Given a signed-in viewer on Net worth, then the forecast link card lands on Forecast net worth mode.
- CI: `pnpm lint`, `pnpm typecheck`, unit tests green.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (quick; Quick lens; diff vs `7f2091e`): verdicts — 2 medium, 1 low. No intent_gap or bad_plan → no loopback; all three routed patch.

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Q — net-worth lines pass raw `var(--primary/--muted-foreground)` strings; canvas renderer never resolves CSS variables, so the DESIGN colour rule fails in a real browser | medium | patch | Verified: zrender 6.1.0 assigns the style string straight to `ctx.strokeStyle` (canvas/graphic.js `isValidStrokeFillStyle(...) && (ctx.strokeStyle = style.stroke)`); its only `getComputedStyle` uses are layout/tooltip positioning. House patterns are hex literals (ForecastCashFlowChart `ACCOUNT_COLORS`) or sankey's `getComputedStyle`-with-fallback resolver. Test green only because it asserts the option string `toContain("--primary")`. Axis `var(--border)` is the pre-existing house precedent the plan said to copy — not introduced here, left as-is |
| 2 | Q — `e2e/net-worth.spec.ts:61` still asserts `aria-disabled="true"` on the forecast link, now a live `Link` → Playwright CI fails | medium | patch | Verified the assertion at :61 vs `NetWorthPage.tsx:340-346`; the plan's own unit-test flip proves the intended state; the stale e2e is unswept collateral of this change |
| 3 | Q — tooltip formats cents while the plan's Code Map directs the whole-dollar helper for tooltip figures; inconsistent with headline/end labels | low | patch | Verified formatter uses `formatCents`; frozen rule only demands date+value, so cosmetic — direct swap + test expectation |

## Design Notes

Mockup copy adopted verbatim (`key-forecast.html`; the headline is a documented UX assumption — the ticket's `unknown`): card title "Where will we be in {N} years?" (plural-aware), subtitle "Starting from today's $X. Estimates, not advice.", headline block "In {N} years" / "about $X" / "mid estimate · low $A · high $B".

Figures: X = `lines.mid.points` last point rounded to whole dollars; A/B likewise from low/high; $ in the subtitle = `lines.low.points[0].netWorthCents` (point 0 is today on all lines). Chart: category axis over monthly points, x labels "Today" + every 6th month ("Apr 2027"), mid `lineStyle.width 2.5` primary, low/high `1.5` muted-foreground, end labels "Low/Mid/High $X" so same-colour lines stay identifiable. Net-worth table lists all points (≤121); cash-flow table lists all days (up to 366) with one column per visible account — both inside the NetWorthTrendTable scroll region. Toggle is local state per the NetWorthPage trend-card precedent; it does not go in the URL.

## Verification

**Commands:**
- `pnpm vitest run apps/web/src/pages/ForecastPage.test.tsx apps/web/src/components/ForecastNetWorthChart.test.tsx apps/web/src/components/ForecastNetWorthTable.test.tsx apps/web/src/components/ForecastCashFlowTable.test.tsx apps/web/src/api.test.ts` -- expected: green
- `pnpm vitest run apps/web` -- expected: no regressions
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean
