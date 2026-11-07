---
title: 'Cover an expense engine: large purchase vs shortfall drawdown ordering, proposals, and undo'
type: 'feature'
ticket: '5'
created: '2026-11-07'
status: 'built'
baseline_revision: '832607f0531dcd3a8c661b4b6a0118c35b1ca7fa'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** While goals accumulate funds through staged allocations, goal balances can never decrease except via user-confirmed drawdowns or linked withdrawals (AD-24). Currently, there is no domain engine or persistence to propose, record, or undo goal drawdowns for large purchases or shortfall recovery. Consequently, when an overspending deficit exhausts the unallocated buffer or a large purchase occurs, users cannot draw down goals, adjustments cannot be audited, and balances cannot be cleanly restored.

**Approach:** Implement the drawdown domain logic in `packages/app/src/planning/goal-drawdown.ts` and add `GoalDrawdownRepo` in persistence (`unit-of-work`, `db`, and `memory-uow`). Provide pure ordering and proposal calculation (`large_purchase`: Emergency Fund -> Flexible -> Protected; `shortfall`: Flexible -> Emergency Fund -> Protected; Flexible goals split proportionally to current balance; Protected goals unlocked with warnings), use-cases to execute and undo drawdowns with full audit logging, and feed active adjustments into `calculateGoalBalances`, `listGoals`, and savings reconciliation.

## Boundaries & Constraints

**Always:**
- Drawdown ordering by reason:
  - `large_purchase`: Emergency fund first (pre-filled up to its balance, capped at needed amount), then Flexible goals (split proportionally to balance), then Protected goals only when needed after prior tiers are exhausted.
  - `shortfall`: Flexible goals first (split proportionally to balance), then Emergency fund, then Protected goals.
- Protected goals gating & warning:
  - Protected goals are included in proposals only when remaining amount > 0 after exhausting preceding tiers (Flexible and/or Emergency fund).
  - Proposal response explicitly flags `unlockedProtected: boolean` and lists affected Protected goals with warnings.
- Proportional split for Flexible tier:
  - If multiple Flexible goals exist, proposed amount splits in proportion to their current positive balances (`balance / totalFlexibleBalance * remainingToCover`), with remainder cents allocated to the largest balance goal (exact integer cents, sum equals covered amount).
  - If a goal has 0 balance, its proposed amount is 0.
- Pool scoping & isolation (AD-3, AD-22, AD-26):
  - A drawdown operates strictly within a single pool (`"shared"` or `personId`). It debits only visible goals belonging to that pool. Partner personal goals are never listed, counted, or touched.
- Data integrity & Atomicity:
  - Executing a drawdown writes one `goal_drawdown` row and one `goal_adjustment` row per debited goal (`amountCents > 0`).
  - Executing audits `action: "drawdown"`; undo audits `action: "drawdown-undo"`.
  - Undo is atomic: sets `undoneAt` timestamp on `goal_drawdown` (or hard deletes / marks undone; `undoneAt` is in schema). Undone drawdowns are ignored in active balance and reconciliation calculations.
  - Verification validates: total adjustment cents equals drawdown `amountCents` (or ≤ if partial cover confirmed), every adjustment amount is > 0 and ≤ goal's current balance.
- Integers cents only (AD-13).

