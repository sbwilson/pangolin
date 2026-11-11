---
title: 'Budgets workspace UI and editor modal'
type: 'feature'
ticket: '3'
created: '2026-11-01'
status: done
baseline_revision: '54bf2b88c65a6c26801176ddc16b15756cb7a2b4'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-budgets.html'
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/tickets/epic-budgets-bills/tickets/story-budget-calculation-engine-spent-pace-projected-and-limit-sug-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users have no UI to view their budgets, track pace and projections across fortnightly and monthly pay-cycle periods, or create and edit budgets with prefilled limit suggestions. While the backend calculation engine exists in `@pangolin/app`, there are no HTTP endpoints, web API client methods, or `/planning/budgets` workspace UI.

**Approach:** 
1. Expose REST endpoints in `apps/server/src/http/app.ts` for budgets CRUD, summary calculations, and limit suggestions using existing `@pangolin/app` use cases.
2. Add API client functions in `apps/web/src/api.ts` for querying and mutating budgets and fetching limit suggestions.
3. Build the `/planning/budgets` page (`BudgetsPage.tsx` and route in `apps/web/src/router.tsx`) featuring a header summary line, period scope switcher/toggle (personal vs shared), responsive 2-column budget cards grid showing spent/limit/pace/projected progress bars and sparkline mini-charts, and the budget editor sheet/modal with suggested limit prefill and rollover toggle.
4. Enable the Budgets navigation links in `AppSidebar.tsx` and `MobileNav.tsx`.

## Boundaries & Constraints

**Always:**
- Respect AD-22 privacy: personal budgets are visible only to their owner; shared budgets are visible to both partners.
- Use `useMe()` to determine viewer identity and partner presence.
- Format all currency with tabular numbers, Australian dollar styling, and half-even cents representations via existing money utilities (`formatMoney`, `formatCents`).
- Preserve accessibility: all modal/sheet controls use proper dialog roles, focus traps, aria labels, and progress bars include screen-reader accessible attributes (`aria-label`, `role="img"`).
- Keep warnings distinct: over-budget and projected-over states use warning tokens (`var(--warning)`, `var(--warning-bg)`); never use money-out red for warnings. No mascot on financial warnings.
- Keep the route at `/planning/budgets`.

