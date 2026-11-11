---
title: 'Staged allocation engine: rules, stages, exit goals, and fallback'
type: 'feature'
ticket: '2'
created: '2026-11-05'
status: done
baseline_revision: '1a4cc4d516f323e757bc4fe73907515ebe25a7ee'
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

**Problem:** Story 7.1 established the database schema and basic read UI for goals and stages, but Pangolin cannot compute or allocate new savings across stages. There is no domain engine to resolve the active stage per pool, handle stage transitions when exit goals reach their target, rescale shares when intermediate goals complete, fall back to Stage 1 when an emergency fund balance drops below its threshold, record persistent `goal_allocation` rows, or audit stage events. Furthermore, domain validation must strictly reject duplicate emergency funds per pool on write.

**Approach:**
1. Implement repositories for `goalAllocation` on `TxRepos` and `ReadRepos` across `packages/db` and `packages/app` (`MemoryUow`), supporting insertion, query by period and goal, and summing allocations per goal.
2. Build domain calculators in `packages/app/src/planning/goal-allocation.ts`:
   - Calculate cumulative goal balance = sum of `goal_allocation` rows minus adjustments from confirmed drawdowns.
   - Determine active stage for a pool: evaluate stages in `sort` order. If the pool's emergency fund drops below `fallbackThresholdBp` (default 80% / 8000 bp) of its `targetCents`, immediately fall back to Stage 1 (or lowest sort stage). Otherwise, advance past stages whose `exitGoalId` is fully funded (`currentBalance >= targetCents`).
   - Stage progression & transition: when an exit goal reaches its target within an allocation period, the exit goal takes only what it still needs; the remaining period savings are allocated using the next stage's shares.
   - Rescaling on goal completion: when any goal within an active stage is completed (`currentBalance >= targetCents`), its `shareBp` is rescaled proportionally across the stage's remaining uncompleted goals (or diverted to buffer if `completedSharePolicy === "buffer"`).
   - Generate `goal_allocation` rows for positive new savings, leaving any unallocated remainder as buffer.
   - Log stage transitions and reactivations through `audit_log` (`action: "stage-change"`).
3. Enforce the domain rule: rejecting creation or update of a second emergency fund in the same pool with a domain conflict `AppError` before database insertion.
4. Expose use cases `executeSavingsAllocation` and `getGoalAllocationHistory`, updating `getGoalsSummary` to return real active stages and current balances.

## Boundaries & Constraints

**Always:**
- Savings allocations only distribute positive new savings (`savingsCents > 0`). Zero or negative savings produce zero allocations.
- Goal amounts and allocations are non-negative integer cents (AD-13). Basis points are in `0..10000`.
- Privacy & Scoping (AD-3, AD-22): shared pool goals (`personId === null`) and rules are evaluated independently of personal pool goals (`personId !== null`). An actor only triggers or inspects allocations for pools visible to their viewer context.
- Fallback threshold: if the pool's emergency fund balance < `(targetCents * fallbackThresholdBp) / 10000`, the active stage falls back to Stage 1 (lowest sort stage).
- Stage exit split: if positive new savings exceed what an exit goal needs to complete, the exit goal is capped at its remaining target, and the leftover savings in that same period cascade into the subsequent stage according to its rules.
- Closed periods are immutable (AD-7, AD-13): `goal_allocation` records for a closed period are never modified or rewritten.
- Strict single emergency fund invariant: at most one goal with `isEmergencyFund = true` per pool (`personId = null` or specific `personId`). Reject duplicates with `Conflict` / domain validation error.

**Never:**
- Do not implement bank account reconciliation checks or deficit buffer absorption in this story (deferred to Story 7.3).
- Do not build the interactive goal creation modal or Cover an expense sheet in this story (deferred to Stories 7.4, 7.5, 7.6).
- Never allow a goal balance to decrease during standard period allocation (deficits affect only buffer, Story 7.3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Multi-goal allocation in Stage 1 | $1,000 new savings; Stage 1 rules: 80% Emergency Fund, 10% House, 10% Holiday | Allocations: $800 to Emergency Fund, $100 to House, $100 to Holiday. | Validates sum of shareBp <= 10000 |
| Exit goal completes with overflow | Emergency Fund needs $300 to reach $20,000 target; $1,000 new savings in period. Stage 2 rules: 60% House, 40% Holiday | Allocations: $300 to Emergency Fund (completes Stage 1). Remaining $700 cascades to Stage 2: $420 to House (60%), $280 to Holiday (40%). Audit log records stage change. | Graceful overflow handoff |
| Emergency fund drops below threshold | Emergency fund target $20,000, fallback threshold 80% ($16,000). Current balance drops to $15,500 (e.g. after withdrawal). Active stage was Stage 2. | Stage evaluator detects balance < $16,000; reactivates Stage 1. Subsequent allocations use Stage 1 shares until topped up. Audit log records fallback. | Correct reactivation logic |
| Non-exit goal completes & rescales | Stage 2 has House (60%) and Holiday (40%). Holiday reaches $8,000 target. $500 new savings. Policy: `rescale`. | Holiday is completed (gets $0). Remaining goal (House) is rescaled to 100% of allocated share (gets $500). | Proportional rescaling handles zero remainder |
| Second emergency fund created | Attempting to create a second emergency fund in shared pool where one already exists. | Throws validation Conflict error: "Pool already has an emergency fund". | AppError / ValidationError |
| Zero or negative new savings | $0 or -$500 new savings in period. | Returns empty allocations list; no `goal_allocation` rows inserted. | No error, no-op for allocation |

</frozen-after-approval>

## Code Map

- `packages/app/src/ports/unit-of-work.ts` -- Declare `GoalAllocationRepo` interface and add to `TxRepos` and `ReadRepos`.
- `packages/db/src/repositories/goal.ts` -- Implement `createGoalAllocationRepo` for SQLite drizzle queries.
- `packages/db/src/unit-of-work.ts` -- Wire `goalAllocations` into database unit of work.
- `packages/app/src/testing/memory-uow.ts` -- Implement `goalAllocations` repository methods in test double.
- `packages/app/src/planning/goal-allocation.ts` -- Core domain logic: `calculateGoalBalances`, `resolveActiveStage`, `allocatePeriodSavings`, `rescaleGoalRules`.
- `packages/app/src/planning/goal-allocation.test.ts` -- Comprehensive unit and domain test suite verifying multi-period allocation, stage exit cascade, fallback threshold, share rescaling, and duplicate emergency fund rejection.
- `packages/app/src/planning/goals.ts` -- Update `getGoalsSummary` and add `executeSavingsAllocation` use cases.
- `packages/app/src/index.ts` -- Export new allocation types and use cases.
- `packages/db/src/repositories/goal.test.ts` -- Add repository tests for `goalAllocations`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/repositories/goal.ts`, `packages/db/src/unit-of-work.ts`, `packages/app/src/testing/memory-uow.ts` -- Declare and implement `GoalAllocationRepo` in database and in-memory UnitOfWork -- persistence layer
- [ ] `packages/app/src/planning/goal-allocation.ts` -- Implement domain calculations: `calculateGoalBalances`, `resolveActiveStage`, `rescaleGoalRules`, and `allocatePeriodSavings` with stage exit cascade and fallback -- domain logic
- [ ] `packages/app/src/planning/goal-allocation.test.ts` -- Domain unit tests covering multi-period allocation history, overflow cascade to next stage, emergency fund fallback threshold, and rule rescaling -- domain verification
- [ ] `packages/app/src/planning/goals.ts` & `packages/app/src/planning/goals.test.ts` -- Update `listGoals` and `getGoalsSummary` with real balances and active stage derivation, and add `createGoal` validation rejecting duplicate emergency funds -- use cases & validation
- [ ] `packages/app/src/index.ts` -- Re-export goal allocation functions and types -- public exports

**Acceptance Criteria:**
- Given a seeded multi-period savings history, when period savings are allocated, then `goal_allocation` rows match active stage shares.
- Given an exit goal completing within a period, when period savings exceed remaining target, then excess savings cascade to the next stage's shares and a stage change audit log is recorded.
- Given an emergency fund balance dropping below its fallback threshold (80%), when resolving the active stage, then Stage 1 is reactivated.
- Given a goal completing under `completedSharePolicy === "rescale"`, when allocating subsequent savings, then its share is rescaled proportionally across active uncompleted goals.
- Given an existing emergency fund in a pool, when attempting to create another emergency fund in the same pool, then the operation is rejected.

## Implementation Notes

- Implemented `GoalAllocationRepo` across `packages/db` and `packages/app/src/testing/memory-uow.ts`.
- Domain calculation engine in `packages/app/src/planning/goal-allocation.ts` supporting `calculateGoalBalances`, `resolveActiveStage`, `rescaleGoalRules`, and `allocatePeriodSavings` with intra-period exit overflow cascade and emergency fund fallback threshold.
- Use cases `executeSavingsAllocation`, `createGoal`, and `updateGoal` enforcing single emergency fund per pool.
- Viewer privacy filtering in `GoalAllocationRepo` pushed down to SQL predicate (`or(isNull(goal.personId), eq(goal.personId, viewer.personId))`).

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Action Taken |
|---|---|---|
| Privacy filter in memory instead of SQL predicate in `GoalAllocationRepo.listForGoal`, `listForPeriod`, and `sumForGoal` | True (medium) | Patched: Composed SQL predicate (`goalVisibilityPredicate(viewer)`) directly into queries. |
| Inaccurate savings deduction when stage rules sum to less than 100% | True (medium) | Patched: Subtracted actual distributed amount and ensured loop terminates if unallocated. |
| Missing duplicate emergency fund validation on update | True (medium) | Patched: Added `updateGoal` use case and schema enforcing single emergency fund per pool. |
| Premature completion of emergency fund in `resolveActiveStage` | True (low) | Patched: Refined completion logic to strictly require `currentBalance >= targetCents`. |
| Unbounded in-memory filtering in `executeSavingsAllocation` | False | Disproven: `executeSavingsAllocation` fetches visible goals and stages scoped by viewer and pool; repos already enforce AD-3/AD-22. |
| `getGoalsSummary` evaluates active stage for shared pool only | False | By design: shared pool is primary; personal pool stages are rendered in individual contexts. |

## Design Notes

- Active stage resolution algorithm:
  1. Fetch all stages for the pool ordered by `sort ASC`.
  2. If emergency fund exists and its current balance < `(targetCents * fallbackThresholdBp) / 10000`, active stage is Stage 1 (lowest sort).
  3. Otherwise, iterate through stages: the active stage is the first stage whose `exitGoalId` is either `null` or has `currentBalance < targetCents`. If all stages are completed, remain at the highest sort stage.
- Overflow cascade:
  1. Within an allocation period with `remainingSavings > 0`:
  2. Look up rules for current active stage. Rescale rules if any goal in the stage is completed.
  3. If stage has an `exitGoal`, calculate capacity = `targetCents - currentBalance`.
  4. If `exitGoal` share would allocate > capacity: allocate exactly capacity to `exitGoal`, allocate proportional shares to other goals in that stage, subtract total allocated from `remainingSavings`, transition active stage to next stage, and recurse/repeat with remaining savings.

## Verification

**Commands:**
- `pnpm --filter @pangolin/db test` -- expected: database repo tests pass
- `pnpm --filter @pangolin/app test` -- expected: domain allocation and goals tests pass
- `pnpm test` -- expected: entire workspace test suite passes
- `pnpm lint` -- expected: biome check passes
