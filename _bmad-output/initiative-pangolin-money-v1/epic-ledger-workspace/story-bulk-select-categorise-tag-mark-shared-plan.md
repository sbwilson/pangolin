---
title: 'Bulk select: Categorise, Tag, Mark shared'
type: 'feature'
ticket: '12'
created: '2026-10-08'
baseline_revision: 'e19988aa9825aaec1b6da399c3d472cc7a454dd8'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The transactions table allows single-row editing, but managing transactions in volume is tedious because users cannot bulk select items to categorise them, apply tags, or mark them shared across accounts.

**Approach:** Introduce desktop bulk selection on the transactions list with a page-level header checkbox, row checkboxes, Shift-click range selection, and Esc dismissal. When rows are selected, render a bulk actions toolbar in place of the summary line with Categorise, Tag, and Mark shared actions, applied per row via `setSplitField` and `setSplitTags` with partial-failure reporting, private-account refusal naming, and an Undo toast.

## Boundaries & Constraints

**Always:**
- The header checkbox selects rows of the currently loaded page only.
- On phone viewports (< md breakpoint, e.g. 375 px), bulk selection is hidden; the table reflows cleanly down to 320 px without horizontal page scroll (WCAG).
- Clicking a row checkbox selects or deselects without opening the transaction sheet.
- Keyboard interaction supports Space/Enter toggle on checkboxes, Shift-click range selection, and Esc to clear selection.
- Bulk actions apply per row via `setSplitField` (category, beneficiary: `shared`) and `setSplitTags` (tags).
- When `Mark shared` encounters private-account rows (AD-7), it refuses them, updates only the shared-account rows, leaves private-account rows unchanged, and explicitly names each refused row in the error/notice report.
- A failure on any row (e.g. forced failure or server rejection) applies the remaining rows and reports the failed row by description.
- Undo re-applies prior values per row via `setSplitField` / `setSplitTags` (provenance `source: user`), invalidates queries, and confirms restoration.
- Popovers and toasts are constructed using plain HTML elements with Tailwind CSS classes (no inline styles, no external UI library dependencies, compliant with CSP).