**Never:**
- Never display or leak a partner's private personal budgets.
- Never write floats near currency calculations.
- Do not build recurring bills or over-budget review-item generation in this story (those belong to 6.4 / 6.5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List budgets on `/planning/budgets` | User navigates to `/planning/budgets` with existing budgets | Shows page header, summary line (e.g., "X budgets you can see · Y over · Z on track"), and budget card grid | Shows empty state if 0 budgets with prompt to create one |
| Filter personal vs shared | User selects "All", "Shared", or "Personal" in filter | Cards filter accordingly; personal budgets show person chip/dot; shared show shared icon | No error |
| Over-budget card state | Spent > limit in current period | Card displays "over" styling with warning badge/text, 100% track fill, and link to review/breakdown | No error |
| Projected-over card state | Spent <= limit but projected > limit | Card displays "projected over" styling with projected pace heading | No error |
| Create budget with suggested limit | User opens "New budget" sheet, selects category with >=6 periods of history | Editor fetches `/api/planning/budgets/suggested-limit?id=...` or category history, displays "You've averaged $X a [period]", prefilling limit input | If no suggestion (<6 periods), helper displays "No spending history yet" without error |
| Create / Edit budget submission | User submits budget with category, cadence, limit, and rollover toggle | Calls `POST /api/planning/budgets` or `PATCH /api/planning/budgets/:id`, closes sheet, refreshes query | Shows field validation errors inline if limit <= 0 or neither/both target selected |
| Delete budget | User confirms deletion in editor | Calls `DELETE /api/planning/budgets/:id`, invalidates query, budget card removed | Inline error banner if delete fails |

</frozen-after-approval>

## Code Map

- `apps/server/src/http/app.ts` -- Register `/api/planning/budgets` (GET list, POST create), `/api/planning/budgets/summary` (GET summaries for current viewer), `/api/planning/budgets/:id` (GET, PATCH, DELETE), and `/api/planning/budgets/suggested-limit` (GET).
- `apps/server/src/http/app.test.ts` -- Integration tests for budget HTTP endpoints, ensuring viewer privacy, CRUD actions, and summary calculations.
- `apps/web/src/api.ts` -- Add TypeScript types (`BudgetData`, `BudgetSummaryData`) and API functions (`fetchBudgetSummaries`, `createBudget`, `updateBudget`, `deleteBudget`, `fetchSuggestedLimit`).
- `apps/web/src/pages/BudgetsPage.tsx` -- Main budgets workspace view: header, summary row, filter segment (Shared / Personal), budget cards grid, empty states.
- `apps/web/src/pages/BudgetsPage.test.tsx` -- Unit and interaction tests for `BudgetsPage`.
- `apps/web/src/components/BudgetCard.tsx` -- Single budget card component with spent/of limit, left/over indicator, visual progress bar with projection marker, pace text, and SVG mini sparkline.
- `apps/web/src/components/BudgetEditorSheet.tsx` -- Sheet/modal dialog for creating and editing budgets (category/group selector, scope toggle, cadence toggle, limit with prefilled suggestion, rollover switch).
- `apps/web/src/routes/planning.budgets.tsx` (or `apps/web/src/routes/budgets.tsx`) -- TanStack router route definition for `/planning/budgets`.
- `apps/web/src/router.tsx` -- Register `/planning/budgets` route in route tree.
- `apps/web/src/components/AppSidebar.tsx` & `MobileNav.tsx` -- Turn "Budgets" nav link from disabled placeholder into active `<Link to="/planning/budgets">`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/server/src/http/app.ts` & `app.test.ts` -- wire HTTP routes for budgets CRUD, summaries, and limit suggestions -- backend API
- [x] `apps/web/src/api.ts` -- add typed budget API clients and request/response models -- web API layer
- [x] `apps/web/src/components/BudgetCard.tsx` -- implement individual budget card with spent/pace/projection progress bar and mini SVG line -- UI components
- [x] `apps/web/src/components/BudgetEditorSheet.tsx` -- implement sheet modal for creating and updating budgets with suggestion fetch and rollover switch -- UI modal
- [x] `apps/web/src/pages/BudgetsPage.tsx` & `BudgetsPage.test.tsx` -- build `/planning/budgets` page, summary banner, filters, and card grid -- workspace view
- [x] `apps/web/src/routes/budgets.tsx`, `router.tsx`, `AppSidebar.tsx`, `MobileNav.tsx` -- register route and enable navigation links in sidebar and mobile nav -- navigation & routing

**Acceptance Criteria:**
- Given a user on `/planning/budgets`, when budgets exist, then budget cards render with spent, limit, pace status, projected amounts, and progress bars.
- Given a user viewing budgets, when toggling between Shared, Personal, and All views, then cards filter to matching scopes.
- Given an over-budget category, when rendered on the page, then the card shows the warning state and amount over limit without red negative coloring.
- Given a user opening the budget editor for a category with spending history, when category and cadence are selected, then a suggested limit is calculated and prefilled.
- Given a user editing a budget, when changing the limit or toggling rollover and clicking Save, then the budget updates and page re-renders with new values.
- Given a user in AppSidebar or MobileNav, when clicking "Budgets", then it navigates to `/planning/budgets`.

## Implementation Notes

- Added REST endpoints in `apps/server/src/http/app.ts` (`/api/planning/budgets`, `/api/planning/budgets/summary`, `/api/planning/budgets/suggested-limit`, `/api/planning/budgets/:id`, `/api/planning/budgets/:id/summary`).
- Updated `getSuggestedLimitInput` and `getSuggestedLimit` in `@pangolin/app` to allow querying 6-period historical limit suggestions by category / category group + cadence directly during budget creation before an ID exists.
- Updated privacy exemptions in `apps/server/src/privacy/route-manifest.ts` per AD-22.
- Added client methods in `apps/web/src/api.ts` and `useMe()` hook in `session.tsx`.
- Implemented `BudgetCard` with 8px progress track, pace indicator, warning-themed over-budget state, and SVG trend sparkline.
- Implemented `BudgetEditorSheet` with semantic fieldset controls, category/group pickers, prefilled limit suggestions, rollover toggle, and inline in-dialog confirmation for deletion.
- Implemented `BudgetsPage` on `/planning/budgets`, wired into TanStack router and navigation components (`AppSidebar`, `MobileNav`).

## Plan Change Log

## Review Triage Log

| Verdict | Lens | Location | Finding & Action Taken |
|---|---|---|---|
| patch | quick | `packages/app/src/planning/budgets.ts` | Support category/group + cadence in `getSuggestedLimit` so suggestions work during new budget creation. Patched and verified. |
| patch | quick | `apps/web/src/pages/BudgetsPage.tsx` | Do not reference `me.partner` as personal budget owner (AD-22 privacy constraint). Patched. |
| patch | quick | `apps/web/src/components/BudgetEditorSheet.tsx` | Replace browser-native `window.confirm` with in-dialog confirm button. Patched. |
| false | quick | `apps/web/src/components/BudgetCard.tsx` | Card click navigating to `/transactions`: card already has explicit edit button and over-budget link; full row card navigation deferred to drill-down flows. |
| false | quick | `apps/web/src/components/BudgetCard.tsx` | Link to `/review` on over-budget card: Matches UX design mockup (`key-budgets.html`), standard route to review items. |

## Design Notes

- Follows `_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-budgets.html`:
  - 2-column card grid (`grid grid-cols-1 md:grid-cols-2 gap-4`).
  - Progress bar is 8px tall (`h-2 rounded-full bg-border overflow-hidden relative`), with elapsed time tick mark (`absolute top-0 bottom-0 w-0.5 bg-foreground/40`).
  - Mini SVG trend line is 300x64 with limit line (`stroke-dasharray` or muted line), actual polyline, and projected dotted line to period end.
  - Limit suggestion prefill in editor: `You've averaged $X a fortnight / month.`
