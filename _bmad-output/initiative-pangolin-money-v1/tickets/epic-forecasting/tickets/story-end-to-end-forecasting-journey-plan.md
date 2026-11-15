---
title: 'End-to-end forecasting journey'
type: 'feature'
ticket: '11'
created: '2026-11-15'
status: 'built'
baseline_revision: 'd7a8fcd623e6d48ae7cbc5057e80c768cfdb03df'
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

**Problem:** Epic 8 shipped the seeded cash-flow warning, editable assumption chips, and per-account low-balance thresholds, but no Playwright test has ever opened `/planning/forecast` — the epic's gate "e2e and axe pass on CI for the forecast routes" (ticket 8.11) does not exist.

**Approach:** Journey spec as Alex on the seeded world: assert both seeded low-balance warnings; edit → reset → restore the savings-rate chip in Net-worth mode watching the headline redraw; zero then restore Joint everyday's low-balance line in the accounts sheet watching that warning go and come back. Add axe audits for `/planning/forecast` both modes (× light/dark, chart + table views) and both 320 px reflow entries.

## Boundaries & Constraints

**Always:**
- Tests only: zero changes under `apps/`, `packages/`, `tools/seed`, `e2e/helpers/`.
- Register `forecast.spec.ts` in the `reports` Playwright project (after ledger.spec's seed, before import mutates).
- Leave the world seeded: savings rate back to 45% and threshold back to $60,000 before the spec ends — accounts/axe specs read seeded state later. Chip "reset" restores the all-zero default (0%), so restoring 45% means editing 45 again.
- Warning rows assert stable day-0 amounts with an open date: `Joint everyday could dip to \$58,909\.75 on \d{1,2} \w{3}` and `Person A private could dip to -\$14,292\.50 on \d{1,2} \w{3}`. Rationale (verified against the seed mirror): day 0 = today's snapshot balances on any server date; the 3-month joint minimum is ≥ $39,909.53 > $0, so threshold $0 ⇒ no Joint warning; Person A private (negative, threshold 0) keeps exactly one warning for Alex.
- Conventions: `test`/`expect` from `helpers/csp.ts`; `alexSession(browser)`; direct `page.goto` per page like cash-flow.spec; testids + aria names only.
- Axe: per light/dark, zero-violation audits of `/planning/forecast` (wait `forecast-warning` + `forecast-chart`, then "View as table" → `forecast-cashflow-table`, re-audit) and `/planning/forecast?mode=networth` (wait `forecast-networth-headline` + `assumption-chips`, table view, re-audit); add both URLs to the 320 px reflow table (testids `forecast-warning` / `assumption-chips`).

**Never:**
- No new unit tests (logic already pinned in ForecastPage/AssumptionChips tests); no app/API/seed/migration changes.
- No Sam/partner leg; no `page.clock`; no hardcoded warning dates; no axe rule exclusions.
- Do not assert the all-clear caption (Alex always keeps the private warning).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Seeded warnings | Alex, `/planning/forecast` | exactly 2 `forecast-warning` rows (amounts above); `forecast-chart` visible | — |
| Mode switch | click "Net worth" | URL gains `mode=networth`; headline + chips visible; chip "Savings rate 45%" with `changed` dot | — |
| Edit savings | editor → `60` → Enter | chip "Savings rate 60%"; headline text differs from baseline | — |
| Reset | "Reset savings rate" | chip "Savings rate 0%"; dot gone; headline differs again | — |
| Restore | editor → `45` → Enter | chip "Savings rate 45%"; headline back to baseline text | — |
| Threshold zero | /accounts → "Edit Joint everyday" → Low-balance line `0` → "Save changes" | sheet closes; forecast shows exactly 1 warning (Person A private), no Joint row | — |
| Threshold restore | same sheet → `60000` | both warnings back | — |
| Axe | both URLs × light/dark × 320 px | violations `[]`; no horizontal overflow at 320 px | — |

</frozen-after-approval>

## Code Map

- `e2e/forecast.spec.ts` — **new**; structure per `e2e/cash-flow.spec.ts` (browser fixture, `alexSession`, CSP helpers).
- `e2e/playwright.config.ts` — add `"forecast.spec.ts"` to `reports` `testMatch` (:57–64); else the `chromium` project grabs it and fails pre-seed.
- `e2e/axe.spec.ts` — per-mode tests after the `/net-worth` test (:330–379: goto, wait, `setMode`, `auditPage`, toggle re-audit); reflow `routes` table :798–808.
- `apps/web/src/pages/ForecastPage.tsx` — read-only selector source: h1 "Forecast"; fieldset "Forecast mode" buttons "Cash flow"/"Net worth"; testids `forecast-warning`, `forecast-chart`, `forecast-cashflow-table`, `forecast-networth-headline`, `forecast-networth-table`; toggle "View as table"/"View as chart"; li text "<Name> could dip to <amount> on <D Mon>." spans-split (regex over li).
- `apps/web/src/components/AssumptionChips.tsx` — testid `assumption-chip-savings`; edit-button aria `Savings rate: 45%. Edit`; input aria-label exactly `Savings rate` (`{ exact: true }`); Enter commits, editor closes immediately, cache write-back updates chip text; reset aria "Reset savings rate"; dot `role="img"` "changed".
- `apps/web/src/pages/AccountsPage.tsx` — button aria `Edit Joint everyday` (:106–114).
- `apps/web/src/pages/AccountSheet.tsx` — heading "Edit account"; label "Low-balance line" wraps the input (:336–344); submit "Save changes" (:408); `0`/empty ⇒ threshold 0, sent on PUT.

## Tasks & Acceptance

**Execution:**
- [x] `e2e/forecast.spec.ts` — journey per the matrix, restoring 45% and $60,000 before finishing.
- [x] `e2e/playwright.config.ts` — register spec in `reports`.
- [x] `e2e/axe.spec.ts` — 2 routes × 2 modes audits + 2 reflow entries.

**Acceptance Criteria:**
- Given the seeded world, when the journey runs, then both warning rows show the stable amounts, the assumption edit/reset/restore moves and returns the headline, and the threshold zero/restore removes exactly the Joint warning and brings it back (ticket verify, half 1).
- Given the forecast URLs, when axe runs light/dark and 320 px, then every audit reports zero violations (ticket verify, half 2).
- Given the journey finished, later specs see the seeded world (threshold $60,000, savings 45%).
- `pnpm lint && pnpm typecheck` clean; `pnpm --filter @pangolin/e2e exec playwright test --list` lists forecast.spec.ts.

## Implementation Notes

## Plan Change Log

- 2026-11-15: the 320 px reflow loop's visibility check applies `.first()` only for the
  `forecast-warning` testid (which legitimately matches several seeded rows and would break the
  strict `toBeVisible`); the other routes keep the strict one-match check.

## Review Triage Log

Pass 1 (quick; Quick lens; diff vs `d7a8fcd`): verdicts — 0 high, 0 medium, 2 low kept → patch.

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Q — forecast.spec.ts's own context is never CSP-watched; fixture guard vacuous | low | patch | Verified `csp.ts:30–39` watches only the built-in `context` the test never navigates; header rule `csp.ts:3–4` requires `watchCsp` for extra contexts (new axe tests in this diff comply); harm: a CSP violation on the journey's accounts-sheet/chip-editor flows fails nothing — no other audit opens those |
| 2 | Q — shared 320 px reflow loop's `.first()` relaxes duplicate-testid strictness for the 5 pre-existing routes | low | patch | Verified axe.spec.ts loop body applies `.first()` to every route entry, not just forecast; a future duplicate-testid regression on cash-flow/spending/net-worth/budgets/goals would pass the visibility gate this check previously enforced |

Pass 2 (quick; Quick lens; diff vs `d7a8fcd` on the patched tree): verdicts — 0 high, 0 medium, 1 low kept → patch, 1 false. Both pass-1 patches confirmed in place by the lens.

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Q — mid-test failure leaks savings-rate/threshold mutations into later specs, "producing cascading secondary failures" | false | — | Verified by grep across `e2e/`: no later spec asserts either value — the other `Savings rate` matches (`axe.spec.ts:263`, `routing.spec.ts:73`, `spending-insight.spec.ts:23`) are the /net-worth and /cash-flow P&L KPI label, a different metric; the later axe forecast audits hold on the leaked world because the Person A private warning (negative balance, threshold 0) is unconditional; a leak only follows a mid-run failure, which already reds the run, with `retries: 0` and a fresh data dir per run |
| 2 | Q — `forecast.spec.ts:6–8` header comment justifies the restores with a coupling that doesn't exist ("accounts.spec and axe.spec read seeded state") | low | patch | Verified by the same grep: no later spec reads the savings rate or the threshold; the restore stands on the plan's leave-the-world-seeded invariant, not on downstream reads — action: comment corrected to state the invariant without the false causal claim |

## Design Notes

Headline-redraw proof: capture `forecast-networth-headline` textContent once settled; `not.toHaveText` after each PUT; `toHaveText(baseline)` after restoring 45% (same inputs recompute the same numbers). The dot compares against all-zero defaults, so it shows at seed and again at restored 45%; only reset (0%) hides it.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean (`pnpm -r` covers `@pangolin/e2e`).
- `pnpm --filter @pangolin/e2e exec playwright test forecast.spec.ts axe.spec.ts --list` -- expected: specs compile and list.
- Full local run per `e2e/README.md` (:228–246): build, fresh `PANGOLIN_DATA_DIR` server with `PANGOLIN_ENABLE_SEED=true`, `pnpm e2e` -- expected: journey and axe green. CI `container` job is the final gate.
