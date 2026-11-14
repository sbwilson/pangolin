---
title: 'Not-enough-data and all-clear forecast states'
type: 'feature'
ticket: '9'
created: '2026-11-14'
status: 'built'
baseline_revision: 'ad466b300bc1bea5f7cbd6ffb85373364f7365ca'
route: 'full'
route_source: 'auto'
risk: 'low'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Cash-flow mode projects blindly in a world that lacks inputs: with no pay amounts, confirmed bills, or budgets it draws flat lines and zero warnings — an accidental, unearned "nothing wrong" — and even a genuinely safe forecast offers no reassurance beyond an absent warning list.

**Approach:** Two new cash-flow states per mockup `key-forecast.html`: when any of the three forecast inputs is missing, a "Not enough to forecast yet" card replaces the chart and names each gap with a link to the page that fixes it; when a fully-fed forecast shows no warnings, an all-clear caption reads "No dips below your thresholds in the next N months."

## Boundaries & Constraints

**Always:**
- Gaps are derived client-side from sources the page already fetches: pay gap = `report.missingDepositSource`; bills gap = zero confirmed bill-direction series; budgets gap = zero budgets. The card renders only when the report and both count sources are ready and at least one gap exists; while a source loads or after it fails, render exactly as today — no card, no caption.
- The card replaces the warnings list, the chart card, and the context chips (mockup shows it alone): heading "Not enough to forecast yet", sub "Pangolin needs three things before it can project your balances.", one row per input — a missing row shows its gap value and an action link, a present row shows a calm ✓ with its count.
- Pay gap links to Settings ("Set it in Settings →"); budgets and bills gaps link to `/planning/budgets` (the only budget editor, and where candidate confirmation lives — decision 2026-11-14: the spec's "Needs review" predates that UI; `/review` has no confirmation action). Bills row copy: "Confirm bills →" and "None yet · N waiting to confirm".
- The all-clear caption renders only when all three inputs are known present (no card), `report.accounts.length > 0`, and `report.warnings.length === 0`: `No dips below your thresholds in the next ${horizon} months.` with `role="status"` and `data-testid="forecast-all-clear"`. It follows the horizon control (3/6/12).
- Warnings, chart, table toggle, and chips stay exactly as today whenever neither new state applies.

**Never:**
- No server, domain, API, schema, or migration change — the report already exposes `missingDepositSource`, and every count the card needs is already fetched client-side.
- No change to `ForecastContextChips` behavior — its zero-count copy stays as-is.
- No all-clear state in net-worth mode; no e2e/axe (entry 11); no Monte Carlo.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------| ----------------|
| All inputs missing | `missingDepositSource` true, 0 confirmed bills, 0 budgets | Card names all three gaps with links; no chart, no chips, no caption | — |
| Waiting candidates | 0 confirmed bills, 3 candidate bill series | Bills row "None yet · 3 waiting to confirm" and the Budgets-page link | — |
| Partial gap | Pay set, no budgets | Card shows only the budgets gap; pay row shows ✓; chart still replaced | — |
| Source failed | budgets query rejects | No card, no caption; today's chart + chip omission unchanged | Degrade honestly |
| Safe world | Inputs present, 0 warnings, ≥1 account | Caption "No dips below your thresholds in the next 3 months."; no warnings UI | — |
| Safe world at 6 mo | same, horizon=6 | Caption says "next 6 months" | — |
| Dips ahead | Inputs present, ≥1 warning | Today's warning list; no caption, no card | — |
| No accounts | Inputs present, 0 warnings, `accounts: []` | No caption (nothing was projected) | — |

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/ForecastPage.tsx` — cash-flow branch (:213–276): compute the three gaps + waiting count, add a candidates query (`fetchRecurringSeries({ status: "candidate" })`, filter `direction === "bill"`, enabled in cash-flow mode), and drive the three-state render (gaps card ▸ warnings ▸ caption). `paySource`/`billsSource`/`budgetsSource` (:127–145) already gate readiness.
- `apps/web/src/components/ForecastNotEnoughCard.tsx` — new dumb component following the `ForecastContextChips.tsx` assembly convention (page computes, component renders): props `pay: boolean`, `bills: { missing: boolean; waiting: number }`, `budgets: { missing: boolean; count: number }`; renders mockup rows with `Link`s and testids `forecast-not-enough-card`, `forecast-gap-pay|bills|budgets`.
- `apps/web/src/api.ts` — read-only facts: `fetchRecurringSeries` accepts `status: "candidate"` (:1359); `ForecastData.missingDepositSource` exists (:1779). No changes here.
- `apps/web/src/pages/ForecastPage.test.tsx` — extend; harness mocks every fetcher already (:26–49); the `report()` fixture sets `missingDepositSource`. Keep existing chip tests green, incl. "omits the chip whose source failed".
- Do not touch: `ForecastContextChips.tsx`, `ForecastCashFlowChart.tsx`, `ForecastCashFlowTable.tsx`, anything under `packages/`, routes, server.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/ForecastNotEnoughCard.tsx` — mockup card: heading, sub, three rows (missing: value + link; present: ✓ + count), testids.
- [x] `apps/web/src/pages/ForecastPage.tsx` — gap computation, candidates query, three-state cash-flow render per the matrix.
- [x] `apps/web/src/pages/ForecastPage.test.tsx` — every matrix row (jsdom, mocked api).

**Acceptance Criteria:**
- Given a world missing forecast inputs, when cash-flow mode renders, then the card names each gap with its link and no chart or chips render (ticket verify, half 1).
- Given a safe world (all inputs, no dips), then the caption "No dips below your thresholds in the next 3 months." shows (ticket verify, half 2).
- Given any context source still loading or failed, then neither new state renders.
- CI: `pnpm lint`, `pnpm typecheck`, `pnpm check:strict`, unit tests green.

## Design Notes

- Copy verbatim from the mockup where it shows it. Bills row value: "None yet" plus " · N waiting to confirm" when candidates exist (decision 2026-11-14 — "in Needs review" dropped, confirmation lives on the Budgets page). Present rows: pay ✓ "Set", bills ✓ "N confirmed", budgets ✓ "N set" — same counts the chips compute.
- Link style: `BudgetCard.tsx:291` idiom (`font-semibold underline text-primary`), copy ends "→".
- Why `missingDepositSource` for the pay gap: the chip's "Pay cycle — not set" is identity-based, but the forecast's real blindness is having no expected deposit amounts; the card must claim a gap when the projection can't see income, and Settings → household is where expected net is edited either way.
- Caption placement: where the warnings `<ul>` renders today (:222), calm `text-sm text-muted-foreground` variant, so warnings and all-clear occupy the same slot above the chart.

## Plan Change Log

## Review Triage Log

Pass 1 (quick; Quick lens; diff vs `ad466b3`): verdicts — 0 high, 0 medium, 0 low kept, 2 false, 1 low rejected. No intent_gap or bad_plan → no loopback; nothing to patch.

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Q — all-clear asserts safety when no account has a threshold set | false | — | Verified at `ForecastPage.tsx:157–178`: warnings are computed server-side against each account's *stored* threshold, which defaults to 0 (epic decision: "none set" = 0), so "no dips below your thresholds" is a true claim about the zero lines in the cited world; the frozen matrix's Safe-world row carries no threshold condition — the misleading outcome does not occur |
| 2 | Q — AC3 "any context source" not met: `me`/`payAnchors`/candidate failures still allow the new states | false | — | `notEnough` and `allClear` both require `report !== undefined && billsCount !== null && budgetsCount !== null` (`ForecastPage.tsx:163–177`) — exactly the frozen bullet's gate ("the report and both count sources"); `me`/`payAnchors` feed only chip identity copy and the candidate query is an annotation by that same gate, so no new state renders while a gating source is unsettled — the residual is a wording fix to the plan itself, rejected per rules |
| 3 | Q — bills gap text mutates from "None yet" to "· N waiting" without live semantics; count vanishes if the candidate query fails | low | reject | Refuted as misleading (both renders are literally true about *confirmed* bills and the Budgets link stays actionable; the non-live update matches the chips row's established pattern); everyday-likelihood is the rare candidate-query failure, and any fix — gating the card on a fourth source or adding a live region — adds complexity beyond a direct correction, so rejected under the low-rejection rule |
