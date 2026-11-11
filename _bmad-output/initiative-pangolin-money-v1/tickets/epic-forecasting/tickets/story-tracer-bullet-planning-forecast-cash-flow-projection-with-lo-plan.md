---
title: 'Tracer bullet: /planning/forecast cash flow projection with low-balance warning'
type: 'feature'
ticket: '1'
created: '2026-11-11'
status: 'built'
baseline_revision: '7e5325ece30c6cf3e32bd6c9f8050789f3e0ff4d'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing shows money trouble before it arrives. Pay cycles, confirmed bills, and budgeted spend exist in the app; no read-only projection combines them into a per-account cash-flow forecast with a low-balance warning.

**Approach:** Pure domain balance-walk over forecast movements; an app use case materializes movements per AD-25 (PayCalendar pay deposits + confirmed outgoing series + budget limits pro-rated daily within each pay cycle, charged to the scope's pay deposit account); a GET API; `/planning/forecast` draws per-account projection lines and calls out the first dip below each account's low-balance threshold.

## Boundaries & Constraints

**Always:**
- Derived on read (AD-11); the only stored addition is the per-account threshold column (default 0).
- Domain pure: no I/O, no clock (AD-14); app injects Clock and PayCalendar.
- Only `status='confirmed'`, `direction='bill'` series roll forward; salary deposits are never series (AD-25).
- Visible accounts only: `ctx.uow.accounts.list(viewer)` filtered to `type='transaction'`.
- A dip is projected balance strictly below threshold; the warning names account, projected amount, and date.
- Budget limitCents spread at a daily rate across each pay-cycle period inside the horizon (epic Notes decision).

**Never:**
- Funding-account rules, series/budget category exclusions, goal allocations — entry 8.2.
- Net worth, assumption chips, threshold-editing UI, empty states — entries 4–9.
- Stored tables beyond the one account column; e2e/axe specs (entry 11); historical actuals on the chart.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Anchors + confirmed bills + budgets; one account dips | Daily series per visible transaction account; warning names account, cents, first dip date | No error expected |
| No dips / equal | Thresholds 0, or projected equals threshold | `warnings: []`; series still returned | No error expected |
| Missing pay anchor | No pay_anchor rows | Deposits empty; budget spend contributes nothing (no pay cycle to spread across); confirmed bills still project | No error; result flags no deposit source |
| Shared budget, no household anchor | personId NULL budget; householdPayAnchorPersonId unset | That budget contributes nothing | Skip silently |
| Monthly series day 29–31 | nextDueOn 2026-01-31 | Occurrences clamp to shorter months' last day | No error expected |
| Horizon | `horizon=3|6|12` from clock today; default 3 | through = today + horizon | Unknown horizon → default 3 |

</frozen-after-approval>

## Code Map

- `packages/shared/src/period/index.ts` — `PayCalendar.periodsBetween(from,to)` → `PayPeriod.expectedPayDate`; amounts come from `pay_anchor.expectedNetCents`. Reuse as-is.
- `packages/app/src/planning/pay-calendar.ts` — `resolvePayCalendar(ctx, anchor)`; `pay-anchor.ts` — `listPayAnchors`.
- `packages/db/src/schema/recurring-series.ts` — `nextDueOn`, `cadence`, `direction`, `status`; nothing enumerates future occurrences — roll in new code.
- `packages/db/src/schema/budget.ts` — `limitCents`, `cadence`, `personId` (NULL=shared); no funding-account column. `budgets.ts:130` `resolveBudgetPayCalendar` for period bounds.
- `packages/app/src/accounts/balance.ts:96` — `balanceAsOf(ctx,{accountId,date})`; `reports/net-worth.ts:89` — `accounts.list(viewer)` pattern.
- `packages/db/src/schema/account.ts` + `migrations/` — add `lowBalanceThresholdCents` INTEGER NOT NULL DEFAULT 0 CHECK >= 0; slot `0029_*`; `pnpm --filter @pangolin/db db:generate`, commit output (ci.yml:39 asserts no drift).
- `apps/server/src/http/app.ts:1013` — GET pattern, `ctx(c)` = viewer+clock+uow; parse input inside the use case (routes don't zod).
- `packages/domain/src/planning/budget-math.ts(.test)` — pure-function + vitest style to copy.
- `apps/web`: route file like `routes/goals.tsx`, register in `router.tsx` addChildren, validator in `routes/search.ts`; button-group precedent `pages/BudgetsPage.tsx:158-180`; echarts pattern `components/NetWorthTrendChart.tsx` (dashed `lineStyle.type` is new); `AppSidebar.tsx:~255` replace disabled Forecast `<span>` with a `Link`.
- `tools/seed`: `WorldAccount` (world.ts:38) gets optional `lowBalanceThresholdCents`; expectations precedent `modules/budgets-and-bills.ts`; server-test pattern `apps/server/src/http/goals-seed.test.ts` (`fixedClockAt(seed.today)` + `linkSeed` + assert expectations).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db/src/schema/account.ts` + generated `migrations/0029_account_low_balance_threshold.sql` -- add threshold column
- [ ] `packages/domain/src/planning/forecast-cashflow.ts(.test)` -- pure movements + opening balances → daily series + first-dip warnings; hand-computed tests incl. equal-threshold
- [ ] `packages/app/src/planning/forecast.ts(.test)` -- materialize movements (anchor deposits, confirmed bill series rolled by cadence with month-end clamp, pro-rated budgets to the scope's deposit account); map visible transaction accounts; parse horizon
- [ ] `apps/server/src/http/app.ts` -- GET `/api/planning/forecast?horizon=`
- [ ] `tools/seed` -- threshold field on WorldAccount + account insert; set thresholds so the seeded world dips before payday; export forecast warning expectations
- [ ] `apps/server/src/http/forecast-seed.test.ts` -- fixed-clock seed test: warning matches expectations
- [ ] `apps/web/src/api.ts`, `routes/forecast.tsx`, `routes/search.ts`, `router.tsx` -- typed fetchForecast; validateSearch {horizon 3|6|12, default 3}
- [ ] `apps/web/src/pages/ForecastPage.tsx(.test)` + `components/ForecastCashFlowChart.tsx(.test)` -- horizon button-group; echarts dashed projection per account; threshold line + dip dot for dipping accounts; callout "«Account» could dip to $X on D"
- [ ] `apps/web/src/components/AppSidebar.tsx` -- enable Forecast link

**Acceptance Criteria:**
- Given the seeded world linked at a fixed clock, when the forecast runs at horizon 3, then a warning names the seeded account, expected cents, and expected date (Done-when 1).
- Given a signed-in viewer, when GET /api/planning/forecast, then only visible transaction accounts appear, each with a dated balance series.
- Given a dipping account, when the chart renders, then its threshold line and dip dot are drawn and the callout names account, amount, and date.
- Given a horizon button click, then the URL search param and chart update.
- Given another person's private account, when any viewer forecasts, then it is absent.

## Implementation Notes

## Plan Change Log

### Loop 1 — 2026-11-11 (intent_gap × 2, human-resolved)

- Triggered by triage #1 (day-0 double-count) and #17 (frozen "Missing pay anchor" row overstated budget projection).
- Amended: the frozen I/O row reworded to state that budget spend contributes nothing without a pay anchor — authorized by the human, the row's owner; day-0 overlap documented in Design Notes — the human accepted the behavior for the tracer.
- Known-bad state avoided: the matrix no longer promises a budget projection the model cannot produce; the day-0 overlap is now an owned, documented limitation (deferred-work carries it to entry 8.2).
- KEEP: the whole of `4cf8ca2` — both resolutions confirmed the existing code as intended behavior, so the loopback resolved in-plan without re-deriving. Remaining step-04 work: the 7 patch findings and the 3 defer entries.

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment; diff vs `7e5325e`):

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | BH — day-0 double-count: walk starts at `balanceAsOf(today)` (includes today's recorded transactions) and adds projected movements dated today, so a same-day recorded pay/bill counts twice | medium | intent_gap (human) — resolved 2026-11-11: accepted for the tracer, documented in Design Notes, reconciliation owned by entry 8.2 | Verified `balanceAsOf` = snapshot + later transactions (balance.ts:96); walk adds day-0 projections; transient, self-corrects next day; semantics not settled anywhere in intent |
| 2 | BH — shared budget charged to household anchor's account while viewer projects only own deposits | low | defer → entry 8.2 | Real config; behavior matches AD-25 default rule; frozen "Never" explicitly assigns funding-account rules to 8.2 |
| 3 | BH — `missingDepositSource` never read by the page | low | reject | Computed and API-exposed per matrix; surfacing belongs to entry 8.9's not-enough-data state; adding UI now duplicates it |
| 4 | BH+VG — unused `fakeAttachmentStoreShim` in forecast-seed.test.ts | low | patch | Verified defined at :114, never called; direct deletion |
| 5 | BH — no product path sets a non-zero threshold (create + seed only) | low | reject | Excluded by intent decomposition: epic entry 8 owns threshold editing; 8.8 owns the editor |
| 6 | BH — merchant-domain plan `ticket: 9` vs `signature: '5.9::…'` | low | defer | Pre-existing board bookkeeping, not this change; not produced by this build |
| 7 | BH — seed mirror duplicates domain walk | false | — | Deliberate, documented ("mirror, not a re-import"); importing production code would make the seed expectation tautological; verification-gap concurs |
| 8a | BH/ECH — chart axis from `accounts[0]` and dip-dot `?? 0` fallback | false | — | All accounts share the identical from..through window by construction; warnings ⊆ projected accounts, so the fallback is unreachable via the API |
| 8b | BH/ECH — stale chart canvas when accounts go non-empty→empty | low | reject | Requires removing/closing the last transaction account while the page sits open; same guard pattern as the existing NetWorthTrendChart |
| 9 | BH — `buildEndpointUrl` suffix-stripping risk; llm change "rides" the changeset | false | — | Not this change: commit `4cf8ca2` contains zero llm files; the llm edit is the user's uncommitted work-in-progress, included only by the diff-staging procedure |
| 10 | BH — ~25 fixture edits; suggests an AccountRow factory | false | — | Suggestion, no defect; churn is mechanical and typed |
| 11a | BH — world.ts calls the threshold "signed cents" while CHECK ≥ 0 | low | patch | Verified contradiction; one-word doc fix |
| 11b | BH — `z.int().min(0)` vs `.nonnegative()` idiom split | false | — | Both enforce the same rule; no named harm |
| 12 | BH — frontmatter quoting inconsistency in status-flip churn | false | — | YAML parses both identically; mostly pre-existing board files |
| 13 | BH — plan's empty review artifacts / unchecked boxes | false | — | Fix would be editing this build's plan; artifacts are populated by this very workflow step |
| 14 | BH — seed test types expectations as `Record<string, any>` | low | reject | Key rename fails loudly at runtime already; typing scaffolding exceeds direct correction |
| 15 | ECH — closed accounts projected with rolled-forward bills and false dips | medium | patch | Verified: `accounts.list` does not exclude `closedOn`; goals.ts:69 excludes closed — sibling convention; reachable via normal use |
| 16 | ECH — `missingDepositSource` true while deposits land on a non-projected (private/non-transaction) anchor account | maybe-false | reject | Contrived configuration, reachability not demonstrated; impact low if true; per rules, maybe-false/low is rejected with this note |
| 17 | ECH — frozen matrix row "missing pay anchor" promises "bills + budget spend still project" but budgets contribute nothing without an anchor | medium | intent_gap (human) — resolved 2026-11-11: row amended to match code, authorized by the human | Verified forecast.ts:112-116: no scope anchor → budget projects nothing; the frozen row overstates; root cause inside `<frozen-after-approval>` |
| 18 | ECH — seed-test header comment claims "every warning equals the minimum of its account's series" (code reports first dip, not minimum) | low | patch | Verified comment lines 5-6 vs first-dip semantics; direct comment fix |
| 19 | VG — `fetchForecast` client↔server URL contract untested; horizon param can silently break | medium | patch | Pre-verified: page tests mock the module; api.test.ts pins this exact contract for fetchTransactions/fetchAccounts; no e2e covers the route |
| 20 | VG — mobile Planning sheet's Forecast entry stays a dead placeholder while desktop links it | medium | patch | Pre-verified: MobileNav.tsx:225-240 renders a disabled span; siblings navigate; e2e only asserts text visibility |
| 21 | VG — ForecastPage error branch never exercised, unlike every sibling page | low | patch | Pre-verified: no test rejects `fetchForecast`; CashFlowPage.test.tsx:450-457 is the house precedent |
| 22 | IA — threshold presupposed-but-created + R5 "0 means unset" semantics | low | fold → 5 / 11a | Creation-path deferral as #5; the misleading comment is #11a |
| 23 | IA — seed-mirror doesn't prove intent-conformance | — | fold → 7 | Same defect family as #7; design-level rules are pinned by hand-computed literals in app tests |
| 24 | IA — acceptance chain seed→page never closed in one test | false | — | Entry 11 owns the end-to-end journey (intent decomposition); #19's patch closes the client-boundary link |
| 25 | IA — horizon fork over-tested vs intent silence; strays share the changeset | false | — | Descriptive; horizon selectability came from the epic's UX decision; strays are #9's staging artifact |

## Design Notes

Walk: opening = `balanceAsOf(asOf)`; balance += that day's movements; first day balance < threshold (strict) → warning {accountId, cents, date}. Deposits land on `expectedPayDate` (business-day rollback already in PayCalendar, AD-14). Bill occurrence i = `nextDueOn` + cadence steps (monthly clamps day 29–31 to month end). Budget period daily rate = `Math.round(limitCents / periodDays)`; remainder on the period's last day.

Day-0 semantics (human decision 2026-11-11): `balanceAsOf(today)` includes transactions already recorded today, and projected movements dated today are added on top — a same-day recorded pay or bill double-counts in that single first point and self-corrects from the next day. Accepted for the tracer; reconciling recorded vs projected same-day activity belongs to entry 8.2.

## Verification

**Commands:**
- `pnpm --filter @pangolin/db db:generate && git diff --exit-code -- packages/db/migrations` -- expected: clean after committing generated 0029
- `pnpm vitest run packages/domain/src/planning/forecast-cashflow.test.ts packages/app/src/planning/forecast.test.ts apps/server/src/http/forecast-seed.test.ts` -- expected: green
- `pnpm vitest run apps/web/src/pages/ForecastPage.test.tsx apps/web/src/components/ForecastCashFlowChart.test.tsx` -- expected: green
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean
