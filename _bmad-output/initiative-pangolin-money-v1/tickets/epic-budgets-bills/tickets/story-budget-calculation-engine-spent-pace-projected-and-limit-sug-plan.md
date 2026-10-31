---
title: 'Budget calculation engine: spent, pace, projected, and limit suggestions'
type: 'feature'
ticket: '2'
created: '2026-11-01'
status: 'built'
baseline_revision: '24a05bf433dd3e8f16c22a0666e2592f9a788904'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users need to see if their spending this fortnight or month is on track per category or category group. Currently, no `budget` table or schema exists, and there is no domain or application engine to calculate live spent, pace, projected, rollover carryover, or 6-period historical limit suggestions from transaction splits aligned to `PayCalendar`.

**Approach:** 
1. Add migration 0026 and schema for `budget` table with person scoping (`person_id` NULL for shared, or set to owner for personal), cadence (`fortnight` or `month`), target entity (category or category group), limit cents, and rollover enabled flag.
2. Implement pure domain budget calculations in `@pangolin/domain` (`spent`, `pace`, `projected`, `rollover`, and `limitSuggestion`) adhering strictly to AD-13 (`toCents` half-even rounding) and Temporal `PlainDate`.
3. Implement budget repository and SQL aggregations in `packages/db` utilizing `visibleTxn`, `flowKindSql`, and beneficiary scoping (personal budgets count the person's splits; shared budgets count shared splits, whoever paid).
4. Implement application use cases in `packages/app/src/planning/budgets.ts` to create, read, update, list, and calculate budget summaries across periods resolved via `PayCalendar`.

## Boundaries & Constraints

**Always:**
- Dates are Temporal `PlainDate`, imported only from `shared/temporal`. Periods are half-open `[start, end)`.
- Rounding of pace, projection, and suggestions goes strictly through `shared.toCents(decimal)` (half-even rounding per AD-13).
- Scope is either shared or one person (AD-22). Shared budgets carry `person_id: null` and count splits where `beneficiary = 'shared'` (regardless of account ownership or who paid). Personal budgets carry `person_id` and count splits where `beneficiary = person_id`.
- Personal budgets resolve their period boundaries from the person's `pay_anchor` via `resolvePayCalendar`. Shared budgets resolve from the household's anchor (`household_settings.household_pay_anchor_person_id` or default pay anchor).
- Only expense splits count toward budget spent (`flowKind = 'expense'`, AD-23). Transfers and income are excluded.
- Limit suggestions calculate the mean spent over the last 6 closed periods of that cadence. If fewer than 6 closed periods or no spending history exists, return null (no suggestion without history).
- Rollover carries the net difference between limit and spent from the previous closed period into the current period (if `rollover = true`).
- A budget targets either a `category_id` or a `category_group_id` (mutually exclusive, exactly one required).

**Never:**
- No floats near money (AD-13, branded `Cents` integer).
- Never read system clock outside tests; take injected `Clock` in household timezone (AD-14).
- Never leak private personal budgets or private splits across partners (AD-22).
- Do not build UI screens or over-budget review items in this ticket (those belong to stories 6.3 and 6.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shared budget spent calculation | Shared budget on "Groceries" category, 3 splits ($50 shared from joint, $30 shared from partner personal card, $20 private personal) | `spentCents: 8000` (counts both shared splits, ignores personal split) | No error |
| Pace calculation mid-period | Period length 14 days, today is day 7 (elapsed 7 days), spent $280, limit $600 | Elapsed fraction 7/14 = 0.5. Linear pace is $300. Pace status: on-track ($280 <= $300). | No error |
| Projected calculation | Period length 14 days, elapsed 7 days, spent $280 | Daily rate = $280 / 7 = $40/day. Remaining 7 days * $40 = $280. Projected total = $560. | If elapsed days = 0, projected = spent |
| Limit suggestion (6 closed periods) | Spent over last 6 closed fortnights: $200, $220, $210, $190, $200, $240 | Mean = 1260 / 6 = $210. Suggested limit = $210. | No error |
| Limit suggestion (< 6 closed periods) | Only 3 closed periods recorded | Suggested limit: `null` (no suggestion without full 6-period history) | Returns null cleanly |
| Rollover carryover | Previous period limit $400, spent $360. Rollover enabled. Current period base limit $400. | Rollover amount = +$40. Effective limit or available = $440 ($40 rolled over). | Rollover overspent carries as negative |
| Partner privacy | Partner A queries budgets | Receives shared budgets + Partner A's personal budgets. Partner B's personal budgets are omitted. | Scoped query |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/budget.ts` -- Define `budget` table (id, personId, categoryId, categoryGroupId, cadence, limitCents, rollover, createdAt, updatedAt) with checks ensuring exactly one target and positive limit.
- `packages/db/src/schema/index.ts` -- Re-export budget schema.
- `packages/db/migrations/0026_budget.sql` -- Migration 0026 adding `budget` table and foreign key constraints / indexes.
- `packages/db/migrations/meta/_journal.json` -- Add migration 0026 entry.
- `packages/domain/src/planning/budget-math.ts` -- Pure domain math: calculate spent, pace ratio, projected total, rollover carryover, and 6-period average suggestion using `toCents` (AD-13).
- `packages/domain/src/index.ts` -- Re-export budget math domain functions and types.
- `packages/db/src/repositories/budget.ts` -- Budget repository: CRUD operations, query budgets for viewer (AD-22), query historical spent for closed periods.
- `packages/db/src/unit-of-work.ts` -- Expose `budgets` repository on `UnitOfWork`.
- `packages/app/src/ports/unit-of-work.ts` -- Type definitions for `BudgetRepository`, `BudgetRow`, and budget summary queries.
- `packages/app/src/testing/memory-uow.ts` -- In-memory implementation of `BudgetRepository` for fast unit tests.
- `packages/app/src/planning/budgets.ts` -- Application use cases: `getBudgetSummary`, `listBudgets`, `createBudget`, `updateBudget`, `deleteBudget`, `getSuggestedLimit`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/budget.ts` & `packages/db/src/schema/index.ts` -- define `budget` table schema and checks -- database schema
- [x] `packages/db/migrations/0026_budget.sql` & journal -- create and verify migration 0026 -- database migration
- [x] `packages/domain/src/planning/budget-math.ts` & `budget-math.test.ts` -- implement pure functions for pace, projected, rollover, and limit suggestion -- domain logic
- [x] `packages/db/src/repositories/budget.ts` & `unit-of-work.ts` -- implement budget persistence, SQL spent aggregation over `visibleTxn`, and history queries -- database repositories
- [x] `packages/app/src/ports/unit-of-work.ts` & `packages/app/src/testing/memory-uow.ts` -- wire ports and in-memory repository -- application ports
- [x] `packages/app/src/planning/budgets.ts` & `budgets.test.ts` -- implement budget application service combining `PayCalendar`, repo queries, and domain calculations -- application service
- [x] `packages/db/src/repositories/budget.test.ts` -- integration test verifying SQL spent aggregation, privacy boundaries, and history aggregation -- persistence tests

**Acceptance Criteria:**
- Given a shared budget and splits across joint and personal accounts, when spent is calculated, then it sums all splits marked shared and excludes personal splits.
- Given a personal budget for Person A, when Partner B queries budgets, then Person A's personal budget is not returned.
- Given a budget with spent $280 at day 7 of a 14-day period with limit $600, when calculations run, then pace indicates on track ($280 <= $300) and projected spent is $560.
- Given a budget with rollover enabled and $40 unspent from the immediate prior period, when the current period is evaluated, then $40 rollover carries over.
- Given spending history across 6 closed periods, when `getSuggestedLimit` is called, then it returns the arithmetic mean of the 6 periods rounded half-even via `toCents`.
- Given spending history across fewer than 6 closed periods, when `getSuggestedLimit` is called, then it returns null.

## Implementation Notes

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Action Taken |
|---|---|---|
| Omission of `tx.budgets.deleteForPerson(leaver)` on household departure | True | Added `tx.budgets.deleteForPerson(leaver)` in `deleteScopedRows` in `packages/app/src/accounts/leave-household.ts`. |
| Missing indexes on `budget` foreign keys | True | Added indexes on `person_id`, `category_id`, and `category_group_id` in `budget.ts` and `0026_budget.sql`. |
| Shared budget fallback selecting mismatched cadence pay anchor | True | Added cadence matching check (`fortnight` -> `fortnightly`, `month` -> `monthly`) when selecting fallback anchor in `resolveBudgetPayCalendar`. |
| 6-period limit suggestion historical check & deposit alignment | True | Checked oldest period boundary against transaction ledger history in `budgets.ts`, correctly returning `null` only when fewer than 6 closed periods of history exist. |
| Integer cents arithmetic dividing by 100 then calling `toCents` | True | Replaced with direct `cents(...)` integer addition and subtraction in `packages/domain/src/planning/budget-math.ts`. |

## Design Notes

`BudgetSummary` interface:
```typescript
export interface BudgetSummary {
  readonly budget: BudgetRow;
  readonly period: PayPeriod;
  readonly spentCents: Cents;
  readonly remainingCents: Cents;
  readonly paceCents: Cents; // Expected spent by elapsed time (linear)
  readonly projectedCents: Cents; // Spent + daily_rate * remaining_days
  readonly rolloverCents: Cents; // Carried over from prior period (if enabled)
  readonly effectiveLimitCents: Cents; // limit + rollover
  readonly status: "on-track" | "heading-over" | "over-budget";
}
```

Pace & Projection calculation formulas:
- Total period days $D = \text{end} - \text{start}$
- Elapsed days $E = \min(D, \max(0, \text{today} - \text{start}))$
- Remaining days $R = D - E$
- Linear pace expectation: $\text{pace} = \text{toCents}\left(\text{effectiveLimit} \times \frac{E}{D}\right)$
- Daily rate: if $E > 0$, $\text{rate} = \frac{\text{spent}}{E}$, else 0.
- Projected: $\text{projected} = \text{toCents}(\text{spent} + \text{rate} \times R)$
- Status:
  - If $\text{spent} > \text{effectiveLimit}$: `"over-budget"`
  - Else if $\text{projected} > \text{effectiveLimit}$: `"heading-over"`
  - Else: `"on-track"`

## Verification

**Commands:**
- `pnpm --filter @pangolin/domain test` -- verify domain budget math tests pass
- `pnpm --filter @pangolin/db test` -- verify migration 0026, schema, and budget repo tests pass
- `pnpm --filter @pangolin/app test` -- verify planning budgets use cases and calculations pass
