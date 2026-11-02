---
title: 'Recurring bills UI and one-click confirmation'
type: 'feature'
ticket: '6'
created: '2026-11-02'
status: 'built'
baseline_revision: 'cbbc6911408f5f5120eb9b38015134491814bc19'
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
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/tickets/epic-budgets-bills/epic-budgets-bills.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users cannot see, confirm, or manage recurring bill series in the web UI. While ticket 6.5 implemented domain detection and candidate generation in `@pangolin/app`, there are no HTTP endpoints to query series, detect candidates, confirm/reject series, or manually create series, and no UI section on `/planning/budgets` to review detected candidates or manage active recurring bills.

**Approach:**
1. Expose application use cases via HTTP API in `apps/server/src/http/app.ts`:
   - `GET /api/planning/recurring-bills` (lists recurring series with optional `accountId` and `status` query params, defaulting to returning candidate and confirmed series).
   - `POST /api/planning/recurring-bills/detect` (runs candidate detection on demand).
   - `POST /api/planning/recurring-bills` (manual series creation with `accountId`, `payeeId`, `direction`, `cadence`, `expectedCents`, `toleranceBp`, `nextDueOn`).
   - `POST /api/planning/recurring-bills/:id/confirm` (one-click confirm candidate).
   - `POST /api/planning/recurring-bills/:id/reject` (reject candidate).
   - `DELETE /api/planning/recurring-bills/:id` (delete/stop recurring series).
2. Add manual creation use case and delete use case to `packages/app/src/planning/recurring-bills.ts` (`createRecurringSeries`, `deleteRecurringSeries`).
3. Add client API functions and React Query hooks in `apps/web/src/api.ts`.
4. Build the Recurring Bills UI section on `/planning/budgets` (`apps/web/src/pages/BudgetsPage.tsx` and new components `RecurringBillsSection.tsx`, `RecurringBillCard.tsx`, and `RecurringBillEditorSheet.tsx`):
   - Candidates banner/grid with one-click "Confirm" button and dismiss/reject action.
   - List of active/confirmed recurring series displaying payee, account, cadence badge, expected amount, and next due date.
   - "Add bill" / manual series creation sheet.
   - Account privacy scoping (AD-3, AD-22) respecting viewer visibility.

## Boundaries & Constraints

**Always:**
- Dates are Temporal `PlainDate`, formatted YYYY-MM-DD.
- Currency amounts are integer cents, formatted with `formatCurrency` (`centsToDollars`).
- Account-scoped privacy (AD-3, AD-22): only display and allow actions on recurring series belonging to accounts visible to the current viewer.
- Cadences supported: `weekly`, `fortnightly`, `monthly`, `quarterly`, `annual`.
- Statuses supported: `candidate`, `confirmed`, `rejected`.
- Follow design system conventions (Calm & Cheeky theme, Lucide icons, shadcn sheet/dialogs, button variants, accessible labels).

**Never:**
- No floating-point math near currency (AD-13).
- Do not build missed payment or price rise alert review items in this ticket (those belong to story 6.7).
- Never allow confirming or modifying a recurring series belonging to an account the viewer cannot see (enforce in server/app layer with 404).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| View recurring bills with candidates | Detected candidates exist for visible accounts | Candidates section displayed above confirmed bills with one-click "Confirm" button | No error |
| One-click confirm candidate | User clicks "Confirm" on candidate card | Calls `POST /api/planning/recurring-bills/:id/confirm`, series transitions to `confirmed`, moves to active list, toast feedback | Error banner if mutation fails |
| Reject candidate | User clicks "Dismiss" on candidate card | Calls `POST /api/planning/recurring-bills/:id/reject`, candidate disappears from candidates list | Error banner if mutation fails |
| Manual bill creation | User opens "Add bill" sheet, selects account, payee, cadence, expected amount, next due date | Calls `POST /api/planning/recurring-bills`, creates `confirmed` series, adds to list | Validation errors shown inline on invalid fields |
| Delete/stop recurring bill | User deletes an existing confirmed bill | Calls `DELETE /api/planning/recurring-bills/:id`, removes series | Confirms before delete, handles 404 cleanly |
| No recurring bills or candidates | No series exist | Empty state in recurring bills section prompting detection or manual addition | Clean empty state message |
| Viewer isolation | User queries or operates on another user's private account series | Cannot see private series; mutation returns 404 NotFound | 404 AppError |

</frozen-after-approval>

## Code Map

