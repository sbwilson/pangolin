---
title: 'Tracer bullet: PayAnchor, PayCalendar resolution, and Household Settings'
type: 'feature'
ticket: '1'
created: '2026-11-01'
status: 'built'
baseline_revision: '169f48f394b67d6bbb4c1a3e0a452bba1cc471aa'
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
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Budgets, bills, and forecasting require knowledge of pay cadence, paydays, and salary income (AD-14, AD-25). Currently, no `pay_anchor` table or migration exists, `shared/period` lacks `PayCalendar` resolution and payday business-day roll-back, pay deposits are not detected, and Settings › Household does not expose pay cycle or household pay anchor controls.

**Approach:** 
1. Create `pay_anchor` table, migration 0025, and add `household_pay_anchor_person_id` (or household pay anchor cadence/day setting) to `household_settings` and `pay_anchor` repo/ports under `planning`.
2. Implement pure business-day roll-back and `PayCalendar` types/resolution in `@pangolin/shared/period`.
3. Implement `detectPayDeposits` and `resolvePayCalendar` in `packages/app/src/planning` supporting both `calendar` and `deposit` alignment with weekend roll-back.
4. Add planning use cases and server HTTP routes for reading/updating pay anchors and household pay settings.
5. Extend the Settings › Household UI with personal pay cadence/anchor controls and household pay anchor selection.

## Boundaries & Constraints

**Always:**
- Dates are Temporal `PlainDate`, imported only from `shared/temporal`. Periods are half-open `[start, end)`.
- `domain` and `shared` never read the system clock outside tests. `app` takes an injected `Clock` in the household timezone.
- Future periods always use the calendar rule, with expected paydays rolled back to the previous business day (weekends only in v1 per AD-14 / ARCHITECTURE-SPINE.md deferred table: Australian public holidays are deferred).
- Each person's `pay_anchor` carries `person_id` and is scoped per AD-22 (a partner cannot see the other partner's `pay_anchor` directly).
- The household pay anchor is an explicit setting (suggested at setup as whichever payday comes first), never derived from private deposits (AD-22).
- When `alignment === 'deposit'`, boundaries follow detected salary/pay deposits in the anchor's deposit account; if no qualifying deposit is found or for periods beyond the latest deposit, fall back cleanly to the `calendar` rule.
- Salary deposits are identified by deposit account + positive income amounts matching expected net pay within tolerance or recurring pay payee, and are never counted as recurring bill series (AD-25).

