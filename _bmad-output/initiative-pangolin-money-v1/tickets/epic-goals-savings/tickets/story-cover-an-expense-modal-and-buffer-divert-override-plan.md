---
title: 'Cover an expense modal and buffer divert override'
type: 'feature'
ticket: '6'
created: '2026-11-08'
status: 'built'
baseline_revision: 'ecfae2b140fae1e5bb1925d3d40ecf7081268b06'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/budgets-goals-forecasting.md'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-cover-expense.html'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-goals.html'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users currently have no interactive UI on the Goals & Savings page to cover large purchases or gradual shortfalls from their virtual goals, nor can they toggle buffer divert rules when a stage gives the buffer a share. While Story 7.5 delivered the underlying drawdown domain engine and REST endpoints, the web frontend lacks the `CoverExpenseSheet`, slider adjustments with Protected goal warning gating, real-time balance and arrival date previews, drawdown confirmation with undo toast and history lines, and the buffer divert toggle.

**Approach:** Implement `CoverExpenseSheet` (using the desktop/mobile `Sheet` pattern from mockups `key-cover-expense.html` and `key-goals.html`), mount entry points on `GoalsPage` ("Cover an expense" header button, shortfall warning banner with "Cover it" and buffer divert toggle), wire frontend API clients for proposal, execution, undo, and listing of drawdowns and buffer divert overrides, and provide immediate Undo via toast and history audit lines.

## Boundaries & Constraints