**Never:**
- Allow `Mark shared` to mutate private-account rows or bypass AD-7.
- Add external popover, dialog, or toast libraries (e.g. Radix).
- Perform client-side money arithmetic.
- Show bulk selection checkboxes or toolbar on phone viewports (< 768 px).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Header checkbox select-all | Click header checkbox when unchecked | All loaded page rows become selected; header checkbox becomes checked; toolbar displays "N selected" | None |
| Indeterminate header checkbox | Subset of page rows selected | Header checkbox displays indeterminate dash; clicking selects all loaded page rows | None |
| Shift-click range | Select row A, Shift-click row D | Rows between A and D inclusive become selected | None |
| Esc key clear | Selection active, press Esc | Selection cleared; summary line returns | None |
| Bulk categorise | Rows selected, pick category in combobox | `setSplitField` called per row for category; rows update; toast shows count with Undo button | Partial failures reported by row |
| Bulk tag | Rows selected, choose tags in picker | `setSplitTags` called per row; rows update; toast shows count with Undo button | Partial failures reported by row |
| Bulk mark shared | Shared-account rows selected, click Mark shared | `setSplitField` called per row with beneficiary `shared`; toast shows count with Undo button | None |
| Mark shared on private account | Selection contains shared and private rows | Shared rows updated; private rows unchanged; notice names each refused row | Refused rows named in notice |
| Forced row failure | 3 rows selected, 1 row fails write | 2 successful rows updated; 1 failed row reported by row description; Undo available for successful rows | Failed row named in notice |
| Undo bulk action | Click Undo button on toast | Prior values re-applied via API; transactions cache updated; toast confirms undo | Undo failure reported in notice |
| Phone width (375 px) | View transactions at 375 px viewport | Checkbox column and bulk toolbar hidden; no selection controls visible | None |
| Reflow width (320 px) | View transactions at 320 px viewport | Table reflows with truncation; no horizontal page scroll (WCAG) | None |

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/TransactionsTable.tsx` -- Update header with page-select checkbox (`checked`, `indeterminate`, `onChange`), row checkboxes with selection state and Shift-click range support, stopPropagation on row checkboxes to prevent opening `TransactionSheet`, and preserve `WIDE = "hidden md:table-cell"` on checkbox cells.
- `apps/web/src/pages/TransactionList.tsx` -- Manage `selectedIds: Set<string>` and anchor index for range selection, listen for `Escape` key, replace summary line with bulk action toolbar (`Categorise`, `Tag`, `Mark shared`, `Clear`), implement per-row execution with error accumulation and partial success handling, and render toast notification with Undo action.
- `apps/web/src/components/ui/category-combobox.tsx` -- Reuse `CategoryCombobox` within a plain popover container for bulk category assignment.
- `apps/web/src/components/ui/tag-picker.tsx` -- Reuse `TagPicker` within a plain popover container for bulk tag assignment.
- `apps/web/src/api.ts` -- Existing `setSplitField` and `setSplitTags` endpoints used for writes and undo restoration.
- `apps/web/src/pages/TransactionList.test.tsx` -- Unit and component tests for keyboard selection, Shift-click range selection, Esc clearance, bulk categorise, bulk tag, mark shared with private-account refusal reporting, forced single-row failure, and Undo.
- `e2e/ledger.spec.ts` -- End-to-end tests verifying bulk selection, bulk categorise, bulk tag, mark shared with private-account row refusal naming, Undo restoration, 375 px phone hiding, and 320 px zero horizontal scroll.
- Do not change: `packages/app/src/ledger/set-split-field.ts`, `apps/server/src/http/app.ts`, server routing, or privacy rules.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/pages/TransactionsTable.tsx` -- Add controlled header checkbox with indeterminate support, controlled row checkboxes with Shift-click range selection, and ensure click does not open sheet.
- [x] `apps/web/src/pages/TransactionList.tsx` -- Add selection state, Esc listener, bulk toolbar replacing summary line, bulk categorise popover, bulk tag popover, mark shared execution, partial-failure and private-account error reporting, and toast with Undo.
- [x] `apps/web/src/pages/TransactionList.test.tsx` -- Add component tests for selection, Shift-click, Esc, bulk actions, partial failure, private account refusal naming, and Undo.
- [x] `e2e/ledger.spec.ts` -- Add e2e tests covering bulk select, bulk actions, private account refusal naming, Undo, 375 px mobile check, and 320 px horizontal scroll check.

**Acceptance Criteria:**
- Given a loaded transactions page on desktop, when the header checkbox is clicked, then all rows on the loaded page are selected and the bulk toolbar replaces the summary line.
- Given some rows selected, when row checkbox is Shift-clicked, then all rows between the anchor and target row are selected.
- Given an active selection, when the Escape key is pressed, then the selection is cleared and the summary line is restored.
- Given a selection containing shared-account and private-account rows, when Mark shared is applied, then shared-account rows are updated to shared, private-account rows remain unchanged, and each refused private row is named in the notice.
- Given a forced failure on one row during a bulk action, when executed, then the remaining rows are applied and the failed row is reported by description.
- Given a completed bulk action, when Undo is clicked in the toast, then the previous category, tags, or beneficiary values are re-applied and the list reflects the restored state.
- Given a viewport width of 375 px, when `/transactions` is loaded, then no bulk selection checkboxes or toolbar are displayed.
- Given a viewport width of 320 px, when `/transactions` is loaded, then there is no horizontal page scroll.

## Implementation Notes

