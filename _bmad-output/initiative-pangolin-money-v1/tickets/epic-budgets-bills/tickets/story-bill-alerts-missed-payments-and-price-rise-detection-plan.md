---
title: 'Bill alerts: missed payments and price rise detection'
type: 'feature'
ticket: '7'
created: '2026-11-02'
status: done
baseline_revision: '37ebd9e78117e440b76ddc981234382498a40884'
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
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/tickets/epic-budgets-bills/tickets/story-recurring-bills-ui-and-one-click-confirmation-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users have confirmed recurring bill series, but receive no automated notifications when expected payments are missed past their due window or when bill charges increase significantly (>10% price rise). Without proactive review alerts, unexpected price increases and missed bills go unnoticed until bank balances drop or services are disrupted.

**Approach:**
1. Define pure domain evaluation logic in `@pangolin/domain` (`packages/domain/src/planning/bill-alerts.ts`):
   - Grace period / due window calculation per cadence (weekly: 3 days, fortnightly: 5 days, monthly/quarterly/annual: 7 days).
   - Evaluation of missed payments: for a confirmed series whose `nextDueOn + graceDays < today`, if no matching transaction occurred in the interval `[nextDueOn - graceDays, today]`, generate a missed payment alert.
   - Evaluation of price rises: when a matching payment transaction in the window has `amountCents > expectedCents * 1.10` (more than 10% increase), generate a price rise alert.
2. Register review kinds in `@pangolin/app`:
   - `planning.bill_alert.missed_payment` (scope: `account`).
   - `planning.bill_alert.price_rise` (scope: `account`).
3. Implement `syncBillAlertReviewItems` use case in `@pangolin/app`:
   - Scoped to account privacy (AD-3, AD-22).
   - Deterministic dedupe keys: `bill:missed:<seriesId>:<expectedDate>` and `bill:price_rise:<seriesId>:<transactionId>`.
   - Entity references: `recurring_series:<seriesId>` or `transaction:<transactionId>`.
   - Auto-resolve when paid (for missed payment: resolving when a matching payment is detected) or when dismissed by user.
4. Expose dismiss / acknowledge actions in `@pangolin/app` and HTTP endpoints:
   - `POST /api/review/:id/dismiss-bill-alert` (resolving item with "acknowledged").
5. Extend `ReviewDetail` in `@pangolin/app` `review-view.ts`:
   - Add `{ type: "bill_alert"; seriesId: string; payeeName: string; accountName: string; cadence: string; expectedCents: number; actualCents?: number; increasePct?: number; dueDate: string; kind: "missed" | "price_rise"; transactionId?: string }`.
6. Embed evaluation in the daily evaluation runner / background schedule alongside `budget-evaluation` and on transaction import / sync.
7. Build web UI components in `apps/web/src/components/review/`:
   - `BillAlertCard.tsx` rendering warning tone, summary, details, and actions ("Got it" / "View transactions" / "Open bill").
   - Register in `ReviewCardView.tsx` and `ReviewCardFrame.tsx`.

## Boundaries & Constraints

**Always:**
- Dates are Temporal `PlainDate`, formatted YYYY-MM-DD.
- Currency amounts are integer cents (AD-13), formatted using `formatCurrency` or `formatCents`. No floats for currency calculations.
- Account-scoped privacy (AD-3, AD-22): bill alert review items have `account` scope (`scope: "account"`), ensuring only users with visibility of that account can view or dismiss them.
- Idempotent alert generation using deterministic dedupe keys.
- Follow Calm & Cheeky design system rules: use warning color tokens (`var(--warning)`, `var(--warning-bg)`), no mascots on warning cards.

**Never:**
- Never create duplicate alerts for the same series occurrence / transaction.
- Never show salary transactions or non-bill transactions in recurring bill alerts.
- Never permit users without account access to query, view, or dismiss that account's bill alerts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bill payment missed past due window | Confirmed series `nextDueOn` was 2026-04-10 (monthly), today is 2026-04-18 (> 7 days grace), no transaction found | Raises `planning.bill_alert.missed_payment` review item with dedupe `bill:missed:<id>:2026-04-10` | Idempotent on rerun |
| Bill paid on time | Confirmed series `nextDueOn` was 2026-04-10, payment transaction occurs on 2026-04-11 for expected amount | No missed payment alert; if a missed alert was previously open, auto-resolves with "paid" | Handled cleanly |
| Price rise > 10% detected | Confirmed bill expected amount $100 ($10,000 cents), payment occurs for $114 ($11,400 cents, +14%) | Raises `planning.bill_alert.price_rise` review item with dedupe `bill:price_rise:<id>:<txnId>` | Idempotent |
| Price change <= 10% (normal variation) | Confirmed bill expected $100, payment occurs for $108 (+8%) | Within tolerance; no price rise alert raised | No-op |
| User clicks "Got it" on bill alert | User reviews bill alert card in review inbox | Calls `POST /api/review/:id/dismiss-bill-alert`, item resolved with "acknowledged", card dismissed | 404 if item not found or unauthorized |
| Viewer isolation | User attempts to view or dismiss bill alert for private account of partner | Excluded from review cards query; mutation returns 404 NotFound | 404 AppError |

</frozen-after-approval>

## Code Map