**Always:**
- Visual design & UX consistency (per `key-cover-expense.html`, `key-goals.html`, and `DESIGN.md`):
  - Sheet opens from right on desktop / bottom on mobile using existing `Sheet` primitive.
  - Interactive sliders ($0 to goal's current balance) paired with tabular numeric input fields.
  - Reason-based ordering and pre-fill from `proposeDrawdown`:
    - `large_purchase`: Emergency Fund pre-filled up to balance, then Flexible goals split proportionally, Protected locked behind warning.
    - `shortfall`: Flexible goals first proportionally, then Emergency Fund, Protected locked behind warning.
  - Protected goals gating: locked with lock icon and disabled slider/input until preceding tiers are at maximum or the user explicitly clicks "Use protected goals"; warning callout explains impact on arrival dates.
  - Footer display: "Left to cover" figure with warning color if > $0 and more eligible funds exist; "Confirm cover" button enabled when Left to cover is $0 OR when all currently eligible tiers are exhausted (allowing partial cover where remainder stays with buffer or flagged).
  - Undo experience: On confirmation, close sheet, show toast with summary and "Undo" action, and display a recent history row with an "Undo" link above goals.
  - Buffer divert alternative (D8): When a gradual shortfall exists and the active stage gives the buffer a share (> 0 bp), offer "Move $X/fortnight from the buffer" in the shortfall warning and inside the sheet; applying it creates/updates a time-boxed `goal_rule` override (`source: "shortfall_override"`) and offers Undo.
- Pool scoping & privacy isolation (AD-3, AD-22, AD-26):
  - A cover operation operates on a single pool ("shared" or personal). Partner personal goals and transactions are never shown, selectable, or affected.
- Data integrity & integer cents:
  - All financial amounts remain strictly integer cents.

**Never:**
- No automated background review item scanner (Story 7.7 detects large withdrawals and creates review inbox items; this story allows `CoverExpenseSheet` to accept optional initial withdrawal/shortfall params when opened from review items or page banners).
- Never allow slider or input to set negative amounts or exceed the goal's current balance.
- Never modify core allocation or reconciliation math.
- Mascot never appears in Cover an expense sheet or money warnings (per `DESIGN.md`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open Cover an expense (large purchase) | Click "Cover an expense" button; enter $5,000 | Fetches proposal; EF pre-filled up to balance; Flex goals split proportionally; Protected locked | Validation error if amount <= 0 |
| Open from shortfall banner | Goals exceed bank savings ($320 shortfall) | Shortfall warning banner shows "Goals are $320 ahead of what's in the bank"; clicking "Cover it" opens sheet in shortfall mode ($320 pre-filled) | No error |
| Buffer divert option present | Shortfall exists and active stage has buffer share > 0 bp | Banner & sheet display "Move $X/fortnight from the buffer" alternative | Hidden if stage buffer share is 0 bp |
| Toggle / apply buffer divert | User clicks "Move $X/fortnight instead" | Sets shortfall override rule; shortfall remains flagged with projected clear date; toast offers Undo | Invalidate query & show toast |
| Adjust slider / numeric input | User drags slider or types amount in input | Slider and input stay synchronized; "Left to cover" updates in real time; "Back to Pangolin's split" button appears if altered | Clamped between 0 and goal balance |
| Unlock Protected goals | Preceding tiers exhausted or user clicks "Use protected goals" | Protected tier unlocks; slider becomes interactive; warning displayed with arrival impact | Shows warning styling |
| Confirm cover (full or partial) | User clicks "Confirm cover" with valid adjustments | Calls `POST /api/planning/drawdowns`; closes sheet; refetches goals; displays toast with "Undo" button and history row | Shows inline error on failure |
| Undo cover | User clicks "Undo" in toast or history row | Calls `POST /api/planning/drawdowns/:id/undo`; balances revert immediately; review/shortfall status restores | Shows error if already undone |

</frozen-after-approval>

## Code Map

- `apps/web/src/api.ts` -- Add client endpoints: `fetchDrawdowns(pool)`, `proposeDrawdown(input)`, `executeDrawdown(input)`, `undoDrawdown(id)`, and `applyBufferDivert(input)`.
- `apps/server/src/http/app.ts` & `packages/app/src/planning/goals.ts` -- Provide buffer divert use case endpoint (`POST /api/planning/buffer-divert` and `POST /api/planning/buffer-divert/undo` or manage via `goal_rule` override).
- `apps/web/src/components/CoverExpenseSheet.tsx` -- NEW: Interactive cover expense sheet with sliders, numeric inputs, EF / Flexible / Protected tier sections, arrival date shifts, locked/unlocked Protected gating, Left to cover calculation, and confirm button.
- `apps/web/src/components/CoverExpenseSheet.test.tsx` -- NEW: Component tests verifying proposal rendering, slider adjustments, Protected unlocking, partial cover confirmation, and error displays.
- `apps/web/src/pages/GoalsPage.tsx` -- Update to render:
  - Header "Cover an expense" button.
  - Shortfall warning banner when pool is over-committed, offering "Cover it" and "Move $X/fortnight from the buffer" (when buffer share > 0).
  - Most recent drawdown history line with "Undo" link.
  - Toast for confirmed cover and buffer divert with Undo.
  - Mount `CoverExpenseSheet`.
- `apps/web/src/pages/GoalsPage.test.tsx` -- Add component tests for shortfall warning banner, opening Cover an expense sheet, executing cover, displaying undo toast, and undoing.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/planning/goals.ts` & `apps/server/src/http/app.ts` -- Implement buffer divert endpoint / use-cases to create and clear `shortfall_override` rules -- Enables time-boxed buffer divert option (D8).
- [ ] `apps/web/src/api.ts` -- Add API client functions for propose, execute, undo drawdowns, fetch drawdowns, and buffer divert -- Connects frontend to server drawdown and divert endpoints.
- [ ] `apps/web/src/components/CoverExpenseSheet.tsx` -- Implement interactive `CoverExpenseSheet` with sliders, number inputs, reason ordering, Protected gating, arrival previews, and Left to cover footer -- Core modal dialog for covering expenses.
- [ ] `apps/web/src/components/CoverExpenseSheet.test.tsx` -- Unit tests for `CoverExpenseSheet` slider behaviors, Protected warnings, and confirm button gating -- Ensures slider interactions and validations are solid.
- [ ] `apps/web/src/pages/GoalsPage.tsx` & `apps/web/src/pages/GoalsPage.test.tsx` -- Integrate Cover button, shortfall banner, CoverExpenseSheet, history line, and undo toast -- Delivers complete end-to-end user experience on Goals page.

**Acceptance Criteria:**
- Given a user on `/planning/goals`, when clicking "Cover an expense", then the sheet opens and displays proposed splits ordered by reason.
- Given an open `CoverExpenseSheet`, when moving sliders, then slider values and text inputs sync, and "Left to cover" updates dynamically.
- Given a proposal with Protected goals, when preceding tiers are not exhausted, then Protected goals are locked until the user explicitly unlocks them.
- Given a confirmed cover, when submitted, then a drawdown is recorded, the sheet closes, goal balances update immediately, and a toast offers Undo.
- Given a recent drawdown, when clicking "Undo" in the toast or history line, then the drawdown is undone and prior balances are restored.
- Given a pool with a gradual shortfall where the active stage gives the buffer a share, when viewing Goals, then the warning banner offers both "Cover it" and "Move $X/fortnight from the buffer".

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `apps/web/src/pages/GoalsPage.tsx` (lines 134-137): Hardcoded "shared" pool on drawdowns query and activeStage/clearBufferDivert in CoverExpenseSheet ignores personal pool when filterScope is personal.
  - Verdict: `medium`
  - Route: `patch`
  - Action: Dynamically scoped `drawdownsQuery`, `latestDrawdown`, `activeStage`, and `clearBufferDivert` to `activePool = filterScope === "personal" ? me.personId : "shared"`.

- `apps/web/src/pages/GoalsPage.tsx` (lines 477-480): showToast creates un-tracked setTimeout which can clear newer toasts prematurely or leak.
  - Verdict: `low`
  - Route: `patch`
  - Action: Maintained `toastTimerRef` to clear active timeout before scheduling new toasts.

- `apps/web/src/components/CoverExpenseSheet.tsx` (lines 663-668): Numeric currency input truncates to integer dollars on edit so users cannot enter cents.
  - Verdict: `medium`
  - Route: `patch`
  - Action: Supported decimal dollars and cents via `inputTexts` state, converting to integer cents on change while clamping to available balance.

- `apps/web/src/components/CoverExpenseSheet.tsx` (lines 448-464): Emergency fund warning compares against 20% of current balance rather than checking whether resulting balance falls below 80% or below target threshold.
  - Verdict: `medium`
  - Route: `patch`
  - Action: Updated calculation to compare post-cover balance against 80% of goal target `targetCents` (or 80% of current balance when target is unset).

- `apps/web/src/components/CoverExpenseSheet.tsx` (lines 274-281): initialTransactionId is not updated in useEffect when sheet re-opens with different initialTransactionId.
  - Verdict: `low`
  - Route: `patch`
  - Action: Added `initialTransactionId` synchronization inside sheet opening effect.

- `apps/web/src/components/CoverExpenseSheet.tsx` (lines 264-272): Locked protected amounts in userAmounts dictionary are not reset to 0 if protected is locked again or reason switches.
  - Verdict: `medium`
  - Route: `patch`
  - Action: Reset user amounts and input texts for protected goals when `!isProtectedUnlocked`.

- `packages/app/src/planning/goals.ts`, `goal-allocation.ts`, & Callers: Buffer divert date calculation should project shortfall clearance horizon based on shortfall amount and buffer rate rather than arbitrary 3 months, and standard allocation should filter to rule source.
  - Verdict: `medium`
  - Route: `patch`
  - Action: Added projected horizon calculation at $50/fortnight in `applyBufferDivert` and filtered stage rules to `source === "rule"` during standard allocation.

## Design Notes

- Sliders: Use HTML `<input type="range" min="0" max={balance} />` styled with Tailwind tokens (primary range, border track, circular thumb) paired with tabular numeric input formatted in integer dollars/cents.
- Toast: Use lightweight local toast state with timer (matching `useBulkSelection` pattern in `TransactionList.tsx`), rendering sticky at bottom right with "Undo" button.
- Arrival shift: Uses simple interpolation preview based on each goal's current allocation pace or "unchanged".

## Verification

**Commands:**
- `pnpm --filter @pangolin/app test` -- expected: domain unit tests pass.
- `pnpm --filter @pangolin/server test` -- expected: server route tests pass.
- `pnpm --filter @pangolin/web test` -- expected: web component tests pass including CoverExpenseSheet and GoalsPage.
- `pnpm typecheck` -- expected: monorepo TypeScript clean.
