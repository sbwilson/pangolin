---
title: 'Full cash flow model: funding accounts, series exclusions, and goal allocations'
type: 'feature'
ticket: '2'
created: '2026-11-11'
status: 'built'
baseline_revision: '755f83cc3d69bd5e22584dcb1856d11ddc0a22d3'
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

**Problem:** The tracer charges every budget's spend to the scope's pay deposit account, projects spend in categories a confirmed bill series already covers (double-counting, AD-25), ignores goal allocations, and double-counts movements recorded on day 0. Projections misstate which account dips and by how much.

**Approach:** Budgets gain an optional funding account (AD-25 default: the scope's pay deposit account) honored by the forecast; budget categories covered by a confirmed outgoing series drop out of projected discretionary spend; at each pay-period close in the horizon the deposit account is reduced by the active stage's shares of that period's projected positive savings; the walk opens at today's actual balance with projections from tomorrow, ending the day-0 double-count.

## Boundaries & Constraints

**Always:**
- `budget.fundingAccountId` NULL ⇒ scope deposit account — exactly the 8.1 behavior; set ⇒ pro-rated spend charges that account.
- A category is covered when a confirmed `direction='bill'` series' payee has that `defaultCategoryId`. A covered category budget projects no spend; a group budget only when every category in the group is covered; a payee without a default category covers nothing.
- Allocation debit: per pay-cycle period ending in the horizon, projected positive savings on the scope's deposit account (period deposits minus movements landing there, floored at 0) split by the active stage's `goalRule` shareBp via largest-remainder `shared.allocate` (AD-13), debited on the period close date; no active stage ⇒ no debit.
- Day 0 = `balanceAsOf(today)` exactly; projected movements start today+1.
- Funding account validated to exist at create/update; its movements apply only when it is among the projected visible transaction accounts.
- Movements materialize in the app; the pure domain walk (8.1) is unchanged.

**Never:**
- Net worth, assumption chips, threshold editing, empty states (entries 4–9); e2e/axe (entry 11).
- No edits to goal-balance math, stage transitions, or `executeSavingsAllocation` — goal tables are read-only here.
- No payee default-category editing or payee-history heuristics beyond an Open Answer.
- No stored forecast data beyond the one budget column.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Funding account set | budget fundingAccountId = acc-B | all pro-rated spend on acc-B, none on the deposit account | No error expected |
| Funding unset / invalid | NULL; PATCH to unknown id | NULL ⇒ scope deposit (8.1 behavior); unknown id rejected | validation error → 4xx |
| Covered category budget | series payee defaultCategoryId = budget categoryId | budget contributes no movements | No error expected |
| Group partially covered | group budget; 1 of N categories covered | group budget still projects fully (all-covered rule) | No error expected |
| Payee without default | defaultCategoryId null | covers nothing; budgets still project | No error expected |
| Active stage, positive savings | shares 60/40; period nets +10,000¢ | deposit debited at close by the largest-remainder split | No error expected |
| Zero/negative period | outflows ≥ deposits | no allocation debit that period | No error expected |
| Recorded on day 0 | pay recorded today, also projected | day-0 point = actual balance; projections from tomorrow | No error expected |

## Decisions (2026-11-11, checkpoint)

- Allocation formula: shares of projected positive period savings on the deposit account — not a reuse of the real allocation engine with goal balances and exit cascades.
- Series→category matching: `payee.defaultCategoryId` only; unset covers nothing; group budgets excluded only when all their categories are covered.
- Day-0 rule: day 0 is today's actual `balanceAsOf`; projected movements start tomorrow — no same-day netting.

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/budget.ts` — add nullable `fundingAccountId` text → account.id; migration slot `0030`; `db:generate`, commit output.
- `packages/app/src/planning/budgets.ts` — `createBudgetInput` (:32) / `updateBudgetInput` (:53) gain nullable `fundingAccountId`; `createBudget` (:167) / `updateBudget` (:226) validate existence; POST/PATCH `/api/planning/budgets` (app.ts:465, :499) already pass the body through.
- `packages/app/src/planning/forecast.ts` — all forecast changes: `forecastBudgetScope` (:107) resolves the scope deposit account; budget block :196–206 (target = funding ?? scope; skip covered); reads :142–155 add payees via `ctx.uow.payees` (`PayeeRepo`, rows carry `defaultCategoryId`); `addBudgetProration` (:248) takes a target-account param; new covered-category set and allocation-debit block.
- `packages/db/src/schema/goal.ts` — `allocationStage`, `goalRule` (shareBp, effectiveFrom/Until); active-stage selection precedent `resolveActiveStage` (goal-allocation.ts:118) — read-only reuse. `shared.allocate` (AD-13) for share splits.
- `tools/seed` — admin `budget.created` schema gets optional `fundingAccount`; `modules/budgets-and-bills.ts`: one budget gets a funding account, one confirmed series' payee default-category covers one budgeted category; extend the `budgets-and-bills.forecast` expectation mirror (:245–261) for exclusions, funding targets, allocation debits, tomorrow-start (goals module already seeds stage/rules).
- `apps/web`: `BudgetEditorSheet.tsx` fields (:36–45) gain a funding-account select (default option "Pay account (default)"); `BudgetsPage.tsx` already loads accounts (:46); thread through `api.ts` bodies.
- Mechanical `fundingAccountId: null` fixture additions: budgets.test.ts, forecast.test.ts, seed-references.test.ts, db budget.test.ts, BudgetsPage.test.tsx, admin seed.test.ts, http app.test.ts.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/budget.ts` + generated `migrations/0030_*.sql` -- funding column
- [x] `packages/app/src/planning/budgets.ts(.test)` -- inputs accept/validate fundingAccountId
- [x] `packages/app/src/planning/forecast.ts` -- funding target; covered-category exclusion; allocation debit; projections from tomorrow
- [x] `packages/app/src/planning/forecast.test.ts` -- one case per I/O row
- [x] `apps/server/src/admin/seed.ts` + `tools/seed/src/modules/budgets-and-bills.ts` -- event schema, scenario, extended expectation mirror
- [x] `apps/server/src/http/forecast-seed.test.ts` -- green on new expectations
- [x] `apps/web/src/api.ts` + `BudgetEditorSheet.tsx` + `BudgetsPage.tsx(.test)` -- funding select round-trip
- [x] fixture files above -- mechanical column additions

**Acceptance Criteria:**
- Given the seeded world at the fixed clock, when the 3-month forecast runs, then the covered-category budget projects no spend, the funding-account budget's spend lands on its funding account, the deposit account shows allocation debits at period closes, and no day-0 double count remains (ticket verify).
- Given a PATCH changing a budget's funding account, then projections shift accordingly; an unknown id returns 4xx.
- Given shares 60/40 and a period netting +10,000¢, then the deposit account is debited 6,000¢/4,000¢ (largest remainder) at that close.
- Given all 8.1 tracer tests, they pass after day-0 semantic updates, no warning regressions.

## Implementation Notes

- **Storage**: `budget.fundingAccountId` (nullable, FK → account, RESTRICT + index) added via migration `0030_budget_funding_account.sql`; drizzle repo maps it on insert/update/select. No other stored data.
- **Validation**: `planning.budgets` create/update resolve a non-null `fundingAccountId` through `accounts.findVisible` and throw `AppError("NotFound")` when invisible/missing; NULL always allowed. `getSuggestedLimit`'s virtual budget carries `fundingAccountId: null`.
- **Forecast rewrite** (`packages/app/src/planning/forecast.ts`):
  - Day 0 = `balanceAsOf(today)` exact; projection movements start at tomorrow (`projectedFrom`). Pure `projectCashFlow` domain walk unchanged.
  - Coverage: covered categories = `defaultCategoryId` of payees behind confirmed `direction='bill'` series (via `payees` rows loaded in the same read tx). Category budget covered when its category is covered; group budget covered only when ALL its categories are (vacuously true for empty groups). Covered budgets emit nothing.
  - Funding: budget debits land on `budget.fundingAccountId ?? scope.accountId`, but only when that account is among the projected visible transaction accounts (a funding account the viewer cannot see, or a savings account, drops the budget's movements — account never projected ⇒ no phantom day-0 row).
  - Allocation debits: per distinct deposit account (first visible pay anchor with non-null `expectedNetCents` wins; its resolved calendar drives periods), savings = sum of base movements landing on the account within `[period.start, period.end−1]` (floored at 0); close day = `period.end − 1`, emitted only when `tomorrow ≤ closeDay ≤ through`. Base movements are snapshotted per account so debits never feed later periods. Partial-sweep parity with `executeSavingsAllocation`: `toAllocate = floor(savings × ΣsharesBp / 10000)` then largest-remainder `shared.allocate`; one negative movement per rule share. Shares read via read-only reuse of `resolveActiveStage` + `calculateGoalBalances` from `goal-allocation.ts` against the SHARED pool (`personId === null`), rules filtered `source === 'rule'`; no stage/goal mutation, no exit-cascade re-simulation. No active stage / no rules ⇒ no debits.
- **Web**: `api.ts` Budget inputs carry `fundingAccountId`; BudgetEditorSheet adds a "Forecast charged to" select (open transaction accounts; empty = "Pay account (default)").
- **Seed scenario**: `personalCoffeeA` gains funding account `person-a-private` (funding-override demo); new shared-exclusion demo budget `budget-personal-mobile-a` (person A, Utilities/Mobile, $200 limit — covered by the confirmed Telstra series' payee default, never over budget so Epic 6 review-item counts are untouched). The Fitness budget (person B) is kept as-is — its over-budget actuals power `budgets-seed.test.ts`.
- **Seed mirror**: hardcodes stage-one shares `[8000, 1000, 1000]` (goals module runs after budgets-and-bills, so the world has no stages at expectation time); throws if a group budget is ever seeded. Emits per-viewer `day0`, `byDay`, `allocationDebits`; `forecast-seed.test.ts` walks every projected day for both viewers against the mirror.
- **Review patches (89a15a0, supersedes two lines above)**: the allocation savings window starts at each period's rolled-back `expectedPayDate`, not `period.start` (weekend-anchored deposits now count toward the period they pay for); an empty category group is NOT vacuously covered (not-covered); `fundingAccountId: ""` rejected at the schema (400); coverage counts only series on projected accounts; the funding select shows a stored-but-unavailable account as `"<name> (unavailable)"` with round-trip tests; HTTP test asserts unknown funding id → 404; parity comment reworded to what is and is not mirrored. Also `dddff3e`: privacy-manifest entry for `/api/planning/forecast` (story 8.1's route had none — `privacy.test.ts` caught it).
- **Drive-by fix**: `packages/db/src/migrate.test.ts` hardcoded migration list was stale at HEAD (stopped at 0028; migration 0029 shipped without a test update) — extended with `0029_account_low_balance_threshold` and `0030_budget_funding_account`.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens; diff vs `755f83c`):

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Q — allocation savings window sums from `period.start`, but a period's deposit lands on the rolled-back `expectedPayDate` (up to 2 days earlier), so weekend-anchored paydays debit one period early with the wrong base (seed anchorB proves reachability) | medium | patch | Verified forecast.ts:309–323 window vs `rollBackToBusinessDay` (shared/period/index.ts:71); frozen formula says "that period's deposits"; the seed mirror shares the same window, so the parity test cannot catch the shift |
| 2 | Q — `fundingAccountId: ""` skips the existence guard and FK-violates with a 500, not the 4xx the matrix demands | low | patch | Verified `z.string()` accepts `""`, truthy guard skips, FKs ON (open.ts:20); direct `.min(1)` schema fix |
| 3a | Q — payee AD-18 scope vs account-scoped series visibility makes coverage viewer-dependent | false | — | Privacy-correct by design: deriving coverage from a payee invisible to the viewer would leak that payee's category into their forecast; the divergence is conservative (over-projects, warns earlier) |
| 3b | Q — a confirmed series on a closed account still marks its payee's category covered while its own movements are dropped — the category's spend vanishes entirely | medium | patch | Verified `listVisible` keeps closed-account series; `addMovement` drops non-projected targets (forecast.ts:224, 243); `coveredCategories` never checks the account |
| 4 | Q — comment claims "Same split as executeSavingsAllocation" while the engine's completed-goal rescale and exit-capacity caps are not mirrored | low | patch | Verified goal-allocation.ts:269–424 rescale/cap; cascade omission is the plan's documented decision — the comment overstates; direct comment fix |
| 5 | Q — matrix rows only vacuously tested: no confirmed series on a null-default payee, negative-net period never exercised with movements in it, 60/40 pinned only as the combined −10,000¢ delta; no HTTP-level unknown-funding-id 4xx | medium | patch (the split sub-claim rejected: the report's daily delta is the observable surface; the largest-remainder split is pinned by `shared.allocate`'s own tests) | Verified fixtures: payee-cafe (null default) carries no series; allocation test asserts combined byDay deltas only; budgets.test.ts asserts the use-case throw only |
| 6 | Q — the funding select round-trip (a plan task) has no test: options list, "Pay account (default)" ↔ null mapping, body sent | medium | patch | Verified the BudgetsPage.test.tsx diff adds fixtures only; BudgetEditorSheet.tsx:354–385 is new and unexercised |
| 7 | Q — a stored funding account no longer in the options (e.g. closed) renders as "default" while the stale id is kept in state and re-sent; `updateBudget` skips re-validation of unchanged ids, so it persists | low | patch | Verified the option filter and seeded state (BudgetEditorSheet.tsx:83); budgets.ts:275 skips validation when unchanged; direct option-list correction |
| 8 | Q — the `buildEndpointUrl` change in packages/llm and 28 board status flips ride in the diff | false | — | Not this change: neither commit touches those files; pre-existing user work and board bookkeeping surfaced only by the diff-staging procedure |
| 9 | Self (diff read during step 3) — a group budget whose category group is currently empty is excluded as vacuously "all covered", silently dropping its spend | low | patch | Verified `categories.filter(...).every(...)` is true on the empty set (forecast.ts:167–169) |

## Design Notes

Allocation is a simplified mirror of period-close allocation: current stage shares, projected savings from the projection itself, no exit-cascade re-simulation; allocations stay virtual (money assumed swept out of the deposit account). Example: fortnightly period, deposits 20,000¢, bills + prorated budgets 12,000¢ ⇒ 8,000¢ savings × shares. The day-0 rule supersedes 8.1's Design-Note acceptance (deferred-work carried it here); 8.1's household asymmetry is mitigated by the explicit funding-account override.

## Verification

**Commands:**
- `pnpm --filter @pangolin/db db:generate && git diff --exit-code -- packages/db/migrations` -- expected: no drift after committing generated 0030
- `pnpm vitest run packages/app/src/planning/forecast.test.ts packages/app/src/planning/budgets.test.ts apps/server/src/http/forecast-seed.test.ts` -- expected: green
- `pnpm vitest run packages/domain/src/planning/forecast-cashflow.test.ts apps/web/src/pages/BudgetsPage.test.tsx` -- expected: green
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean
