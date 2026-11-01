---
title: 'Recurring bills detector and candidate generation'
type: 'feature'
ticket: '5'
created: '2026-11-02'
status: 'built'
baseline_revision: '1616b9f9d8179e8d2ded39b0ba93747271c00d52'
route: 'full'
route_source: 'auto'
risk: 'high'
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

**Problem:** Users have recurring bills (utilities, subscriptions, insurance, rent) that occur on regular intervals (weekly, fortnightly, monthly, quarterly, annual). Currently, there is no `recurring_series` table or schema, no domain interval/amount stability detector to identify recurring bill candidates from transaction history, no prediction for next due dates and amounts, and no mechanism preventing salary deposits from being misclassified as bill candidates (AD-25).

**Approach:** 
1. Create `recurring_series` table schema and migration 0027 supporting account-scoped recurring bill series with direction, cadence, expected amounts, tolerances, and status (`candidate` | `confirmed` | `rejected`).
2. Implement pure domain recurring series detection in `@pangolin/domain` (`detectRecurringSeries`) that groups transaction occurrences by payee, evaluates intervals (weekly ~7d, fortnightly ~14d, monthly ~30-31d/same day of month, quarterly ~90-92d, annual ~365d) requiring $\ge 3$ occurrences, median interval stability within tolerance ($\pm 3$ days), amount variation within tolerance ($\le 15\%$), and calculates predicted next due date and expected amount.
3. Add `recurring_series` persistence repository and UnitOfWork support in `packages/db` and `memory-uow.ts`.
4. Implement application use cases in `packages/app/src/planning/recurring-bills.ts` to scan transaction history across visible accounts, exclude salary deposits (pay anchor accounts matching salary payees/descriptions per AD-25) and transfers (`transferGroupId IS NOT NULL`), generate candidate series, and provide query use cases for candidates and series.

## Boundaries & Constraints

**Always:**
- Dates are Temporal `PlainDate`, imported only from `shared/temporal`.
- Cents math uses integer cents and half-even rounding (`toCents`, `cents`).
- Account-scoped privacy (AD-3, AD-22): `recurring_series` carries `account_id` and is visible only to users who can see that account (`visibleAccounts`). If a payee has occurrences across multiple accounts, series are scoped per account.
- Exclude salary deposits: any series or transaction associated with salary deposits (matching pay anchor deposit accounts with expected net pay or salary/payroll keywords, or payees bound to pay anchors) must never become a recurring bill candidate (AD-25).
- Exclude internal transfers: transactions with `transferGroupId !== null` are never bill candidates.
- Require $\ge 3$ occurrences with stable intervals before proposing a candidate.

