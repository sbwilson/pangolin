---
title: 'Refactor sweep, seed scenario verification, and Playwright e2e tests'
type: 'chore'
ticket: 8
created: '2026-11-08'
status: done
baseline_revision: 'c6bf9302510d74cdcf20dbc575d16625fcb6565b'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '_bmad-output/initiative-pangolin-money-v1/tickets/epic-goals-savings/epic-goals-savings.md'
  - '_bmad-output/initiative-pangolin-money-v1/tickets/epic-goals-savings/tickets/story-savings-reconciliation-review-items-large-withdrawal-detecti-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 7 ("Goals and savings allocation", CAP-6, CAP-7) has all underlying capabilities implemented (schema, staged allocation engine, savings reconciliation, goals UI, cover expense engine with undo, cover UI & buffer divert, and review item sync). However, it lacks a dedicated seed scenario verification test suite asserting all 4 Done-when conditions against synthetic data, end-to-end Playwright tests covering multi-period goal workflows (including Cover an expense and review item actions), and a final cleanup / refactor sweep across the new planning code and seed modules.

**Approach:**
1. Implement a comprehensive seed verification integration test in `apps/server/src/http/goals-seed.test.ts` asserting all 4 Epic 7 Done-when conditions (multi-period staged allocation, stage progression, emergency fund replenishment/fallback, deficit buffer absorption without goal decrement, shortfall warning, Cover an expense ordered proposals for purchase vs shortfall, audited drawdowns, and full undo).
2. Extend Playwright e2e coverage in `e2e/goals.spec.ts` covering the end-to-end user journeys for the Goals workspace: creating goals/stages, triggering Cover an expense, and interacting with savings review items in the review inbox.
3. Verify WCAG 2.2 AA accessibility coverage in `e2e/axe.spec.ts` across light/dark modes and 320px reflow for `/planning/goals` and modal sheets.
4. Perform a code hygiene and contract sweep across `packages/app/src/planning/`, `apps/server/src/admin/seed.ts`, and `tools/seed/src/modules/goals.ts` (fixing any typing, unused variables/imports, or formatting discrepancies).

## Boundaries & Constraints

**Always:**
- Keep all currency math strictly in integer cents (AD-13) and dates in Temporal PlainDate ISO strings (YYYY-MM-DD).
- Invariant: `goal balances + buffer = savings-account balance` in every pool (AD-15).
- Deficits must reduce only the buffer; no goal balance ever decreases except through an explicit confirmed drawdown.
- Scoping & Privacy: Personal goals, rules, drawdowns, and review items remain private to their respective owner; shared goals are visible to both partners (AD-22).
- Pure and deterministic seed test executions against synthetic data.

**Never:**
- Never use floating point numbers for currency amounts or basis points.
- Never write to or mutate a ticket file directly, and never bypass review / audit trails for goal drawdowns.
- Never leak personal goal allocations or drawdowns across partner views.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Done-when 1: Multi-period stage progression & fallback | Seeded savings history across multiple periods with stage 1 (emergency fund exit goal) | Allocations match stage shares; stage 1 exits to stage 2 on emergency fund funding; drawdown below 80% threshold falls back to stage 1 | Clear assertion error if allocation shares or stage transition fails |
| Done-when 2: Deficit period buffer absorption | Period where spend exceeds income (negative new savings) | Buffer absorbs deficit; goal balances remain unchanged | Invariant violation error if any goal balance drops |
| Done-when 3: Over-commitment shortfall & review items | Goals target or drawdowns exceed buffer/savings | Shortfall alert is displayed in warning colour on `/planning/goals` and appears in review inbox | Deduplicated review item generation |
| Done-when 4: Large withdrawal cover & undo | Withdrawal >= $2,000 threshold | Triggers Large withdrawal review item; "Cover it" draws emergency fund -> Flexible -> Protected; Undo restores exact prior balances | Audited drawdown records; 404 / AppError on invalid undo |
| E2E & Accessibility | Playwright visits `/planning/goals` and runs axe audit | Workspaces and sheets render cleanly with zero WCAG 2.2 AA violations | Axe test fails on violation |

</frozen-after-approval>

## Code Map

