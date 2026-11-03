---
title: 'Refactor sweep, seed scenario verification, and Playwright e2e'
type: 'chore'
ticket: '8'
created: '2026-11-03'
status: 'built'
baseline_revision: '5f66005b43235d555dc518ffcad8901e4c364f16'
route: 'full'
route_source: 'auto'
risk: 'low'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/tickets/epic-budgets-bills/epic-budgets-bills.md'
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/tickets/epic-budgets-bills/tickets/story-budgets-workspace-ui-and-editor-modal-plan.md'
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/tickets/epic-budgets-bills/tickets/story-over-budget-review-item-generator-plan.md'
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/tickets/epic-budgets-bills/tickets/story-bill-alerts-missed-payments-and-price-rise-detection-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 6 ("Budgets and recurring bills") features (tickets 6.1 through 6.7) are built, but the epic lacks a deterministic SeedModule generating synthetic budgets and recurring series, integration verification of the 4 Done-when conditions against the seed scenario, Playwright e2e test coverage for budgets and bills journeys, WCAG 2.2 AA axe accessibility audits on `/planning/budgets`, and a clean hygiene sweep across packages.

**Approach:** 
1. Implement the planning seed module in `tools/seed/src/modules/budgets-and-bills.ts` (emitting synthetic pay anchors, budgets, recurring series, and transactions verifying all 4 Done-when conditions) and wire it into `defaultModules` and the seed loader.
2. Verify all 4 Done-when conditions against the seed scenario: spent/pace/projected calculations, rollover carryover, 6-period limit suggestions, over-budget review items, personal vs shared pay anchors, recurring series detection/confirmation, and missed-payment + price-rise alerts.
3. Add Playwright e2e tests in `e2e/budgets-and-bills.spec.ts` covering the end-to-end user journeys across budgets workspace, recurring bills section, one-click confirmation, and Needs Review actions.
4. Add WCAG 2.2 AA accessibility audit for `/planning/budgets` (light and dark mode, 320px reflow) in `e2e/axe.spec.ts`.
5. Perform a code hygiene sweep fixing any lint/formatting warnings (no explicit any, unused variables) introduced across epic 6 stories.

## Boundaries & Constraints

**Always:**
- Keep all money values in integer cents (AD-13) and dates in Temporal `PlainDate` (YYYY-MM-DD).
- Respect AD-22 privacy: personal budgets and personal alerts visible only to the respective owner; shared budgets visible to both partners.
- Seed generation must be pure and deterministic, depending only on `world` and `rng`.
- All Playwright and axe tests must pass deterministically in CI and local test runs.

**Never:**
- Never use floating point math for currency calculations.
- Never leak private personal budgets or personal review items across partners.
- Never add external network calls or non-deterministic sources (e.g. `Date.now()`, `Math.random()`) to seed modules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Seed module generation | `tools/seed` runs with `budgets-and-bills` module | Produces deterministic pay anchors, budgets, and recurring series matching expectations | Validation error on schema/reference mismatch |
| Seed loader verification | Admin CLI applies seed with budgets and recurring series | Database seeded with valid records, all Done-when conditions verified | Rollback transaction on error |
| Budgets Playwright journey | User visits `/planning/budgets`, creates budget, views progress | Workspace displays summary, cards, and modal editor works seamlessly | Visible error state if API fails |
| Recurring bills Playwright journey | User confirms detected recurring bill candidate | Candidate confirmed in 1 click, moves to active list, alerts appear on review page | Toast or inline error on failure |
| Accessibility audit | Axe scanner audits `/planning/budgets` in light/dark & 320px | Zero WCAG 2.2 AA violations | Axe test fails on violation |

</frozen-after-approval>

## Code Map

- `tools/seed/src/modules/budgets-and-bills.ts` -- new seed module generating synthetic budgets, pay anchors, and recurring series
- `tools/seed/src/modules/index.ts` -- register `budgetsAndBills` in `defaultModules`
- `tools/seed/src/world.ts` -- seed world types for budgets and recurring series events
- `apps/server/src/admin/seed.ts` -- server seed loader applying budgets and recurring series events
- `e2e/budgets-and-bills.spec.ts` -- new Playwright e2e test suite covering budget cards, editor, recurring bills, and review items
- `e2e/axe.spec.ts` -- accessibility audit for `/planning/budgets` route across light, dark, and 320px reflow
- `packages/app/src/planning/` -- hygiene cleanups (unused imports, any types) across budget and bill alert use cases
- `apps/web/src/pages/BudgetsPage.tsx` -- verify accessibility and selector attributes for e2e tests

## Tasks & Acceptance

**Execution:**
- [ ] `tools/seed/src/world.ts` & `packages/shared/src/seed-references.ts` -- define seed events for pay anchors, budgets, and recurring series -- enable pure synthetic data generation
- [ ] `tools/seed/src/modules/budgets-and-bills.ts` & `tools/seed/src/modules/index.ts` -- implement seed module emitting budgets, pay anchors, recurring series, and expectations -- satisfy Done-when conditions 1-3
- [ ] `apps/server/src/admin/seed.ts` -- wire seed loader to persist budgets, pay anchors, and recurring series via use cases -- link seed into demo mode and CLI
- [ ] `e2e/budgets-and-bills.spec.ts` -- implement Playwright test verifying budgets workspace, editing, bill candidate confirmation, and review alerts -- satisfy Done-when condition 4
- [ ] `e2e/axe.spec.ts` -- add `/planning/budgets` WCAG 2.2 AA and 320px reflow audits -- guarantee zero accessibility regressions
- [ ] `packages/app/` & `apps/server/` & `apps/web/` -- run lint and formatting sweep fixing warnings and unused variables -- ensure clean codebase hygiene
- [ ] `apps/server/src/http/budgets-seed.test.ts` -- add integration test asserting all 4 Done-when conditions against the seed scenario -- complete verification

**Acceptance Criteria:**
- Given a seeded world, when budgets and recurring series are generated and loaded, then spent/pace/projected match hand calculations, rollover carries into the next period, and limit suggestions reflect 6-period history.
- Given personal and shared budgets, when evaluated, personal budgets follow each person's payday anchor while shared budgets use the household anchor.
- Given synthetic recurring series, when detected, a series of >=3 occurrences is one-click confirmed, and missed payments or 11% price increases raise review alerts.
- Given the `/planning/budgets` route and dialogs, when scanned by Playwright and axe, then all e2e user journeys pass and zero WCAG 2.2 AA accessibility violations are reported.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- quick: apps/server/src/admin/seed.ts checkReferences validates categoryGroup against DEFAULT_CATEGORIES groups | verdict: medium | route: patch | action: added checkReferences validation for budget.created categoryGroup and test in seed.test.ts
- quick: tools/seed/src/world.ts applyEvents pay-anchor.created defaults alignment to "calendar" | verdict: medium | route: patch | action: added default "calendar" when alignment is omitted
- quick: packages/app/src/planning/budgets.ts resolveBudgetPayCalendar falls back to cadence-matching anchor | verdict: medium | route: patch | action: preserved cadence-matching fallback when household anchor is unset or mismatched
- quick: e2e/budgets-and-bills.spec.ts scope filter and candidate confirmation assertions | verdict: medium | route: patch | action: asserted card visibility/absence and replaced conditional count branches with direct locator expectations

## Verification

**Commands:**
- `pnpm -F @pangolin/seed test` -- expected: all seed module and reference unit tests pass
- `pnpm -r test` -- expected: all workspace unit and integration tests pass
- `pnpm run lint` -- expected: zero errors and clean lint/formatting check
- `pnpm run typecheck` -- expected: clean TypeScript compilation across all packages
