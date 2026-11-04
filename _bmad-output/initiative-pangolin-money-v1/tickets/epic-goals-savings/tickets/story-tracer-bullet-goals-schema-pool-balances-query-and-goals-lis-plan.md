---
title: 'Tracer bullet: goals schema, pool balances query, and goals list UI'
type: 'feature'
ticket: '1'
created: '2026-11-04'
status: 'built'
baseline_revision: 'e57259fc645120e6bcc46e2e3c6d55977227f886'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/data-model.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 7 introduces virtual goals and savings allocations funded from positive new savings across stages. Currently, there is no database schema or migrations for `goal`, `goal_rule`, `allocation_stage`, `goal_drawdown`, `goal_adjustment`, `goal_allocation`, or `planning_setting`. Furthermore, there is no query to derive savings account balances grouped by pool (`shared` vs personal `personId`), synthetic seed records do not generate or apply goal/stage data, and the web app lacks `/planning/goals` navigation and a basic goals list view.

**Approach:**
1. Create SQLite schema definitions and migration `0028_goals_savings.sql` for `goal`, `goal_rule`, `allocation_stage`, `goal_drawdown`, `goal_adjustment`, `goal_allocation`, and `planning_setting`.
2. Add repository interfaces to `UnitOfWork` (and `MemoryUow`) for `goals`, `stages`, `goalRules`, and `planningSettings`.
3. Implement `getSavingsPoolBalances` in `packages/app/src/planning` to derive total savings-account balances for the shared pool and each person's pool using `balanceAsOf`.
4. Implement goal queries (`listGoals`, `listStages`, `getGoalsSummary`) with privacy scoping (shared goals + viewer's personal goals only, AD-22).
5. Update `tools/seed` and `apps/server/src/admin/seed.ts` to support seeding synthetic goals, allocation stages, and goal rules matching the specification (e.g. Rainy day, House deposit, Japan trip 2027, New couch).
6. Implement HTTP endpoints on the server under `/api/planning/goals` and `/api/planning/goals/summary`, registering them in `route-manifest.ts`.
7. Build the basic Goals workspace page at `/planning/goals` with sidebar/mobile navigation, displaying goals grouped by pool, target amounts, current progress, kind badges (Emergency fund, Protected, Flexible), and stage tags.

## Boundaries & Constraints

**Always:**
- Savings accounts are accounts where `isSavings = true` (or cash accounts flagged as savings, AD-19, AD-26). Brokerage and super are never savings.
- Scoping rules (AD-3, AD-22): shared goals have `person_id = null` and are visible to both partners. Personal goals have `person_id` set to that person's ID and are strictly visible ONLY to that person (never leaked across partners).
- An emergency fund goal is capped at at most one per pool (enforced via partial index or unique constraint `UNIQUE(person_id) WHERE is_emergency_fund = 1` or domain validation).
- Currency amounts are non-negative integer cents (AD-13), percentages in basis points (`share_bp` in 0..10000).
- Dates are Temporal `PlainDate` strings (`YYYY-MM-DD`).
- All new database tables are `STRICT` SQLite tables.

**Never:**
- Do not implement staged allocation math or period close processing yet (Story 7.2).
- Do not implement deficit buffer absorption or reconciliation review item generation yet (Story 7.3).
- Do not implement the interactive Goal editor modal or Cover an expense sheet yet (Stories 7.4, 7.5, 7.6).
- Never leak a partner's private savings balance or private goals to the other partner.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Query goals as Partner A | Household with shared goals + A's personal goals + B's personal goals | Returns shared goals and A's personal goals only; B's goals omitted | Privacy check filters out B's goals |
| Pool balances query | Household with joint savings ($63,080) and A's personal savings ($1,200) | Returns shared pool balance $63,080 and A's pool balance $1,200; does not disclose B's private savings | Only accounts visible to viewer are included |
| Seed goal & stage events | Seed file with Stage 1 (Rainy day emergency fund) and Stage 2 (Build) | Tables populated with correct stage sort, share_bp, kind, target cents | Validation on invalid person ID or negative amounts |
| Duplicate emergency fund in same pool | Inserting second goal in shared pool with `is_emergency_fund = true` | Fails check or raises Conflict error | Unique constraint / Conflict AppError |
| Navigate to `/planning/goals` | Web client clicks Goals in sidebar or mobile nav | Page loads at `/planning/goals` rendering active stage summary, pool badges, and goal cards | 401 if unauthenticated |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/goal.ts` -- Tables: `goal`, `goal_rule`, `allocation_stage`, `goal_drawdown`, `goal_adjustment`, `goal_allocation`, `planning_setting`.
- `packages/db/src/schema/index.ts` -- Re-export all new goal tables.
- `packages/db/migrations/0028_goals_savings.sql` -- Migration adding goal, goal_rule, allocation_stage, goal_drawdown, goal_adjustment, goal_allocation, planning_setting.
- `packages/db/migrations/meta/_journal.json` -- Migration journal update for 0028.
- `packages/db/src/migrate.test.ts` -- Test verifying 0028 migration applies cleanly and inspects columns.
- `packages/app/src/ports/unit-of-work.ts` -- Declare `GoalRow`, `AllocationStageRow`, `GoalRuleRow`, `PlanningSettingRow`, and repo interfaces on `TxRepos` and `ReadRepos`.
- `packages/db/src/repositories/goal.ts` -- Implement repository queries with viewer privacy scoping.
- `packages/db/src/unit-of-work.ts` & `packages/app/src/testing/memory-uow.ts` -- Wire goal repositories into production and memory UoWs.
- `packages/app/src/planning/goals.ts` -- Use cases: `listGoals`, `getSavingsPoolBalances`, `getGoalsSummary`.
- `packages/app/src/index.ts` -- Export new planning goal types and use cases.
- `tools/seed/src/world.ts` & `tools/seed/src/modules/` -- Add seed events for goals, stages, and rules.
- `apps/server/src/admin/seed.ts` -- Ingest goal and stage events during database seed.
- `apps/server/src/http/app.ts` -- Register `/api/planning/goals` and `/api/planning/goals/summary`.
- `apps/server/src/privacy/route-manifest.ts` -- Add privacy declarations for new endpoints.
- `apps/web/src/api.ts` -- Add API query methods for `fetchGoalsSummary` and `fetchGoals`.
- `apps/web/src/routes/goals.tsx` -- Define `/planning/goals` TanStack router route.
- `apps/web/src/pages/GoalsPage.tsx` -- Goals list page rendering summary stage card, pool tags, and goal cards.
- `apps/web/src/components/AppSidebar.tsx` & `apps/web/src/components/MobileNav.tsx` -- Add navigation item for Goals under Planning.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/goal.ts` & `packages/db/src/schema/index.ts` -- create schema definitions for `goal`, `goal_rule`, `allocation_stage`, `goal_drawdown`, `goal_adjustment`, `goal_allocation`, `planning_setting` -- database schema
- [x] `packages/db/migrations/0028_goals_savings.sql` & journal & `migrate.test.ts` -- add and verify migration 0028 -- migration verification
- [x] `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/repositories/goal.ts`, `packages/db/src/unit-of-work.ts`, `packages/app/src/testing/memory-uow.ts` -- declare and implement repository contracts and in-memory test doubles -- persistence layer
- [x] `packages/app/src/planning/goals.ts` & `packages/app/src/planning/goals.test.ts` -- implement `listGoals`, `getSavingsPoolBalances`, and `getGoalsSummary` use cases with tests -- domain and application planning
- [x] `tools/seed/src/world.ts`, `tools/seed/src/modules/goals.ts` (or `budgets-and-bills.ts`), `apps/server/src/admin/seed.ts` -- add seed events and loader handling for goals and stages -- seed generation
- [x] `apps/server/src/http/app.ts`, `apps/server/src/http/app.test.ts`, `apps/server/src/privacy/route-manifest.ts` -- expose HTTP routes and test privacy scoping -- server API
- [x] `apps/web/src/api.ts`, `apps/web/src/routes/goals.tsx`, `apps/web/src/pages/GoalsPage.tsx`, `apps/web/src/pages/GoalsPage.test.tsx` -- implement Goals workspace view with tests -- web UI
- [x] `apps/web/src/components/AppSidebar.tsx`, `apps/web/src/components/MobileNav.tsx`, `apps/web/src/router.tsx` -- add sidebar and mobile navigation links to `/planning/goals` -- navigation

**Acceptance Criteria:**
- Given migration 0028, when run via `pnpm --filter @pangolin/db test`, then all migrations apply cleanly and schema check passes.
- Given a database seeded with test accounts, when `getSavingsPoolBalances` is called for a viewer, then it accurately returns the sum of balances for savings-flagged accounts in the shared pool and the viewer's private pool, without exposing the other partner's private pool balance.
- Given seeded synthetic goal and stage records, when GET `/api/planning/goals/summary` is requested, then it returns the goals list with targets, kinds, emergency fund tags, and active stage details.
- Given a user on `/planning/goals`, when the page renders, then it displays the active stage banner, target amounts, and goal cards with pool badges.

## Implementation Notes

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Action Taken |
|---|---|---|
| Partner personal savings pool leak in `getSavingsPoolBalances` and `GoalsPage.tsx` | True (high) | Patched: `getSavingsPoolBalances` filters out any personal pool not belonging to the viewer; `GoalsPage.tsx` removed rendering of partner personal pools. |
| Missing `asOf` in `SavingsPoolBalancesResult` and `poolBalances` naming mismatch with `api.ts` | True (medium) | Patched: Added `asOf` string to `SavingsPoolBalancesResult` and exported `pools` in `GoalsSummaryResult`. |
| Field naming and unit mismatch (`fallbackThresholdBp`, `shareBp`) between backend and web | True (medium) | Patched: Updated `api.ts` and `GoalsPage.tsx` to read `fallbackThresholdBp` and format `shareBp` as percentage. |
| Incompatible `GoalData.pool` type preventing Personal filter tab in `GoalsPage` | True (medium) | Patched: Updated `GoalData.pool` to `"shared" \| string` and aligned scope filter. |
| Routes `/api/planning/goals` and `/api/planning/goals/summary` unverified in replay harness | True (low) | Patched: Registered routes under `person` read manifest in `route-manifest.ts` and verified with full privacy replay test suite. |
| Direct mutation methods in repositories without dedicated use cases | False | By design for tracer bullet (Story 7.1 establishes schema and read UI; mutations are exercised via seed loader and future stories). |
| Partial unique index expression difference in memory-uow vs sqlite | False | SQLite handles `coalesce(person_id, '__shared__') WHERE is_emergency_fund = 1` natively and memory-uow checks `g.isEmergencyFund && g.personId === row.personId`. Verified with `goal.test.ts`. |

## Design Notes

Key table schemas:
- `goal`: `id` (text PK), `person_id` (text FK nullable), `name` (text), `target_cents` (integer > 0), `target_date` (text nullable), `priority` (integer default 0), `kind` (text: 'flexible' | 'protected'), `is_emergency_fund` (integer boolean), `completed_at` (text nullable), `created_at`, `updated_at`.
- `goal_rule`: `id` (text PK), `goal_id` (text FK), `stage_id` (text FK), `share_bp` (integer 0..10000), `effective_from` (text), `effective_until` (text nullable), `source` (text: 'rule' | 'shortfall_override'), `created_at`, `updated_at`.
- `allocation_stage`: `id` (text PK), `person_id` (text FK nullable), `name` (text), `sort` (integer), `exit_goal_id` (text FK nullable), `fallback_threshold_bp` (integer default 8000), `completed_share_policy` (text: 'rescale' | 'buffer'), `created_at`, `updated_at`.
- `goal_drawdown`: `id` (text PK), `person_id` (text FK nullable), `reason` (text: 'large_purchase' | 'shortfall'), `label` (text), `amount_cents` (integer > 0), `transaction_id` (text FK nullable), `created_by` (text FK), `created_at`, `undone_at` (text nullable).
- `goal_adjustment`: `id` (text PK), `drawdown_id` (text FK), `goal_id` (text FK), `amount_cents` (integer > 0).
- `goal_allocation`: `id` (text PK), `goal_id` (text FK), `period_start` (text), `allocated_cents` (integer), `created_at`.
- `planning_setting`: `id` (text PK), `person_id` (text FK nullable), `large_withdrawal_threshold_cents` (integer default 200000), `created_at`, `updated_at`.

## Verification

**Commands:**
- `pnpm --filter @pangolin/db test` -- expected: migration and schema tests pass
- `pnpm --filter @pangolin/app test` -- expected: planning goals and pool balance tests pass
- `pnpm --filter @pangolin/server test` -- expected: server HTTP and privacy tests pass
- `pnpm --filter tools/seed test` -- expected: seed generation tests pass
- `pnpm --filter @pangolin/web test` -- expected: web router and GoalsPage tests pass
- `pnpm test` -- expected: workspace tests pass
- `pnpm lint` -- expected: biome check passes
