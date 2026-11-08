---
title: 'Savings reconciliation review items: large withdrawal detection, shortfall alerts, and one-click fixes'
type: 'feature'
ticket: 7
created: '2026-11-08'
status: 'built'
baseline_revision: '7ccc80b8afe1c122fb2eb7f8fcdddf18562e104d'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '_bmad-output/initiative-pangolin-money-v1/tickets/epic-goals-savings/epic-goals-savings.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Qualifying large savings withdrawals and goal shortfalls are not surfaced to users in the review inbox, and buffer mismatches lack a one-click reconciliation fix.

**Approach:** Implement review item sync and dismissal for large savings withdrawals (>= threshold, default $2,000) and goal shortfalls, provide actions to cover an expense or link to buffer adjustments, and support one-click buffer mismatch adjustments.

## Boundaries & Constraints

**Always:**
- Scoping follows AD-22: shared pool review items are scoped to "household" (both partners see them); personal pool items are scoped to "person" (visible only to that pool's owner).
- Dedupe keys are deterministic: `savings:large_withdrawal:<transactionId>` for large withdrawals, `savings:shortfall:<pool>` for shortfall alerts, and `savings:mismatch:<pool>` for buffer mismatches.
- Resolving/covering a large withdrawal, eliminating a shortfall, or applying a buffer adjustment auto-resolves or allows one-click resolution of the corresponding review item.
- Review kind registrations use `defineReviewKind` with module `planning`.
- When a pool has an open Large withdrawal item, any shortfall item points to it instead of offering duplicate fixes.

**Never:**
- Never create a large withdrawal item for transfers between savings accounts within the same pool or transactions already linked to a goal drawdown.
- Never modify or draw down goal balances silently during buffer adjustments.
- Never write to a partner's personal goals or private review items.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Large withdrawal detected | Savings account expense txn >= threshold ($2,000 default) not internal transfer and not linked | Raises review item `planning.savings.large_withdrawal` (or `.personal`) with entityRef `transaction:<id>` | Idempotent on repeated sync via dedupe key |
| Large withdrawal below threshold | Savings expense txn < threshold | No review item raised | Ignored |
| Internal transfer between same pool savings | Transfer between two savings accounts in same pool | No review item raised | Ignored |
| Shortfall detected | Pool reconciliation reports status "over-committed" | Raises review item `planning.savings.shortfall` (or `.personal`) | Idempotent |
| Shortfall cured | Pool reconciliation reports status "ok" | Auto-resolves open shortfall review item with resolution "cured" | Safe no-op if none open |
| Large withdrawal covered/linked | Transaction linked to goal drawdown or marked buffer | Resolves large withdrawal review item with appropriate resolution | Safe no-op |
| One-click buffer adjustment | Call adjustBufferForMismatch endpoint/use-case | Buffer adjusted / recorded, resolving mismatch review item | Validation error if inputs invalid |

</frozen-after-approval>

## Code Map

- `packages/app/src/planning/savings-review.ts` -- NEW: Savings reconciliation review item generator, defining review kinds (`planning.savings.large_withdrawal`, `planning.savings.large_withdrawal.personal`, `planning.savings.shortfall`, `planning.savings.shortfall.personal`, `planning.savings.mismatch`), dedupe keys, sync logic, and dismissal / adjustment use cases.
- `packages/app/src/planning/savings-review.test.ts` -- NEW: Unit tests for large withdrawal detection, shortfall alerts, auto-resolution, and scoping rules.
- `packages/app/src/planning/savings-reconciliation.ts` -- Integrate review sync on reconciliation run / periodic evaluation.
- `packages/app/src/index.ts` -- Export savings review items and sync functions.
- `apps/server/src/jobs/budget-evaluation.ts` or planning job -- Trigger savings review sync during scheduled background jobs or post-import.
- `apps/web/src/components/review/SavingsReviewCard.tsx` -- NEW: UI card component for large withdrawal, shortfall, and buffer mismatch items with actions (Cover it, Link to goal, Take from buffer, Put difference in buffer).
- `apps/web/src/components/review/ReviewCardView.tsx` -- Register new savings review kinds in review inbox viewer.
- `apps/web/src/components/review/ReviewCardFrame.tsx` -- Add title mappings for new savings review kinds.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/planning/savings-review.ts` -- Define review kinds, dedupe keys, detection logic, and one-click buffer adjustment use cases -- Core domain & application logic for savings reconciliation review items.
- [ ] `packages/app/src/planning/savings-review.test.ts` -- Add unit tests for detection, auto-resolution, and edge cases from I/O matrix -- Verify behavior against ACs.
- [ ] `packages/app/src/index.ts` -- Export savings review use cases and kinds -- Expose to API layer.
- [ ] `apps/server/src/http/app.ts` -- Add routes for savings review item actions and buffer adjustment if needed -- Server HTTP endpoints.
- [ ] `apps/web/src/components/review/SavingsReviewCard.tsx` -- Implement review card UI for large withdrawal, shortfall, and mismatch -- Review inbox card view.
- [ ] `apps/web/src/components/review/ReviewCardView.tsx` & `ReviewCardFrame.tsx` -- Hook cards into ReviewCardView and map frame titles -- UI registration.
- [ ] `apps/web/src/components/review/SavingsReviewCard.test.tsx` -- Component tests for SavingsReviewCard actions -- UI test coverage.

**Acceptance Criteria:**
- Given a savings withdrawal >= threshold, when review items are synced, then a deduplicated large withdrawal review item is raised with appropriate household/personal scope.
- Given a pool in over-committed shortfall state, when review items are synced, then a shortfall review item is raised pointing to cover options or open large withdrawals.
- Given an open large withdrawal or mismatch item, when the user chooses "Take it from the buffer" or "Put difference in buffer", then the item is resolved and the buffer is aligned.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- quick: low | packages/app/src/planning/savings-review.ts:303 | Buffer mismatch detection during sync | false: Mismatch is handled when explicit mismatch occurs / status in report is ok or over-committed; adjustBufferForMismatch provides manual/one-click reconciliation.
- quick: medium | packages/app/src/planning/savings-review.ts:1964 | Personal drawdowns under system viewer | patch: Iterated active persons to populate personal drawdown links in linkedTxnIds.
- quick: medium | packages/app/src/planning/savings-review.ts:1995 | Counterpart lookup in same-pool transfer | patch: Used tx.transferGroups.members() to reliably load counterpart transactions.
- quick: low | packages/app/src/system/review-view.ts:2449 | Non-canonical poolOf fallback | patch: Switched to poolOf(owners).
- quick: medium | packages/app/src/planning/savings-review.ts:2274 | Single goal drawdown ordering | false: linkWithdrawalToGoal is explicitly an "It's for a goal" targeted linkage for a specific goal.
- quick: low | deploy/install.sh | Diff contains local LLM changes | false: Those changes were committed previously in 9c233fc on develop.

## Design Notes

- Large withdrawal action "Cover it" opens the Cover an expense sheet with the withdrawal amount pre-populated.
- "Take it from the buffer" is available when the derived buffer is >= withdrawal amount; resolving the item with "buffer".
- "Put the difference in the buffer" for mismatches confirms adjustment and resolves the mismatch review item.

## Verification

**Commands:**
- `pnpm test` -- expected: All unit and component tests pass across packages/app, apps/server, and apps/web.
- `pnpm typecheck` -- expected: TypeScript compiles cleanly with zero errors.