- Added desktop bulk selection controls to `TransactionsTable.tsx`: controlled header checkbox with indeterminate ref synchronization, row selection checkboxes with `stopPropagation` to prevent sheet toggle, and range Shift-click logic.
- Built bulk action toolbar in `TransactionList.tsx` replacing summary line on desktop: Categorise (combobox popover), Tag (tag-picker popover with cancel/apply), Mark shared (updates beneficiary to 'shared' while catching and reporting private-account refusal per AD-7), and Clear button.
- Per-row execution accumulates errors, continues executing remaining rows, updates query cache via `replaceTransaction` and invalidation, and presents toast with Undo capability.
- Undo restores prior split values with `source: 'user'` and updates local query cache and server.
- Verified responsive behavior: bulk select controls hidden on mobile (< 768 px), no horizontal scroll at 320 px.
- 13/13 tests in `TransactionList.test.tsx` pass; all 103 `apps/web` tests pass; all typechecks and Biome checks pass.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 5 patched, low 8 patched, false 2 rejected, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| CategoryCombobox in bulk toolbar popover lacks onDismiss, trapping floating popover on Escape | medium | patch | Pass `onDismiss={() => setActivePopover(null)}` to `CategoryCombobox`. |
| Toast auto-dismiss timer fires during Undo execution and concurrent Undo double-clicks trigger duplicate requests | medium | patch | Clear `toastTimer` on Undo click, add `isUndoing` guard (with disabled button) and `isBusy` bulk actions guard. |
| Unapplied writes (`res.applied === false`) treated as successful in bulk actions and scheduled for undo | medium | patch | Throw `new Error(res.reason ?? KEPT_MESSAGE)` on `!res.applied` to record failure instead of false success. |
| Mixed private/shared mark-shared e2e test ends without asserting shared rows toast and Undo restoration | medium | patch | Extend `e2e/ledger.spec.ts` test to assert toast count, trigger Undo, and assert `"Restored previous values"`. |
| Category and tag DOM updates on table rows not asserted after bulk apply or undo | medium | patch | Assert row category chip text in both unit and e2e test after bulk categorise and undo. |
| Empty splits array on transaction triggers invalid split mutation with synthetic ID `"s1"` | low | patch | Skip transactions with 0 splits (`if (txn.splits.length === 0) continue;`). |
| Uncommitted tag selections in TagPicker persist across popover dismissals | low | patch | Reset `bulkTags` state to empty on popover dismissal, Escape, and selection clearance. |
| Indeterminate header checkbox lacks `aria-checked="mixed"` attribute for screen readers | low | patch | Add `aria-checked={isIndeterminate ? "mixed" : isAllSelected}` to header checkbox input in `TransactionsTable.tsx`. |
| Beneficiary changes via Mark shared and Undo do not invalidate `["accounts"]` query cache | low | patch | Add query invalidation for `["accounts"]` and `["ledger", "accounts"]` on beneficiary updates. |
| Escape key closing bulk popovers while preserving row selection is unverified by tests | low | patch | Add unit test in `TransactionList.test.tsx` verifying popover dismissal with preserved selection. |
| Undo API failure error alert rendering is unverified by tests | low | patch | Add unit test in `TransactionList.test.tsx` simulating Undo API rejection and verifying `role="alert"`. |
| Bulk toolbar "Clear" button is unverified by tests | low | patch | Add unit test in `TransactionList.test.tsx` asserting selection clearance via toolbar Clear button. |
| Filter or search navigation clearing selection is unverified by tests | low | patch | Add unit test in `TransactionList.test.tsx` asserting selection clearance upon search param change. |
| Shift-click range selection updates anchor index on each click | false | rejected | Standard checkbox table range selection sets the pivot to the last clicked row; behavior matches expectation. |
| Popover lacks outside-click listener | false | rejected | Floating popovers cleanly dismiss via Escape, Cancel, or selecting options; outside-click listener not specified. |


## Design Notes

- The bulk action toolbar renders in place of the summary line (`<div className="bulk" role="toolbar" aria-label="Bulk actions">`) styled with `bg-accent text-primary rounded-md px-3 py-1.5 flex items-center gap-2`.
- Checkboxes in `TransactionsTable`: the header checkbox sets `ref.current.indeterminate = true` when `0 < selectedCount < totalPageCount`.
- Range selection tracks `lastClickedIndex` within the loaded page. When Shift-click occurs on row `index`, all rows between `min(lastClickedIndex, index)` and `max(lastClickedIndex, index)` are added to the selection set.
- Undo records snapshot array `{ transactionId, splitId, previousCategory, previousTags, previousBeneficiary }` for all rows where the write succeeded. When Undo is clicked, writes are reverted via `setSplitField` or `setSplitTags` with `source: user`.
- Error reporting: if any row rejects with `AppError` or server 400 (such as "A private account's splits belong to its owner"), the row's description is added to a list of refused/failed rows and displayed in the page status notice (`role="alert"`).

## Verification

**Commands:**
- `pnpm vitest run apps/web/src/pages/TransactionList.test.tsx` -- expected: all component tests pass
- `pnpm -r typecheck` -- expected: clean with no type errors
- `pnpm lint` -- expected: clean with no lint errors
- `pnpm test:e2e` with `E2E_SEED_COMMAND` -- expected: ledger e2e suite passes
