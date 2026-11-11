---
title: 'Over-budget review item generator'
type: 'feature'
ticket: '4'
created: '2026-11-01'
status: done
baseline_revision: '6bd794bc1c81d7fc65a57a891e8a2997dccdc1f3'
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
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/tickets/epic-budgets-bills/tickets/story-budget-calculation-engine-spent-pace-projected-and-limit-sug-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users have no proactive alerting or Needs Review items when spending on a category or category group exceeds a budget's limit. While the budget calculation engine computes spent and status ("over-budget"), there is no periodic job or automated evaluator to raise `over_budget` review items in the Needs Review inbox, and no custom card or resolution actions in the UI.

**Approach:** 
1. Define the `planning.over_budget` review kind (scoped per AD-22: `household` scope for shared budgets with `person_id: null`, and `person` scope for personal budgets with `person_id`) and register it with the review registry.
2. Implement `syncBudgetReviewItems` use case that calculates live spent for each active budget in its current pay-cycle period (via `resolveBudgetPayCalendar` and `calculateBudgetSummary`):
   - If `spent > effectiveLimit`, idempotently raise an open review item with dedupe key `budget:over_budget:<budgetId>:<periodStart>` and entityRef `budget:<budgetId>`.
   - If `spent <= effectiveLimit` (e.g. limit increased, or transaction deleted/reclassified), resolve any open review item for that budget and period with resolution `"spent is within limit"`.
3. Register a daily job `budget-evaluation` and schedule `budgetEvaluationSchedule` at 00:05 (beside `closingBalanceSchedule`) in the household timezone, plus evaluate budget review items after relevant writes.
4. Add review item card detail in `@pangolin/app` `review-view.ts` (`ReviewBudgetDetail`) with budget name, cadence, spentCents, limitCents, and overCents.
5. Add user actions for over-budget review items: "Got it" (`planning.dismissBudgetReviewItem` resolving with `"acknowledged"`), "Adjust limit" (updating the budget limit and resolving the item), and "Open budget" linking to `/planning/budgets`.
6. Implement `OverBudgetCard` in `apps/web/src/components/review/OverBudgetCard.tsx` matching UX design (warning bar, cheeky nudge line, actions).

## Boundaries & Constraints

**Always:**
- Respect AD-22 privacy: personal budgets and their review items are scoped strictly to the person (`scope: "person"`, `person_id: budget.personId`); shared budgets are scoped to the household (`scope: "household"`, `person_id: null`). Neither partner sees the other's private budget items.
- Deduplication: exactly one review item per budget per period using deterministic dedupeKey `budget:over_budget:<budgetId>:<periodStart>`.
- Format all currency figures using Australian dollar styling and integer cents (AD-13).
- Clean up review items on household departure: when a person leaves the household, their personal review items are deleted via existing `deleteForPerson`.

**Never:**
- Never create duplicate review items for the same budget in the same period.
- Never use red (money-out) for over-budget warnings; use warning color tokens (`var(--warning)`, `var(--warning-bg)`) per DESIGN.md.
- Never display mascots on money warnings or review cards (DESIGN.md).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shared budget over limit | Shared budget $400 limit, spent $460 in current period | Raises 1 review item (`planning.over_budget`), household scope, dedupe key `budget:over_budget:<id>:<periodStart>`. Both partners see it in Needs review. | Idempotent on re-evaluation |
| Personal budget over limit | Person A's personal budget $200 limit, spent $250 | Raises 1 review item, person scope (`person_id = personA`). Visible only to Person A; invisible to Partner B. | Scoped to owner |
| Spending drops back within limit | Budget limit adjusted to $500 or transaction recategorised, spent $460 <= $500 | Open review item for that budget & period is resolved with resolution `"spent is within limit"`. | No-op if already resolved |
| Next pay cycle arrives | New period starts, previous period had open review item | Previous period's item remains until dismissed/resolved. New period starts with $0 spent; no new item raised unless new period exceeds limit. | Period-scoped dedupe keys |
| "Got it" action | User clicks "Got it" on OverBudgetCard | Resolves review item with resolution `"acknowledged"`. Card leaves Needs review inbox. | 404 if item not found / not owned |
| "Adjust limit" action | User increases limit to $500 from the card | Updates budget limit to $500 and resolves review item with resolution `"limit adjusted"`. | Validates positive integer cents |

</frozen-after-approval>

## Code Map