**Never:**
- No floating-point math near currency (AD-13).
- Never read system clock outside tests; take injected `Clock` in household timezone (AD-14).
- Do not build UI screens or alerts for missed payments in this ticket (those belong to stories 6.6 and 6.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stable monthly subscription | 3 monthly Netflix transactions ($19.99 on 15 Jan, 15 Feb, 15 Mar) | Detects monthly bill candidate, `expectedCents: 1999`, `nextDueOn: 2026-04-15` | No error |
| Stable fortnightly bill | 4 fortnightly gym transactions ($45 every 14 days) | Detects fortnightly bill candidate, `cadence: 'fortnightly'`, `expectedCents: 4500` | No error |
| Irregular interval (< 3 occurrences) | Only 2 transactions for a payee | Not detected as candidate (requires $\ge 3$ occurrences) | Cleanly ignored |
| High amount variance | 3 transactions: $50, $250, $900 on monthly dates | Variance exceeds tolerance (>15%); not detected as recurring bill | Cleanly ignored |
| Salary deposit exclusion | 4 fortnightly incoming salary transactions matching pay anchor | Excluded by salary check; not proposed as recurring series (AD-25) | Excluded cleanly |
| Account privacy boundary | Partner A queries recurring bills on Partner B's private account | Returns only series for accounts visible to Partner A | Scoped query |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/recurring-series.ts` -- New schema for `recurring_series` table (id, accountId, payeeId, direction, cadence, expectedCents, toleranceBp, nextDueOn, status, createdAt, updatedAt).
- `packages/db/src/schema/index.ts` -- Export `recurringSeries`.
- `packages/db/migrations/0027_recurring_series.sql` -- Migration 0027 adding `recurring_series` table and indexes.
- `packages/db/migrations/meta/_journal.json` -- Add migration 0027 entry.
- `packages/domain/src/planning/recurring-detector.ts` -- Pure domain detection algorithms: interval clustering, median interval calculation, cadence classification (weekly, fortnightly, monthly, quarterly, annual), amount tolerance checks, and next due date prediction.
- `packages/domain/src/index.ts` -- Export detector types and functions.
- `packages/db/src/repositories/recurring-series.ts` -- Database repository for `recurring_series` with viewer scoping.
- `packages/db/src/unit-of-work.ts` -- Expose `recurringSeries` on `UnitOfWork` and `TxRepos`/`ReadRepos`.
- `packages/app/src/ports/unit-of-work.ts` -- Type definitions for `RecurringSeriesRow` and repository port.
- `packages/app/src/testing/memory-uow.ts` -- In-memory implementation of `recurringSeries` repository.
- `packages/app/src/planning/recurring-bills.ts` -- Application use cases: `detectRecurringBillCandidates`, `listRecurringSeries`, `listCandidateSeries`, and salary deposit exclusion logic (AD-25).
- `packages/app/src/accounts/leave-household.ts` -- Ensure recurring series on private accounts or scoped data are cleaned up appropriately on household departure.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db/src/schema/recurring-series.ts` & `packages/db/src/schema/index.ts` -- define `recurring_series` table schema and checks -- database schema
- [ ] `packages/db/migrations/0027_recurring_series.sql` & journal -- create and verify migration 0027 -- database migration
- [ ] `packages/domain/src/planning/recurring-detector.ts` & `recurring-detector.test.ts` -- implement pure interval and amount pattern detection -- domain logic
- [ ] `packages/db/src/repositories/recurring-series.ts` & `unit-of-work.ts` -- implement persistence repository and wire into UoW -- persistence layer
- [ ] `packages/app/src/ports/unit-of-work.ts` & `packages/app/src/testing/memory-uow.ts` -- wire ports and in-memory repository -- application ports
- [ ] `packages/app/src/planning/recurring-bills.ts` & `recurring-bills.test.ts` -- implement recurring bill detection use case with salary exclusion and due date prediction -- application service
- [ ] `packages/app/src/accounts/leave-household.ts` -- handle recurring series deletion when account is removed or person leaves -- household lifecycle

**Acceptance Criteria:**
- Given a series of $\ge 3$ synthetic transactions for a payee with stable intervals (e.g. monthly $\pm 3$ days) and amounts within tolerance, when the detector runs, then it identifies a recurring bill candidate with the correct cadence, expected amount, and next due date.
- Given a series of transactions representing salary income matching a configured pay anchor, when the detector runs, then salary deposits are excluded and no bill candidate is generated (AD-25).
- Given transactions with fewer than 3 occurrences or erratic intervals/amounts, when the detector runs, then no candidate is generated.
- Given recurring series across accounts, when Partner A queries recurring bills, then only series belonging to accounts visible to Partner A are returned.

## Implementation Notes

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Action Taken |
|---|---|---|
| Temporal import from global rather than `@pangolin/shared/temporal` | True | Patched import to `import { type PlainDate, Temporal } from "@pangolin/shared/temporal";`. |
| Median calculation on even-count array without half-even rounding | True | Patched `calculateMedian` to apply banker's half-even rounding on integer values. |
| Missing test for AD-3 missing viewer throwing in recurring series repository | True | Added unit test in `recurring-series.test.ts` proving `findById` and `listVisible` throw `TypeError` when viewer is undefined. |
| `as any` cast in `leave-household.ts` | True | Fixed parameter typing to `Id<"Account">` and removed unsafe cast. |
| Monthly billing interval shift across February or weekend roll | False / Refuted | `classifyCadence` accepts monthly ranges 27-32 days, and interval stability is measured against the calculated median with $+/- 3$ day tolerance, which matches the standard interval design spec. |
| Salary detection payee binding | False / Refuted | Pay anchors in Pangolin are deposit-account and person-bound (they do not hold a `payeeId` column); salary check matches account ID, net amount within 10% tolerance, and explicit salary/payroll keywords, exactly mirroring `detectPayDeposits`. |

## Design Notes

Cadence classification rules (in days between consecutive occurrences):
- **Weekly**: Median interval 6–8 days (~7 days).
- **Fortnightly**: Median interval 13–15 days (~14 days).
- **Monthly**: Median interval 27–32 days (~30-31 days).
- **Quarterly**: Median interval 85–95 days (~91 days).
- **Annual**: Median interval 350–375 days (~365 days).

Stability criteria:
- At least 3 occurrences ($\ge 2$ intervals).
- Interval stability: all intervals within $\pm 3$ days of the median (or $\pm 5$ days for quarterly/annual).
- Amount stability: relative standard deviation or difference from median amount $\le 15\%$.

Next due date prediction:
- From the latest occurrence date, add the cadence interval (for monthly/annual, advance by months/years preserving day of month where possible).

## Verification

**Commands:**
- `pnpm --filter @pangolin/domain test` -- verify pure recurring detector domain tests pass
- `pnpm --filter @pangolin/db test` -- verify migration 0027, schema, and repo tests pass
- `pnpm --filter @pangolin/app test` -- verify recurring bills use cases and tests pass