- `packages/domain/src/planning/bill-alerts.ts` -- Domain logic for missed payment due window calculation and price rise percentage check (>10%).
- `packages/domain/src/planning/bill-alerts.test.ts` -- Unit tests for grace period evaluation and price rise threshold checks.
- `packages/domain/src/index.ts` -- Re-export domain alert helpers.
- `packages/app/src/planning/bill-alerts.ts` -- Application use cases: `evaluateBillAlerts`, `syncBillAlertReviewItems`, `dismissBillAlertReviewItem`, define review kinds (`planning.bill_alert.missed_payment`, `planning.bill_alert.price_rise`).
- `packages/app/src/planning/bill-alerts.test.ts` -- Integration tests for alert generation, auto-resolution on payment, idempotency, and viewer scoping.
- `packages/app/src/system/review-view.ts` -- Map `planning.bill_alert.*` review items into `ReviewDetail` (`type: "bill_alert"`).
- `packages/app/src/index.ts` -- Re-export bill alert use cases and review kinds.
- `apps/server/src/jobs/budget-evaluation.ts` or `apps/server/src/jobs/bill-alerts.ts` -- Run bill alert evaluation during scheduled job runs.
- `apps/server/src/http/app.ts` -- Expose `/api/review/:id/dismiss-bill-alert` endpoint.
- `apps/server/src/privacy/route-manifest.ts` -- Register privacy manifest entry for dismiss-bill-alert route.
- `apps/server/src/http/app.test.ts` -- API integration tests for dismiss-bill-alert and privacy checks.
- `apps/web/src/api.ts` -- Add `dismissBillAlert` mutation client function and `ReviewDetail` type variant.
- `apps/web/src/components/review/BillAlertCard.tsx` -- Review card component for missed bill and price rise alerts with "Got it" action.
- `apps/web/src/components/review/BillAlertCard.test.tsx` -- Component tests for `BillAlertCard`.
- `apps/web/src/components/review/ReviewCardView.tsx` & `ReviewCardFrame.tsx` -- Register `BillAlertCard` in the review card dispatcher.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/planning/bill-alerts.ts` & `bill-alerts.test.ts` -- implement grace window and price rise detection logic in domain -- domain algorithms
- [x] `packages/app/src/planning/bill-alerts.ts` & `bill-alerts.test.ts` -- implement review item generation, auto-resolution on payment, dismiss action, and review kinds -- application use cases
- [x] `packages/app/src/system/review-view.ts` -- map bill alert review items to `ReviewDetail` card data -- review detail mapper
- [x] `apps/server/src/jobs/budget-evaluation.ts` & `apps/server/src/http/app.ts` & `apps/server/src/privacy/route-manifest.ts` & `apps/server/src/http/app.test.ts` -- HTTP endpoint for dismissing bill alerts and scheduled job hook -- server API & jobs
- [x] `apps/web/src/api.ts` & `apps/web/src/components/review/BillAlertCard.tsx` & `ReviewCardView.tsx` -- review card UI component, actions, and tests -- web review card UI

**Acceptance Criteria:**
- Given a confirmed recurring bill series whose expected due date has passed the due window without a matching payment, when bill alert evaluation runs, then a `planning.bill_alert.missed_payment` review item is raised in the Needs Review inbox.
- Given an open missed payment alert, when a matching payment transaction subsequently appears or is imported, then the missed payment alert is automatically resolved.
- Given a confirmed recurring bill series, when a matching payment transaction occurs with an amount greater than 110% of expected amount, then a `planning.bill_alert.price_rise` review item is raised showing the previous and new amounts.
- Given an open bill alert in Needs Review, when the user clicks "Got it", then the alert is dismissed and resolved with "acknowledged".
- Given two users with separate private accounts, when evaluating or viewing bill alerts, users cannot see or interact with bill alerts from another user's private account.

## Implementation Notes

- Grace period defaults: weekly = 3 days, fortnightly = 5 days, monthly = 7 days, quarterly = 7 days, annual = 7 days.
- Price rise threshold: `(actualCents - expectedCents) / expectedCents > 0.10` (i.e. `actualCents > expectedCents * 1.10`).
- Scoping: `scope: "account"` matches the account of the recurring bill series, so private account bills are strictly scoped to the owner while shared account bills are visible to both household members.

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Action Taken |
|---|---|---|
| ReviewDetail missing `payeeId` on bill alert details | medium | patch: added `payeeId: series.payeeId` to `ReviewDetail` (`bill_alert`) and mapped in `review-view.ts` |
| `BillAlertCard.tsx` links transactions with `payeeName` instead of `payeeId` | medium | patch: updated `search={{ payee: detail.payeeId }}` to filter by payee ID cleanly |
| Missed bill notification copy used raw cadence (e.g. `this monthly`) | low | patch: mapped cadence to natural period noun (`this month`, `this week`, `this quarter`) |

## Design Notes

- Bill alerts follow the UX specification in `EXPERIENCE.md`:
  - Missed payment: "Netflix didn't turn up this month" / "[Payee] payment of [expected] expected by [dueDate] was not found."
  - Price rise: "[Payee] is up 14% ($[actual] vs $[expected])"
- Actions: "Got it" (dismisses), "View transactions" (navigates to `/ledger` with payee filter), "Open bill" (navigates to `/planning/budgets`).
- Styling: Calm & Cheeky warning bar style consistent with `OverBudgetCard.tsx`, using warning tokens and no mascot illustrations.

## Verification

**Commands:**
- `pnpm --filter @pangolin/domain test packages/domain/src/planning/bill-alerts.test.ts` -- expected: domain tests pass
- `pnpm --filter @pangolin/app test packages/app/src/planning/bill-alerts.test.ts` -- expected: app use case tests pass
- `pnpm test apps/server/src/http/app.test.ts` -- expected: server HTTP and review endpoints pass
- `pnpm --filter @pangolin/web test apps/web/src/components/review/BillAlertCard.test.tsx` -- expected: web card tests pass
- `pnpm lint` -- expected: lint checks pass
- `pnpm typecheck` -- expected: TypeScript compilation passes