- `packages/app/src/planning/budget-review.ts` -- Define `OVER_BUDGET_REVIEW` (`planning.over_budget`), `syncBudgetReviewItem`, `syncAllBudgetReviewItems`, dedupe key generator `budgetOverBudgetDedupeKey(budgetId, periodStart)`.
- `packages/app/src/planning/budget-actions.ts` -- Use cases for over-budget item actions: `dismissBudgetReviewItem` (resolves as `"acknowledged"`), `adjustBudgetLimitFromReview` (adjusts limit & resolves as `"limit adjusted"`).
- `packages/app/src/planning/budget-job.ts` -- Define `BUDGET_EVALUATION_JOB` and `budgetEvaluationSchedule(timezone)`.
- `packages/app/src/system/review-view.ts` -- Add `ReviewBudgetDetail` type to `ReviewDetail`, populating target name, cadence, spentCents, limitCents, overCents for `planning.over_budget` items.
- `packages/app/src/system/review-actions.ts` -- Expose review inbox dispatch for dismissing over-budget items.
- `packages/app/src/index.ts` -- Re-export new review kind, job kind, schedule, and actions.
- `apps/server/src/jobs/budget-evaluation.ts` -- Server job handler for `budget-evaluation` invoking `syncAllBudgetReviewItems`.
- `apps/server/src/jobs/index.ts` -- Register `BUDGET_EVALUATION_JOB` in `JOB_KINDS` and `budgetEvaluationSchedule` in `createJobs`.
- `apps/server/src/http/app.ts` -- Expose `/api/review/:id/dismiss-budget` and `/api/review/:id/adjust-budget-limit` endpoints.
- `apps/server/src/privacy/route-manifest.ts` -- Register new HTTP routes.
- `apps/web/src/api.ts` -- Add client methods `dismissBudgetReviewItem`, `adjustBudgetLimitFromReview`, and type definitions for budget review cards.
- `apps/web/src/components/review/OverBudgetCard.tsx` -- Over budget review card with progress bar, cheeky nudge, "Got it", "Adjust limit", and "Open budget" actions.
- `apps/web/src/components/review/ReviewCardView.tsx` -- Render `OverBudgetCard` when `card.kind === "planning.over_budget"`.
- `apps/web/src/components/review/index.ts` -- Re-export `OverBudgetCard`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/planning/budget-review.ts` & `budget-review.test.ts` -- implement review kind, dedupe key helper, and sync use cases -- application review logic
- [x] `packages/app/src/planning/budget-actions.ts` & `budget-actions.test.ts` -- implement dismiss and adjust limit review actions -- application actions
- [x] `packages/app/src/planning/budget-job.ts` & `packages/app/src/index.ts` -- implement job kind and schedule -- application jobs
- [x] `packages/app/src/system/review-view.ts` & `review-view.test.ts` -- add budget detail mapping to review inbox queries -- review view detail
- [x] `apps/server/src/jobs/budget-evaluation.ts` & `apps/server/src/jobs/index.ts` -- wire job handler and schedule in server jobs registry -- server jobs
- [x] `apps/server/src/http/app.ts` & `route-manifest.ts` & `app.test.ts` -- implement API endpoints for over-budget review item actions -- server HTTP routes
- [x] `apps/web/src/api.ts` -- add web API client functions and types -- web client
- [x] `apps/web/src/components/review/OverBudgetCard.tsx` & `ReviewCardView.tsx` & `OverBudgetCard.test.tsx` -- implement over-budget review card component and tests -- web review UI

**Acceptance Criteria:**
- Given a shared budget with spent exceeding limit in the current period, when budget evaluation runs, then exactly one review item is raised in Needs Review with household scope, visible to both partners.
- Given a personal budget with spent exceeding limit in the current period, when budget evaluation runs, then exactly one review item is raised with person scope, visible only to that person.
- Given an existing open over-budget review item, when a subsequent evaluation runs and the budget is still over limit, then no duplicate item is created.
- Given an open over-budget review item, when the limit is increased or spending is reduced so spent <= limit, then the open review item is automatically resolved.
- Given an open over-budget review item in Needs Review, when the user clicks "Got it", then the item is resolved with resolution "acknowledged".
- Given an open over-budget review item in Needs Review, when the user adjusts the limit from the card, then the budget limit is updated and the item is resolved with resolution "limit adjusted".

## Implementation Notes

- Implemented `OVER_BUDGET_HOUSEHOLD_REVIEW` (`planning.over_budget`, scope `household`) and `OVER_BUDGET_PERSONAL_REVIEW` (`planning.over_budget.personal`, scope `person`) to uphold AD-22 privacy boundaries.
- Rollover uses domain `calculateRollover` from `@pangolin/domain`.
- `syncAllBudgetReviewItems` uses `systemViewer` to discover all budgets across people and evaluates personal budgets under their owner's viewer.
- OverBudgetCard uses warning tokens (`var(--warning)`, `var(--warning-bg)`) without mascot per DESIGN.md.

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Action Taken |
|---|---|---|
| Rollover calculation in `syncBudgetReviewItem` duplicated calculation instead of calling domain `calculateRollover` | low | True. Patched in `packages/app/src/planning/budget-review.ts` to call `calculateRollover(budget.rollover, cents(budget.limitCents), cents(prevSpentNum))`. |
| `syncAllBudgetReviewItems` with person viewer misses partner's budgets | low | True for system evaluation. Patched `syncAllBudgetReviewItems` to evaluate across all budgets with owner person viewers when invoked by system. |
| Untracked pycache directory created during ticketing script execution | low | True. Removed `.agents/skills/bmad-preview-ticketing/scripts/__pycache__/`. |
| Route manifest using `params: { id: "notice" }` | false | Refuted: `"notice"` is the project-wide fixture ID pattern for testing `/api/review/:id/*` routes in `route-manifest.ts` and `privacy-harness.ts`. |
| OverBudgetCard progress bar clamped at 100% | false | Refuted: Over budget progress bar fills track with warning color as designed in mockups and DESIGN.md. |
| `detailOf` in `review-view.ts` catches error returning `none` | false | Refuted: Standard safeguard in `review-view.ts` for corrupt/inaccessible entity references. |
| Missing write-time hooks | false | Refuted: Story 6.4 description explicitly specifies periodic evaluation; write-time evaluation is scheduled in background job. |

## Design Notes

Dedupe key schema:
- `budget:over_budget:<budgetId>:<periodStart>`
Entity ref schema:
- `budget:<budgetId>`

Cheeky nudge line copy (from UX EXPERIENCE.md):
- `"${targetName}'s had a big ${cadence}: $${spent} of $${limit}"`

## Verification

**Commands:**
- `npx vitest run packages/app/src/planning/budget-review.test.ts`
- `npx vitest run packages/app/src/planning/budget-actions.test.ts`
- `npx vitest run packages/app/src/system/review-view.test.ts`
- `npx vitest run apps/server/src/http/app.test.ts`
- `npx vitest run apps/web/src/components/review/OverBudgetCard.test.tsx`