- `apps/server/src/http/goals-seed.test.ts` -- NEW: Integration test suite asserting all 4 Epic 7 Done-when conditions on a seeded database instance.
- `tools/seed/src/modules/goals.ts` -- Enhance seed expectations or scenario parameters if needed for multi-period verification.
- `apps/server/src/admin/seed.ts` -- Clean up any type casts (`as any`) for goal, stage, and goal-rule insertions.
- `e2e/goals.spec.ts` -- Expand Playwright e2e test suite covering goal editing, Cover an expense sheet interactions, and review inbox items.
- `e2e/axe.spec.ts` -- Verify accessibility audit for `/planning/goals` in light, dark, and mobile reflow modes.
- `packages/app/src/planning/` -- Clean up unused imports, typing gaps, or lint issues across goal allocation, reconciliation, and review generators.

## Tasks & Acceptance

**Execution:**
- [x] `apps/server/src/http/goals-seed.test.ts` -- create integration test verifying all 4 Epic 7 Done-when conditions against the seed scenario -- complete epic milestone verification
- [x] `tools/seed/src/modules/goals.ts` & `apps/server/src/admin/seed.ts` -- refine seed module expectations and clean up typing in seed loader -- ensure type-safe, pure synthetic data seeding
- [x] `e2e/goals.spec.ts` -- expand Playwright e2e tests for Cover an expense and review inbox workflows -- ensure robust user journey coverage
- [x] `e2e/axe.spec.ts` -- audit `/planning/goals` and sheets for WCAG 2.2 AA compliance -- guarantee zero accessibility regressions
- [x] `packages/app/src/planning/` & `apps/web/` -- sweep and clean up code hygiene (unused imports, Biome lints) -- maintain clean codebase standards

**Acceptance Criteria:**
- Given a seeded multi-period database, when evaluated, stage progression, emergency fund cap, fallback below threshold, deficit buffer absorption, shortfall detection, and Cover an expense with undo all pass assertion in `goals-seed.test.ts`.
- Given the Goals workspace and review inbox, when exercised in Playwright e2e tests, all goal management, cover sheets, and review item actions complete successfully.
- Given `/planning/goals` in light, dark, and mobile modes, when scanned by axe, zero WCAG 2.2 AA violations are found.
- Given the test suite and linter, all planning unit tests pass and code hygiene checks are clean.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- quick: apps/server/src/http/goals-seed.test.ts assert audit logging for stage transitions/fallback and rescale behavior | verdict: medium | route: patch | action: added stage-change audit record assertions, rescaleGoalRules check, and explicit isFallback check in Condition 1
- quick: apps/server/src/http/goals-seed.test.ts assert shortfall review item in inbox for over-committed pool | verdict: medium | route: patch | action: added assertion verifying SAVINGS_SHORTFALL_HOUSEHOLD_REVIEW presence in listReviewItems in Condition 3
- quick: apps/server/src/http/goals-seed.test.ts assert large withdrawal review items raised for both partners and linked to cover | verdict: medium | route: patch | action: seeded qualifying withdrawal, ran syncAllSavingsReviewItems, asserted item raised for both partners and linked to drawdown in Condition 4
- quick: e2e/goals.spec.ts replace vacuous conditional checks with direct assertions | verdict: medium | route: patch | action: mocked /api/review and asserted card and action button visibility deterministically
- quick: plan execution tasks uncompleted | verdict: low | route: patch | action: checked off all completed tasks in plan

## Design Notes

- The seed verification test `apps/server/src/http/goals-seed.test.ts` mirrors the structure of `apps/server/src/http/budgets-seed.test.ts`:
  - Spins up a temporary SQLite database with all migrations applied.
  - Links the seed data using `linkSeed`.
  - Exercises both HTTP API endpoints and domain use cases with `systemViewer` and `personViewer`.
  - Directly asserts the 4 Done-when conditions specified in `epic-goals-savings.md`.

## Verification

**Commands:**
- `pnpm exec vitest run apps/server/src/http/goals-seed.test.ts` -- expected: all seed scenario verification tests pass
- `pnpm exec vitest run packages/app/src/planning/` -- expected: all planning unit tests pass
- `pnpm --filter e2e exec playwright test goals.spec.ts axe.spec.ts` -- expected: goals e2e + axe accessibility pass
