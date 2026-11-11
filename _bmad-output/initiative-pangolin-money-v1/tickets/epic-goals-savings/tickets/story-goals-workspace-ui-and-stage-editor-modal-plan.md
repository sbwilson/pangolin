---
title: 'Goals workspace UI and stage editor modal'
type: 'feature'
ticket: '4'
created: '2026-11-07'
status: done
baseline_revision: 'e86e3eb54faeed3c8de301b42211de3ae7b3b3cf'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-goals.html'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/planning/goals` is the read-only list from story 7.1: no goal create/edit, no stage/rule configuration, no active stage card, no projected completion dates — though the 7.2/7.3 engines already compute the data.

**Approach:** Add stage/rule CRUD use cases, `deleteGoal`, and per-goal completion projection (`remaining ÷ avg allocation over last 6 periods`) to the domain; expose write routes; rework `GoalsPage` into the workspace (stage card + progress cards with arrival lines); add `GoalEditorSheet` + `StageEditorSheet` following `BudgetEditorSheet`.

**Decisions (2026-11-07, human):** Stage editor = single-stage sheet: stage list inside the sheet, edit one stage at a time (name, exit goal, fallback threshold %, completed-share policy, per-goal share % inputs), Add/Delete stage buttons — no full-ladder/drag editor. Goal editor = UX fields (name, pool, target, kind toggle, EF switch) + optional Target date; `priority` stays internal (card badge kept for seeded data).

## Boundaries & Constraints

**Always:**
- Reuse existing `createGoal`/`updateGoal` (single emergency fund per pool → HTTP 409). `deleteGoal` blocked while any stage has the goal as `exitGoalId`.
- New mutations behind server `writable()` and registered in `privacy/route-manifest.ts`; viewer scoping per AD-3/AD-22.
- Manual stage/rule edits audit `action: "stage-change"` (same audit hook as `executeSavingsAllocation`).
- Shares 0–10000 bp each; a stage whose shares sum > 10000 bp is rejected. Buffer = remainder, never a rule row.
- `setStageRules` replaces the stage's `source: "rule"` rows wholesale (`effectiveFrom` = today); `shortfall_override` rows untouched (7.6 owns those).
- New goals default `kind: "flexible"`. Editor: kind toggle hidden while EF switch on; switch disabled with caption "Shared savings already has one: {name}" when pool has one.
- Projection: `remaining ÷ avg per-period allocation over last ≤6 goal_allocation rows`, pace from `period_start` gaps; <2 rows → no projection ("—" + "Not enough history yet"). Completed goals show the complete state, not a date. Next stage-change date = active stage's exit goal projected date. UI shows month+year: "At the current rate, you'll arrive by Mar 2028."
- Integer cents (AD-13); `formatCents`/`parseCents`.

**Never:**
- No Cover-an-expense sheet, shortfall Cover-it/buffer-divert UI, large-withdrawal threshold field, or review items (7.5–7.7).
- Do not modify allocation/reconciliation math (`goal-allocation.ts`, `savings-reconciliation.ts`).
- No new tables or migrations — 7.1 schema + existing repo ports cover everything.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create goal via sheet | name + target, EF off | row written; summary refetches; card with badge + progress bar | blank name / target ≤ 0: inline validation |
| Second emergency fund | direct API attempt in pool that has one | UI disables switch | 409 "Pool already has an emergency fund", inline |
| Edit goal | pencil, prefilled sheet; change target | `updateGoal` persists; progress/arrival re-render | 404 unknown id |
| Delete exit-goal-referenced goal | goal is a stage's `exitGoalId` | blocked | 409 naming the stage |
| Stage shares sum > 100% | shares total 110% in editor | nothing written | validation error inline |
| Delete stage with rules | confirm dialog | stage + rules deleted; `goal_allocation` history untouched | last stage: confirm warns allocations stop |
| Projection with history | ≥2 allocation rows, remaining > 0 | "arrive by {Mon YYYY}" | <2 rows → "—" + "Not enough history yet" |
| Demo session | any mutation | edit controls hidden; page renders | 409 "Demo mode is read-only" on direct call |