**Never:**
- No public holiday calendars in v1.
- No budget calculations, pace/projected math, or recurring series detection (those belong to stories 6.2, 6.3, 6.5).
- Do not bypass `visibleAccounts` or leak private deposit details across partners.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Calendar alignment (fortnightly) | Fortnightly anchor Saturday 2026-10-10, rolling back | Expected payday rolls back to Friday 2026-10-09; period start remains 14-day cycle | No error |
| Calendar alignment (monthly) | Monthly day 31 in April (30 days) | Clamped to 30 April; if Sunday 30th, rolls back to Friday 28th for payday | No error |
| Deposit alignment with deposit | `deposit` alignment, actual deposit posted Thursday instead of Friday | Period boundary aligns to Thursday deposit date | Fall back to calendar if no deposit |
| Deposit alignment without deposits | `deposit` alignment, brand new account with 0 deposits | Cleanly falls back to `calendar` alignment without throwing | No error |
| Cross-partner privacy | Partner A queries Partner B's `pay_anchor` | Partner A cannot see Partner B's private pay anchor (returns 404 or empty scoped list) | Scoped read violation / NotFound |
| Update household anchor | Admin/User selects Person A as household anchor in Settings | `household_settings` persists setting; shared calendar adopts Person A's cadence | Validation on invalid person ID |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/pay-anchor.ts` -- New schema for `pay_anchor` table (id, personId, accountId, cadence, dayOfMonth, anchorDate, alignment, expectedNetCents, expectedGrossCents, createdAt, updatedAt).
- `packages/db/src/schema/household-settings.ts` -- Add household pay anchor configuration to `householdSettings`.
- `packages/db/migrations/0025_pay_anchor.sql` -- Migration adding `pay_anchor` table and altering `household_settings`.
- `packages/db/src/unit-of-work.ts` -- Add `payAnchor` repository to unit of work and memory uow.
- `packages/shared/src/period/index.ts` -- Add `PayCalendar`, business-day roll-back (`rollBackToBusinessDay`), and calendar-based pay period generators.
- `packages/app/src/planning/pay-calendar.ts` -- Resolution of `PayCalendar` with deposit detection and calendar fallbacks.
- `packages/app/src/planning/pay-anchor.ts` -- Use cases for getting and updating personal pay anchors and household pay anchor.
- `apps/server/src/http/app.ts` -- Expose `/api/planning/pay-anchors` and update `/api/system/household` for pay anchor settings.
- `apps/server/src/privacy/route-manifest.ts` -- Register new planning routes.
- `apps/web/src/api.ts` -- Add API clients for pay anchor and household settings.
- `apps/web/src/components/HouseholdSettings.tsx` -- Add UI for pay cadence, personal anchor, and household pay anchor selector.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/pay-anchor.ts` & `packages/db/src/schema/household-settings.ts` -- create `pay_anchor` table and update `householdSettings` schema -- schema definitions
- [x] `packages/db/migrations/0025_pay_anchor.sql` & snapshots -- generate and verify migration 0025 -- database migration
- [x] `packages/db/src/unit-of-work.ts` & `packages/app/src/testing/memory-uow.ts` -- add `payAnchor` repo and memory UoW support -- persistence layer
- [x] `packages/shared/src/period/index.ts` -- implement `rollBackToBusinessDay` and `PayCalendar` resolution primitives -- pure domain/shared period logic
- [x] `packages/app/src/planning/` -- implement `detectPayDeposits`, `resolvePayCalendar`, and pay anchor use cases with `Clock` support -- application planning service
- [x] `apps/server/src/http/` & `apps/server/src/privacy/` -- wire API endpoints, update route manifest, and verify route privacy -- API routes
- [x] `apps/web/src/components/HouseholdSettings.tsx` & `HouseholdSettings.test.tsx` -- add pay cadence, personal anchor, and household pay anchor controls -- web settings UI
- [x] `packages/app/src/planning/pay-calendar.test.ts` & component tests -- unit and integration tests verifying deposit detection, calendar fallbacks, and settings updates -- verification

**Acceptance Criteria:**
- Given a personal pay anchor with `deposit` alignment and detected pay deposits in the linked account, when `resolvePayCalendar` is called, then period boundaries reflect actual deposit dates.
- Given a pay anchor with no matching deposits or a date in the future, when `resolvePayCalendar` is called, then it falls back to the calendar rule with weekend business-day roll-back.
- Given the Settings › Household card, when a user views it, they can view and update their pay cadence, deposit account, and the household pay anchor.
- Given Partner A, when reading pay anchors, they only receive their own `pay_anchor` data (AD-22).

## Implementation Notes

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Action Taken |
|---|---|---|
| Missing UNIQUE constraint on `pay_anchor.person_id` | True | Added `.unique()` to `pay_anchor.personId` and `UNIQUE` in migration `0025_pay_anchor.sql`. |
| Keywords matching loose "pay" in descriptions | True | Tightened keyword regex in `detect-pay-deposits.ts` to full words `salary`, `payroll`, `wages`, and qualified direct credit phrases to avoid false positives. |
| Floating point in HouseholdSettings | False | `parseCents` from `lib/money.ts` was already used to parse integer cents without floats. |
| 1000 row page limit in deposit detection | Low / Acceptable | 1000 incoming transactions is generous for pay deposit history in single accounts. Future pagination can be considered if needed. |
| Deposit alignment expectedPayDate vs calendar | False | By definition of deposit alignment (AD-14), deposit-aligned periods reflect actual detected pay deposit boundaries. |
| `periodsBetween` initial cycle range | False | Half-open period containment follows the period interval contract. |

## Design Notes

`PayCalendar` resolution interface:
```typescript
export interface PayPeriod {
  readonly start: PlainDate;
  readonly end: PlainDate;
  readonly expectedPayDate: PlainDate;
  readonly actualPayDate: PlainDate | null;
  readonly isProjected: boolean;
}

export interface PayCalendar {
  readonly anchorId: string;
  readonly cadence: Cadence;
  readonly alignment: "calendar" | "deposit";
  readonly periodContaining: (date: PlainDate) => PayPeriod;
  readonly periodsBetween: (from: PlainDate, to: PlainDate) => readonly PayPeriod[];
}
```

Weekend roll-back logic:
If date dayOfWeek is Saturday (6), roll back 1 day to Friday. If Sunday (7), roll back 2 days to Friday. Monday through Friday remain unchanged.

## Verification

**Commands:**
- `pnpm --filter @pangolin/shared test` -- expected: all shared tests pass
- `pnpm --filter @pangolin/db test` -- expected: all db and migration tests pass
- `pnpm --filter @pangolin/app test` -- expected: planning and pay calendar tests pass
- `pnpm --filter @pangolin/server test` -- expected: server HTTP and privacy tests pass
- `pnpm --filter @pangolin/web test` -- expected: web and HouseholdSettings tests pass