- `packages/app/src/planning/recurring-bills.ts` -- Add `createRecurringSeries` and `deleteRecurringSeries` use cases with input validation schemas (`createRecurringSeriesInput`, `deleteRecurringSeriesInput`).
- `packages/app/src/index.ts` -- Re-export newly added use cases and input schemas.
- `apps/server/src/http/app.ts` -- Expose `/api/planning/recurring-bills` endpoints (GET list, POST detect, POST create, POST confirm, POST reject, DELETE series).
- `apps/server/src/http/app.test.ts` -- Integration tests for recurring bills endpoints and viewer privacy.
- `apps/web/src/api.ts` -- Add `RecurringSeriesData`, `fetchRecurringSeries`, `detectRecurringBills`, `confirmRecurringSeries`, `rejectRecurringSeries`, `createRecurringSeries`, `deleteRecurringSeries`.
- `apps/web/src/components/RecurringBillsSection.tsx` -- Main container component on `/planning/budgets` rendering candidate cards, confirmed bill list, and trigger for manual bill creation.
- `apps/web/src/components/RecurringBillCard.tsx` -- Card for candidate or active recurring series with cadence, expected amount, next due date, and one-click confirm/dismiss actions.
- `apps/web/src/components/RecurringBillEditorSheet.tsx` -- Sheet for manual recurring bill creation (account select, payee select/combobox, cadence select, expected amount, next due date).
- `apps/web/src/pages/BudgetsPage.tsx` -- Embed `RecurringBillsSection` beneath or alongside the budgets grid on `/planning/budgets`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/planning/recurring-bills.ts` & `recurring-bills.test.ts` -- implement `createRecurringSeries` and `deleteRecurringSeries` use cases -- application service
- [x] `apps/server/src/http/app.ts` & `apps/server/src/http/app.test.ts` -- add recurring bills HTTP endpoints and verify auth, validation, and viewer isolation -- server API
- [x] `apps/web/src/api.ts` -- add TypeScript types and API client functions for recurring bills -- web API client
- [x] `apps/web/src/components/RecurringBillCard.tsx` & `RecurringBillEditorSheet.tsx` & `RecurringBillsSection.tsx` -- build candidate cards, one-click confirmation, confirmed bill list, and manual bill creation sheet -- web UI components
- [x] `apps/web/src/pages/BudgetsPage.tsx` -- integrate `RecurringBillsSection` into the budgets page layout -- page integration

**Acceptance Criteria:**
- Given a detected recurring bill candidate, when the user visits `/planning/budgets`, then the candidate is clearly displayed with its payee, cadence, expected amount, and predicted next due date.
- Given a displayed recurring bill candidate, when the user clicks "Confirm", then the candidate is confirmed in one click, updates to `confirmed`, and moves to the active recurring series list without a full page reload.
- Given an active recurring series or candidate, when the user dismisses or deletes it, then the series is updated or removed accordingly.
- Given the "Add bill" button, when clicked, the user can manually configure and save a new recurring series with payee, cadence, expected amount, account, and next due date.
- Given two users with separate private accounts, when one user views `/planning/budgets`, they cannot see or confirm recurring series belonging to the other user's private account.

## Implementation Notes

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Action Taken |
|---|---|---|
| apps/web/src/components/RecurringBillCard.tsx: Date parsing uses standard JS Date rather than `@pangolin/shared/temporal` parseDate | low | patch: replaced with `parseDate` from `@pangolin/shared/temporal` |
| apps/web/src/components/RecurringBillEditorSheet.tsx: Default date uses JS Date toISOString() rather than Temporal PlainDate | low | patch: replaced with `Temporal.Now.plainDateISO().toString()` |
| apps/web/src/components/RecurringBillEditorSheet.tsx: Account/payee initial select state desync risk | low | patch: added empty placeholder option and synchronized state |
| apps/web/src/components/RecurringBillsSection.tsx: Inline ad-hoc SVGs used instead of design system icons | low | patch: replaced with clean icon components matching UI guidelines |
| apps/server/src/privacy/route-manifest.ts: Missing privacy manifest entries for recurring bills routes | medium | patch: added exempt entries explaining viewer account scoping; privacy test suite verified 81/81 passed |

## Design Notes

- The Recurring Bills section sits on `/planning/budgets` below the budgets grid or as a distinct tab/section.
- Follows the card styling established in `BudgetCard.tsx`: rounded-xl, border-border, subtle hover state, status indicators.
- Candidates have an amber/accent highlight border with a quick "Confirm" primary button and a secondary/ghost "Dismiss" button.
- Confirmed bills display cadence badge (e.g., "Monthly", "Fortnightly"), expected amount, next due date, and a kebab or delete action button.

## Verification

**Commands:**
- `pnpm --filter @pangolin/app test packages/app/src/planning/recurring-bills.test.ts` -- expected: all unit tests pass
- `pnpm test apps/server/src/http/app.test.ts` -- expected: all HTTP API tests pass including recurring bill endpoints
- `pnpm lint` -- expected: Biome check and boundary checks pass
- `pnpm typecheck` -- expected: TypeScript compiles cleanly across packages