</frozen-after-approval>

## Code Map

- `packages/app/src/planning/goal-projection.ts` -- NEW: pure `projectGoalCompletion(rows, asOf)`; no repos.
- `packages/app/src/planning/goals.ts` -- reuse `createGoal`/`updateGoal`/`getGoalsSummary`; add `deleteGoal`, `createStage`/`updateStage`/`deleteStage`/`setStageRules`; `getGoalsSummary` gains projections + next stage-change date. Copy `executeSavingsAllocation`'s `write(ctx, (tx, audit) => …)` style.
- `packages/app/src/ports/unit-of-work.ts` -- NO port change expected: `GoalRepo.delete`, `AllocationStageRepo` CRUD, `GoalRuleRepo.deleteForStage`, `GoalAllocationRepo.listForGoal` exist.
- `packages/app/src/testing/memory-uow.ts` + `repo-parity.test.ts` -- verify/extend update/delete parity for goal, allocation_stage, goal_rule.
- `apps/server/src/http/app.ts` -- add POST/PATCH/DELETE `/api/planning/goals(/:id)`, POST/PATCH/DELETE `/api/planning/stages(/:id)`, PUT `/api/planning/stages/:id/rules`; recurring-bills mutations (~504–522) are the pattern.
- `apps/server/src/privacy/route-manifest.ts` -- register new routes (~607, next to goals read entries).
- `apps/web/src/api.ts` -- wrappers beside `fetchGoalsSummary`, mirroring `createBudget`/`sendJson`.
- `apps/web/src/pages/GoalsPage.tsx` -- rework per mock: active stage card (share chips + buffer-remainder chip, stat tiles from `poolBalances`, fallback hint), goal grid with progress bar + stage chip + arrival line + edit pencil, "Add a goal" + stage-config buttons, empty states ("No goals yet"). Keep scope filter.
- `apps/web/src/components/GoalEditorSheet.tsx` / `StageEditorSheet.tsx` -- NEW; copy `BudgetEditorSheet.tsx` (Sheet + `INPUT_CLASS_RING_DISABLED` + save/error state + refetch-on-save). Goal sheet: name, pool segmented control, target, optional target date, kind toggle, EF switch. Stage sheet: single-stage list + form per the frozen Decisions.
- `apps/web/src/pages/GoalsPage.test.tsx` -- extend (jsdom + `vi.mock("../api.ts")` style); co-located sheet tests.
- `apps/server/src/http/app.test.ts` -- route tests (pattern ~4836): happy, 409s, demo read-only, viewer scoping.
- `e2e/axe.spec.ts` -- add `/planning/goals`; `e2e/goals.spec.ts` NEW happy path (create goal, edit share).

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/planning/goal-projection.ts` + `.test.ts` -- projection math covering matrix rows (<2 rows, completed, zero avg) -- domain
- [x] `packages/app/src/planning/goals.ts` + `goals.test.ts` -- `deleteGoal` guard; stage/rule CRUD with sum ≤ 10000 validation + `stage-change` audit; summary projections -- use cases
- [x] `packages/app/src/index.ts` -- export new use cases/types -- public surface
- [x] `packages/app/src/testing/memory-uow.ts` + `repo-parity.test.ts` -- update/delete parity coverage -- doubles
- [x] `apps/server/src/http/app.ts` + `privacy/route-manifest.ts` -- routes + manifest -- API
- [x] `apps/server/src/http/app.test.ts` -- route tests -- API verification
- [x] `apps/web/src/api.ts` -- client wrappers -- plumbing
- [x] `apps/web/src/components/GoalEditorSheet.tsx` + test -- create/edit per frozen fields incl. optional target date, EF switch rules -- goal modal
- [x] `apps/web/src/components/StageEditorSheet.tsx` + test -- single-stage editor, share-sum validation -- stage modal
- [x] `apps/web/src/pages/GoalsPage.tsx` + `GoalsPage.test.tsx` -- stage card, progress cards, arrival lines, entry buttons, empty states -- workspace
- [x] `e2e/axe.spec.ts`, `e2e/goals.spec.ts` -- axe route + Playwright happy path -- e2e

**Acceptance Criteria:**
- Given a seeded pool with stages, when opening `/planning/goals`, then the active stage card (name, share chips, stat tiles) and per-goal cards with kind/EF badges, stage chips, and projected arrival dates render.
- Given shares saved in the stage editor, when `executeSavingsAllocation` later runs for that stage, then allocations follow the new shares (domain test: `setStageRules` output feeds the engine unchanged).
- Given a demo session, when viewing the page, then no create/edit affordances render.
- Given an active stage whose exit goal has a projection, when the page renders, then the header names the active stage and projected next-change date.

## Implementation Notes

- `deleteGoal` gained a second guard beyond the exit-stage one: goals with `goal_allocation` history are blocked ("Goal already has savings history") — SQLite FKs are RESTRICT with no cascade (proven by the new `repo-parity` transcript), so allocation rows must block removal; `goal_rule` rows referencing the goal are deleted with it first. MemoryUow now mimics those FK failures.
- Projection: zero-net and future-dated periods are dropped before the ≤6-window average; pace ("weekly"/"fortnightly"/"monthly") comes from the two most recent funded `period_start` gaps; completion counts forward from the latest funded period.
- Personal-pool active stage is derived client-side in `GoalsPage` (first stage whose exit goal isn't full); `resolveActiveStage` still only backs the shared pool. Candidate to move server-side if 7.5+ needs it.
- Matrix-audit follow-up (step-03): the last-stage delete confirmation now warns "This is the only stage. Allocations stop until you add one back." in `StageEditorSheet`, with a covering test.
- e2e (`goals.spec.ts`, axe `/planning/goals` entries) written and typechecked but not executed locally — no running server; left to CI per the plan.
- Review-loop patches (quick lens, 2026-11-07): weekly projection now `pace_days × periodsRemaining`; `getGoalsSummary` threads `asOf` into `listGoals`; shared-pool `stageViewFor` prefers the engine's `activeStage` id (chips/buffer/card chips agree with the header); goal sheet prefills exact cents (`centsToText`), pool-aware EF caption, `aria-label="Emergency fund"` on the switch; stage sheet invalidates even when the second save call fails; e2e selectors made unambiguous (`Target` exact, Add-a-goal `.first()`).

## Plan Change Log

- 2026-11-07 (review loop 1): Quick-lens triage routed nine `patch` findings — no intent or plan changes. The step-03 implementer session replayed its original report instead of patching (only F3 landed), so F1, F2, F4–F9 were applied directly in the review step, each with a covering test. Re-verified: `pnpm test` 211 files / 2931 passed; `pnpm lint` 0 errors; `pnpm typecheck` exit 0; e2e still CI-only.

## Review Triage Log
| # | Source | Finding | Severity | Route | Resolution | Status |
|---|--------|---------|----------|-------|------------|--------|
| F1 | quick | `projectGoal`: weekly pace branch drops `periodsRemaining` (`pace === "weekly" ? 7 : 14 * periodsRemaining`) — a weekly goal with N periods left projects latest+7d, contradicting the projection contract ("latest period start plus `periodsRemaining` periods", honoured by the monthly/fortnightly branches) and the ticket's end-date promise; the "derives a weekly pace" test pinned the buggy value | high | patch | Fix to `(pace === "weekly" ? 7 : 14) * periodsRemaining`; test expectation "2026-06-22" → "2026-07-20" (latest 2026-06-15 + 5×7) | patched |
| F2 | quick | `getGoalsSummary` calls `listGoals(ctx)` without `{ asOf }` while items use `buildGoalViews(goal, ctx, asOf)` → summary projection ≠ item projection for future asOf; plan Integration points say `listGoals({asOf})` | medium | patch | Pass `{ asOf }`; extend "projects goals for a future asOf" test to assert `summary.projection` equals `items[0].projection` | patched |
| F3 | quick | Unused `dayInput` import in `goals.ts`; duplicated FK comment in `memory-uow.ts` | low | patch | Drop the import; keep the comment (diagnostic value, parity noted with postgres.ts) | patched |
| F4 | quick | `GoalEditorSheet` EF caption hardcodes "Shared savings" even for personal goals (editor opens for personal cards too) | medium | patch | Make the remaining-share sublabel pool-aware: shared → "Shared savings", personal → "Your savings" | patched |
| F5 | quick | Shared card mixes sources: header reads engine `activeSharedStage`, buffer/chips read the client-derived view → during fallback (engine stage has no row) header says Stage N+1 while body shows Stage N active with no "Not yet recorded" badge | medium | patch | Derive the shared card's one view from the engine's active stage: row → numbers; no row → "Not yet recorded" badge, buffer hidden, chip active state from the engine stage id | patched |
| F6 | quick | e2e strict-mode violations (verified subset; the reviewer's other cited selectors don't exist in the current spec): `getByLabel("Target")` (spec line 17) also matches the "Target date (optional)" label; GoalsPage renders two same-named "Add a goal" buttons (header + empty state) so `getByRole("button", { name: "Add a goal" })` is ambiguous when empty | medium | patch | Spec-only: `{ exact: true }` on the Target label; scope the Add-a-goal click (`.first()`) | patched |
| F7 | quick | EF `role="switch"` in `GoalEditorSheet` (~line 274) has no accessible name (no aria-label, no associated label) — fails axe, which the plan's Verification requires on this page | medium | patch | Add `aria-label="Emergency fund"` to the switch (the stage sheet has no switch — reviewer's second half not applicable) | patched |
| F8 | quick | Target prefill `(targetCents/100).toFixed(0)` truncates cents → opening and saving a $123.45 goal silently mutates it to $123.00 | medium | patch | Prefill via `centsToText` from `lib/money` (exact decimal string; `textToCents` round-trips, matching GoalsPage editGoal) | patched |
| F9 | quick | Stage save fires `updateStage` then `setStageRules`; if the second call fails, no invalidation runs → committed first half invisible in UI | medium | patch | Invalidate goals/stage-rules/progress even on the failure path | patched |
| F10 | quick | Design Notes example shows `textToCents("$1234") → 1234` (off ~100× from what `textToCents` actually returns) | medium | rejected | Not a code defect — implementation correctly follows the codebase cents convention (tests use `textToCents("$15000") → 1500000`; `GoalCard` uses `formatCents`). The cited Design Notes bullet no longer exists in the current plan's Design Notes section, so nothing to correct; no loopback needed since code and intent are unaffected | rejected |
| F11 | quick | `listGoals` N+1 reads per goal | low | rejected | Matches the plan's prescribed use-case composition and repo style; perf pass is out of scope for this story | rejected |

## Design Notes

- Projection example: allocations [240,260,250,240,255,255]¢ over fortnightly `period_start`s, remaining 1,190,000¢ → avg 250¢/period × ~14-day gaps → ~670 days → "arrive by Aug 2028".
- Buffer chip = `10000 − Σshares` bp; "Gets {p}% of each fortnight" note only when > 0.
- No-stage pool: stage card shows "No allocation stage set" + Add-a-stage CTA (engine already yields `activeStage: null`).

## Verification

**Commands:**
- `pnpm --filter @pangolin/app test` -- expected: projection, goals, parity tests pass
- `pnpm --filter @pangolin/server test` -- expected: goals/stages/rules route tests pass
- `pnpm test` -- expected: whole workspace green
- `pnpm lint` -- expected: biome check passes
- `pnpm --filter e2e exec playwright test goals.spec.ts axe.spec.ts` -- expected: goals e2e + axe pass (if env unavailable, leave to CI)