**Never:**
- No UI components or modal sheets: Story 7.6 builds the `CoverExpenseModal` and buffer divert UI.
- No `review_item` creation or automated background scanner: Story 7.7 detects large withdrawals and creates review inbox items.
- Never debit the unallocated buffer via drawdown rows: buffer is derived on read (`max(0, actualSavings - goalTotal)`).
- Never allow drawdowns to exceed a goal's available balance (no negative goal balances).
- Do not modify allocation math in `packages/app/src/planning/goal-allocation.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Large purchase proposal (EF covers all) | Purchase $1,000; EF balance $5,000; Flexible goals $3,000 | Proposal: EF debits $1,000; Flexible $0; Protected $0; unlockedProtected false; remaining 0 | No error |
| Large purchase proposal (EF partial, Flexible covers rest) | Purchase $3,000; EF balance $1,000; Flex A $2,000, Flex B $2,000 (total Flex $4,000) | Proposal: EF $1,000; Flex A $1,000; Flex B $1,000; Protected $0; remaining 0 | No error |
| Shortfall proposal (Flexible covers all) | Shortfall $1,500; EF $5,000; Flex A $1,000, Flex B $2,000 | Proposal: Flex A $500, Flex B $1,000; EF $0; Protected $0; remaining 0 | No error |
| Shortfall proposal (Flex + EF exhausted, needs Protected) | Shortfall $4,000; Flex $1,000; EF $2,000; Protected $5,000 | Proposal: Flex $1,000; EF $2,000; Protected $1,000; unlockedProtected true with warning | Warning attached |
| Insufficient pool balance | Drawdown $10,000; Total pool goals balance $6,000 | Proposes up to $6,000 across all tiers; reports `coveredCents: 6000`, `remainingCents: 4000` | Partial cover allowed |
| Zero / negative amount | amountCents <= 0 | Rejection | ValidationError |
| Cross-pool goal inclusion | Drawdown in shared pool includes personal goal ID | Rejection | ValidationError / ForbiddenError |
| Confirm drawdown | Valid adjustments totaling amountCents | Writes `goal_drawdown` + `goal_adjustment`s; updates goal current balance immediately | Atomic transaction |
| Undo drawdown | Existing active drawdownId | Sets `undoneAt` to current timestamp; goal balances restored to prior amounts | 404 if missing, 400 if already undone |
| Undo already undone | Drawdown where `undoneAt` is non-null | Rejection | 400 "Drawdown already undone" |

</frozen-after-approval>

## Code Map

- `packages/app/src/ports/unit-of-work.ts` -- Define `GoalDrawdownRepo` interface (`insert`, `findById`, `listActiveForPool`, `listForGoal`, `markUndone`), add `goalDrawdowns` and `goalAdjustments` to `TxRepos` and `ReadRepos`.
- `packages/db/src/repositories/goal.ts` -- Implement `createGoalDrawdownRepo` and `createGoalAdjustmentRepo` with SQLite queries using `goalDrawdown` and `goalAdjustment` schema tables.
- `packages/db/src/unit-of-work.ts` -- Mount `goalDrawdowns` in `createTxRepos` and `createReadRepos`.
- `packages/app/src/testing/memory-uow.ts` -- Add in-memory implementations for `goalDrawdowns` and `goalAdjustments`.
- `packages/app/src/testing/repo-parity.test.ts` -- Add parity tests for drawdown and adjustment repo methods between Memory and SQLite.
- `packages/app/src/planning/goal-drawdown.ts` -- NEW:
  - Pure calculation: `proposeDrawdownSplit({ reason, amountCents, goals, balances })`.
  - Use case: `proposeDrawdown(ctx, input)`.
  - Use case: `executeDrawdown(ctx, input)` -- creates `goal_drawdown` and `goal_adjustment` records within an audited write transaction.
  - Use case: `undoDrawdown(ctx, { drawdownId })` -- sets `undoneAt` on the drawdown within an audited write transaction.
  - Use case: `listDrawdowns(ctx, { pool })` -- returns drawdowns for goal history.
- `packages/app/src/planning/goals.ts` -- Update `listGoals` and `getGoalsSummary` to query active goal adjustments and apply them to `currentBalance = sumAllocations - sumAdjustments`.
- `packages/app/src/planning/savings-reconciliation.ts` -- Update `poolGoalTotalCents` to account for active adjustments so `goals + buffer = savings` remains exact. Also connect `excludedGoalWithdrawalCents` if covering a withdrawal.
- `apps/server/src/http/app.ts` -- Add POST `/api/planning/drawdowns/propose`, POST `/api/planning/drawdowns`, POST `/api/planning/drawdowns/:id/undo`, GET `/api/planning/drawdowns`.
- `apps/server/src/privacy/route-manifest.ts` -- Register new drawdown endpoints with appropriate privacy classifications.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/ports/unit-of-work.ts` -- Add `GoalDrawdownRepo` interface, `GoalAdjustmentRepo` interface, and wire into `TxRepos` and `ReadRepos` -- Provides contract for persisting and reading drawdowns and adjustments.
- [ ] `packages/db/src/repositories/goal.ts` & `packages/db/src/unit-of-work.ts` -- Implement DB repository for `goalDrawdown` and `goalAdjustment` tables -- Enables SQLite persistence of drawdowns.
- [ ] `packages/app/src/testing/memory-uow.ts` & `packages/app/src/testing/repo-parity.test.ts` -- Wire memory UOW and test repository parity -- Ensures unit tests and memory harness match DB behavior.
- [ ] `packages/app/src/planning/goal-drawdown.ts` -- Implement pure proposal math, executeDrawdown, undoDrawdown, listDrawdowns -- Core domain engine for drawdown proposals, execution, and reversal.
- [ ] `packages/app/src/planning/goals.ts` & `packages/app/src/planning/savings-reconciliation.ts` -- Incorporate adjustments into goal balance calculation and reconciliation invariant -- Keeps goal balances and pool reconciliation consistent when drawdowns occur.
- [ ] `apps/server/src/http/app.ts` & `apps/server/src/privacy/route-manifest.ts` -- Expose drawdown endpoints (propose, execute, undo, list) and register routes -- Allows web and API callers to execute drawdown workflows.
- [ ] `packages/app/src/planning/goal-drawdown.test.ts` & `apps/server/src/http/app.test.ts` -- Comprehensive unit and route integration tests covering proposal orders, caps, proportional splits, execution, and undo -- Verifies all edge cases and invariants.

**Acceptance Criteria:**
- Given a pool with an Emergency Fund and Flexible goals, when proposing a `large_purchase`, then the Emergency Fund is drawn down first up to its balance before Flexible goals are touched.
- Given a pool with an Emergency Fund and Flexible goals, when proposing a `shortfall`, then Flexible goals are drawn down first proportionally before the Emergency Fund is touched.
- Given a proposal where preceding tiers are exhausted and Protected goals must be debited, then Protected goals are included and `unlockedProtected` is true with warning details.
- Given a confirmed drawdown, when executed, then one `goal_drawdown` and matching `goal_adjustment` records are written with audit log `action: "drawdown"`, and goal balances reflect the debit.
- Given an executed drawdown, when `undoDrawdown` is called, then `undoneAt` is set, audit log `action: "drawdown-undo"` is written, and goal balances immediately restore to their pre-drawdown values.
- Given active goal adjustments, when `getSavingsReconciliation` runs, then `goalTotalCents` reflects current balances minus active adjustments and the invariant `goalTotal + buffer = savings` holds.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `high` -- `packages/app/src/planning/savings-reconciliation.ts:243-255` -- `patch` -- `excludedGoalWithdrawalCents` was not connected for period drawdowns with linked transactions in `runSavingsReconciliation`; patched to sum active period drawdowns with `transactionId != null`.
- `medium` -- `packages/app/src/planning/goal-drawdown.ts:384-386` -- `patch` -- `listDrawdowns` queried only active drawdowns hiding undone records from goal history; patched by adding `listForPool` to `GoalDrawdownRepo` so goal history displays both active and undone drawdowns.
- `medium` -- `packages/db/src/repositories/goal.ts:929-950` -- `patch` -- `listForGoal` missed distinct deduplication across joined adjustment rows; patched with `selectDistinct`.
- `low` -- `packages/app/src/planning/goal-drawdown.ts:1867-1869` -- `patch` -- Pool mismatch threw `Forbidden` instead of `NotFound`; patched to throw `NotFound` per AD-3/AD-22 opacity.
- `low` -- `packages/app/src/planning/goal-drawdown.ts:39-40` -- `patch` -- Remainder cent allocation in flexible proportional split did not explicitly assign to largest balance goal; patched with explicit remainder distribution.
- `low` -- `packages/app/src/accounts/leave-household.ts` -- `patch` -- Leaver personal drawdowns were not deleted on household leave; patched in `deleteScopedRows`.
- `low` -- `apps/server/src/privacy/route-manifest.ts:207-225` -- `patch` -- `GET /api/planning/drawdowns` was registered as `read()` without params; patched to `kind: "exempt"` matching planning endpoints.
- `false` -- `packages/app/src/planning/goal-allocation.ts:494-566` -- Refuted: Passing active adjustments to `calculateGoalBalances` does not change the allocation math; it correctly feeds historical adjusted balances into the unchanged allocation formula.

## Verification

**Commands:**
- `pnpm --filter @pangolin/app test` -- expected: all domain unit tests pass including goal-drawdown tests.
- `pnpm --filter @pangolin/db test` -- expected: repository parity and migration tests pass.
- `pnpm --filter @pangolin/server test` -- expected: API route tests pass.
- `pnpm typecheck` -- expected: whole-monorepo TypeScript check clean.
