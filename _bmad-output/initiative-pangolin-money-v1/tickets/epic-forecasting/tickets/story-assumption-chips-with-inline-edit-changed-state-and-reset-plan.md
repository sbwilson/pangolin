---
title: 'Assumption chips with inline edit, changed state, and reset'
type: 'feature'
ticket: '7'
created: '2026-11-14'
status: 'built'
baseline_revision: 'ac7805f6db614eff61b5ab26c03e7146e47ac516'
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

**Problem:** The net-worth projection runs on stored assumptions, but `/planning/forecast` shows no trace of them — nothing displays savings rate, returns, mortgage-with-offset, or super, and nothing edits them; cash-flow mode shows no hint of what drives its projection.

**Approach:** An "Assumptions" chips row under the forecast card in both modes. Net-worth mode: four editable chips wired to GET/PUT `/api/planning/forecast-assumptions` — savings rate, returns (low·mid·high), mortgage-with-offset, super — with click-to-edit inline, a changed dot vs the all-zero defaults, per-chip `reset`, row-end "Reset all". Cash-flow mode: four read-only context chips (pay, confirmed bills, budgets, low-balance lines). Pure web change on the built API.

**Decisions (human, 2026-11-14):**
- Percent editor commits on Enter or blur — blur commits only valid text; invalid text keeps the editor open in an invalid state. Escape cancels.
- Mortgage chip editor is a popover anchored on the chip, one row per visible `home_loan` with two checkboxes (paid down / offset counted), same shape for one or many loans.
- Context chips are client-assembled from the existing endpoints (`fetchMe`, `fetchPayAnchors`, `fetchRecurringSeries`, `fetchBudgets`, plus the cash-flow report's own thresholds) — no server change.

## Boundaries & Constraints

**Always:**
- Mockup copy: `Savings rate 45%` · `Returns: low 3% · mid 5% · high 7%` · mortgage prose `{loan name} loan paid down, offset counted` · `Super contributions 12%`; group label "Assumptions" before the row. Percent text trims trailing zeros (45%, 12.5%).
- Changed = stored ≠ `FORECAST_ASSUMPTION_DEFAULTS` (all-zero bps, `mortgages: []`). Dot inside the chip, `aria-label="changed"`; per-chip underlined `reset` only on changed chips; "Reset all" only when ≥1 changed.
- Reset = PUT sending that chip's defaults (scalar → 0; mortgage chip → `mortgages: []`). No reset endpoint exists.
- Every successful PUT updates the assumptions cache from the response and invalidates `["planning","forecast","networth"]` — lines redraw immediately.
- PUT `mortgages` replaces the list wholesale and omitted terms become null: re-send stored `annualRatePercent`/`monthlyRepaymentCents` for retained loans; new loans send `{accountId, countOffset}` only.
- Percent input 0–100, ≤2 decimals → integer bps (×100 rounded); invalid input never PUTs.
- Context chips read-only, from existing fetchers: pay via `fetchMe()` names + `fetchPayAnchors()` cadence/`expectedNetCents`; `fetchRecurringSeries({status:"confirmed"})` counting `direction:"bill"`; `fetchBudgets()` count; thresholds from the cash-flow report's own `accounts[].lowBalanceThresholdCents`.
- PUT failure (incl. demo 409) → `role="alert"`; chips show stored values, never an optimistic lie.

**Never:**
- No server, app, domain, or db changes — APIs built in 8.4–8.6; no new endpoints.
- No editing in cash-flow mode, no threshold editor (8.8), no not-enough-data/all-clear states (8.9), no e2e/axe (8.11), no Monte Carlo.
- No editing mortgage terms (rate/repayment) — selection + offset toggles only.
- Cash flow chart, table, and headline keep behaviour and tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------| ----------------|
| Pristine | GET returns zero defaults | No dots/reset/Reset all; chips show 0%, "No mortgage paid down" | — |
| Edit savings rate | type 45, commit | PUT `{savingsRateBps:4500}`; chip + dot + `reset`; networth refetch redraws | PUT fails → alert, chip shows stored |
| Returns chip | low/mid/high inputs | One PUT with all three bps | same |
| Chip reset | `reset` on savings chip | PUT `{savingsRateBps:0}` only; other chips untouched | same |
| Reset all | several changed | PUT all scalars 0 + `mortgages: []`; dots vanish | same |
| Mortgage toggle | per-loan paid-down/offset toggles | PUT full list, terms echoed for retained; prose updates; dot | invisible account → 404 → alert |
| Invalid input | `101`, `-1`, `abc` | Inline invalid state, no PUT | — |
| Cash-flow mode | arrive/click Cash flow | Four read-only chips, mockup copy; no edit affordance | source fetch fails → chip omits gracefully |
| Context zeros | no anchors / 0 bills / 0 budgets | Honest copy: "Pay cycle — not set", "No confirmed bills", "No budgets yet" | — |

</frozen-after-approval>

## Code Map

- `apps/web/src/api.ts` — add `ForecastAssumptions`/`ForecastAssumptionMortgage` types, `fetchForecastAssumptions()` (plain-fetch style of `fetchForecastNetWorth` :1819–1824), `upsertForecastAssumptions(patch)` PUT via `sendJson`; responses are the full assumptions object; mortgage items `{accountId, countOffset: boolean, annualRatePercent: string|null, monthlyRepaymentCents: number|null}`.
- `apps/web/src/api.test.ts` — GET/PUT contract tests, `fetchForecastNetWorth` :333–355 style (stubFetch, URL/body).
- `apps/web/src/pages/ForecastPage.tsx` — chips row after the card block per mode (cashflow ~:191, networth ~:245); existing queries :49–60; add assumptions `useQuery` `["planning","forecast","assumptions"]` (networth only) and context fetchers (cashflow only).
- `apps/web/src/components/AssumptionChips.tsx(.test)` — **new**: chips, inline editors, dot/reset/Reset all. Edit-swap pattern: `CategoryCell` `pages/TransactionsTable.tsx:66-135`; mutation pattern: `components/HouseholdSettings.tsx:63-77` (`setQueryData` + `invalidateQueries`).
- `apps/web/src/components/ForecastContextChips.tsx(.test)` — **new**: presentational read-only chips.
- `apps/web/src/lib/money.ts` — reuse `formatCents`/`formatWholeDollars`; bps↔percent helpers live in AssumptionChips.
- `apps/web/src/pages/ForecastPage.test.tsx` — `vi.mock("../api.ts")` + `renderPage` patterns; mock the new fetchers.
- `packages/app/src/planning/forecast-assumptions.ts` — read-only reference: defaults :36–43, PUT schema :87–104. Do not modify.
- Do not touch: `apps/server/src/http/app.ts`, `packages/app|db|domain`, the forecast/net-worth chart+table components, `routes/search.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/api.ts` + `api.test.ts` — assumptions types, GET/PUT fetchers, contract tests.
- [ ] `apps/web/src/components/AssumptionChips.tsx(.test)` — editable chips + editors + dot/reset/Reset all; PUT, cache, networth invalidation; every matrix row the component can prove (jsdom, QueryClient, stub fetch).
- [ ] `apps/web/src/components/ForecastContextChips.tsx(.test)` — read-only chips + zero copy.
- [ ] `apps/web/src/pages/ForecastPage.tsx(.test)` — mount chips per mode, assumptions query, failure alert; existing tests stay green.

**Acceptance Criteria:**
- Given stored assumptions, when net-worth mode loads, then chips show them and every value ≠ zero default carries a dot + `reset`.
- Given savings rate edited to 45%, then one PUT carries `savingsRateBps: 4500`, the chip updates with dot, and the networth query refetches (ticket verify).
- Given one chip reset vs Reset all, then exactly that chip's fields vs all fields PUT to defaults.
- Given the PUT fails, then `role="alert"` shows and no chip displays an unsaved value.
- Given cash-flow mode, then four context chips with mockup copy and no edit affordance; zeros get honest copy.
- CI: `pnpm lint`, `pnpm typecheck`, `pnpm check:strict`, unit tests green.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (quick; Quick lens; diff vs `ac7805f`): verdicts — 0 high, 1 medium, 4 low. No intent_gap or bad_plan → no loopback; all four entries route patch (F1+F2 share one root cause: the chips treat stored mortgage rows as always present in the visible-open home_loan list).

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Q — `loanName` fallback `"Home loan"` + prose's unconditional `" loan paid down"` render `Home loan loan paid down` for an unresolved account | low | patch | Verified: chip mounts as soon as `assumptions.data` exists while `["accounts"]` is still fetching (flash), and permanently for a stored closed-loan row — `listAccounts()` excludes closed, and 8.4 stores closed loans' rows on purpose |
| 2 | Q — `toggleMortgage` rebuilds the PUT list from visible-open `homeLoans` only, so any toggle silently drops stored selections for closed/hidden loans | medium | patch | Verified against `forecast-assumptions.ts:216-227` (`replaceMortgages` replaces wholesale; unlisted rows are deleted); popover renders no row for such loans, so they cannot be un-toggled either |
| 3 | Q — `ReturnsEditor` has no `autoFocus`; opened-but-unfocused, Enter/Escape/blur-commit (the pinned decision) do nothing until an input is clicked | low | patch | Verified: `PercentEditor` autofocuses, `ReturnsEditor` doesn't; the Escape/pointerdown listeners are gated on `mortgagesOpen`; the existing test types into fields directly and never exercises the unfocused-open state |
| 4 | Q — clicking a chip's `reset` or "Reset all" while a percent editor holds valid edited text fires two PUTs (blur-commit, then the reset); out-of-order responses can show a value the server no longer holds | low | patch | Verified mechanism: mousedown blurs → `PercentEditor.onBlur` commits + `setEditing(null)`; the reset button node survives the re-render, so click PUTs defaults too; both responses `setQueryData` in arrival order |
| 5 | Q — a failed `listAccounts` renders the popover's "No home loans yet" empty state as fact | low | patch | Verified: popover branches on `isPending` and `homeLoans.length === 0`, never `accounts.isError`; `retry: false` |

## Design Notes

Mortgage prose: single loan `{name} loan paid down, offset counted`; multi → ` · `-joined (omit ", offset counted" when false); none → "No mortgage paid down". None is the default, so any selection marks changed; reset PUTs `mortgages: []`.

Context chips: pay label uses the shared cadence word ("Fortnightly pay:") when all anchors agree, else "Pay:"; per person `name $amount` via `formatWholeDollars`. Thresholds chip lists accounts with threshold > 0, else "Low-balance lines — none set". Chip row is static markup (flex-wrap small pills); dot/reset styles follow mockup `.chdot`/`.rs`.

## Verification

**Commands:**
- `pnpm vitest run apps/web/src/components/AssumptionChips.test.tsx apps/web/src/components/ForecastContextChips.test.tsx apps/web/src/pages/ForecastPage.test.tsx apps/web/src/api.test.ts` -- expected: green
- `pnpm vitest run apps/web` -- expected: no regressions
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean
