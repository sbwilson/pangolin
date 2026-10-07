---
title: 'Transaction sheet: splits, tags, notes, beneficiary and hiding'
type: 'feature'
ticket: '3'
created: '2026-10-07'
baseline_revision: '8bdec603f11c72d87cd7e80e3ac48b0b69cd8322'
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

**Problem:** The transactions list is read-only: a household cannot split a transaction, categorise, tag, annotate, set a beneficiary or hide a name from the browser, although the server API for all of it exists.

**Approach:** A transaction sheet (bottom sheet at phone width) opened from a list row edits splits, category, tags, notes, beneficiary and name hiding through the existing ledger API, and the row's category chip edits inline through the same category combobox. Every write returns the full transaction with the server's `remainingCents`, which the sheet shows.

## Boundaries & Constraints

**Always:**
- The web never sums money: the remaining amount is the server's `remainingCents`; the split editor sends amounts and shows what comes back.
- Writes use the existing routes only: `PATCH /api/ledger/transactions/:id` (notes), `PUT .../:id/splits`, `PATCH .../:id/splits/:splitId` (`setSplitField`, category and beneficiary), `PUT .../:id/splits/:splitId/tags`, `PUT`/`DELETE .../:id/name-hidden`. A `setSplitField` reply with `applied:false` is shown as "Kept: a higher-ranked source set this".
- Decided by Simon, 2026-10-07: the sheet, category combobox and tag picker are built from plain elements with no inline styles and no new UI dependency; the CSP nonce wiring stays deferred (`deferred-work.md`). Component tests run under `jsdom` with `@testing-library/react` as new dev dependencies and a per-file `@vitest-environment` docblock.
- The hide-name toggle warns that notes stay visible. The owner sees a "Hidden from <partner> until <date>" tag; the partner's row reads accessible name "Hidden until 12 March 2027" (long month, formatted by the web from `nameHiddenUntil`) with the wink line as its description.
- Beneficiary options are shared, me and `me.partner`. The category combobox and tag picker are standalone components that entry 12 reuses.

**Never:** build bulk select, search, the CSP nonce wiring, Radix or any popover library, a client-side money sum, or new server routes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Category via sheet or chip | Pick a category | `setSplitField` called, row and sheet show the returned transaction | `applied:false` shows the kept message |
| Split edit | Two splits entered | `setSplits` called; remaining is the server's | Validation 400 shown inline |
| Hide name (owner) | Toggle on with a date | Owner sees "Hidden from <partner> until <date>" | Private account or non-owner: server message shown |
| Partner view | Hidden row | Wink row, name "Hidden until 12 March 2027", description is the wink line | none |
| Phone | 375 px | Sheet opens from the bottom | none |

</frozen-after-approval>

## Code Map

- `apps/web/src/api.ts:259-302` -- `LedgerSplit` and `LedgerTransaction` are narrow hand-written types; widen with categoryId, tags, notes, nameHidden, nameHiddenBy, nameHiddenUntil, remainingCents, sources. Add PATCH/PUT/DELETE JSON helpers, mutation fetchers, `fetchTags` (`GET /api/classify/tags`), and category groups for `fetchCategories`.
- `apps/web/src/pages/TransactionsTable.tsx` (`Row`, ~l.62), `TransactionsPage.tsx` -- open the sheet, inline category chip, owner tag and partner wink row.
- `apps/web/src/components/ui/` -- has button, date-input, select, table only; add sheet, combobox, tag picker here.
- Server, read-only reference: `apps/server/src/http/app.ts:322-368`, `packages/app/src/ledger/{update-transaction,set-splits,set-split-field,split-tags,hide-name}.ts`, `redact.ts` (partner label uses a short month, so the web formats its own).
- Tests: `e2e/ledger.spec.ts` (~l.291-325 owner and partner views), `routing.spec.ts`; web unit beside `api.test.ts`.
- Do not change: `redact.ts`, server routes, the read rule.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/api.ts` -- widen types, add mutation and tag fetchers
- [ ] `apps/web/src/components/ui/` -- sheet, category combobox, tag picker
- [ ] `apps/web/src/pages/` -- transaction sheet (splits, notes, beneficiary, hide toggle), row wiring, chip edit, wink row
- [ ] tests -- component or e2e per edit, hidden owner/partner case, chip edit, 375 px bottom sheet

**Acceptance Criteria:**
- Given a hidden transaction, when owner and partner list it, then the owner sees the "Hidden from <partner> until <date>" tag and the partner the wink row named "Hidden until 12 March 2027".
- Given a split edit, when saved, then the remaining amount shown is the server's.
- Given 375 px, when a row is opened, then the sheet opens from the bottom.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 4 patched, 4 low patched, 1 deferred, 19 rejected, false 2.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Notes, tags, hide/unhide, fetchTags and fetchCategories writes have no URL/method/body test (VG) | medium | patch | Sheet tests mock `api.ts`; add `api.test.ts` cases. |
| Escape in an open category list inside the sheet is untested (VG) | low | patch | `stopPropagation` exists but nothing pins it; add a test. |
| Pressing the listbox container or scrollbar blurs the input and closes the list (blind, edge) | medium | patch | Only options carry `onMouseDown` preventDefault; move it to the container. |
| Inline chip edit skips the invalidate that closing the sheet does, leaving filter membership and summary stale (blind, edge) | medium | patch | `changeCategory` only calls `replaceTransaction`. |
| Categories not loaded: `[]` makes a categorised split read "Uncategorised" (edge) | medium | patch | `categories.data ?? []` reaches `CategoryCell`. |
| `hidingActive` compares a UTC end day with the local day (edge, blind) | low | patch | `localDay(new Date())` versus the server's UTC date. |
| Stale `refusedRemaining` beside an unrelated error; misleading `setField` comment (edge, blind) | low | patch | `run` never clears it. |
| Owner's "Hidden from <partner> until <date>" tag appears only in the sheet, not on the list row the Code Map names (edge) | low | patch | `TransactionsTable` shows plain `descriptionRaw` for the owner. |
| Split, tag, note, beneficiary and hide edits have no e2e test against the real server (intent-alignment, VG) | medium | defer | Component tests cover each with mocked writes; e2e cannot run here (no docker). Unverified: real-route behaviour of those writes under Playwright. |
| ArrowDown on an empty list gives active -1 (edge) | false | rejected | `aria-activedescendant` is only set when `shown.length > 0`; nothing reads -1. |
| Partner sees editing controls on a hidden row (VG) | false | rejected | Shared-account edits are the server's rule; the toggle is the only owner-only control and it is disabled. |
| Unsaved drafts lost on close; no modal inert/scroll lock; focus restore to unmounted row; `longDay` on malformed date; hide date has no max; two quick chip edits; page notice never clears; drafts drift after other writes; non-JSON 2xx; two-request `fetchCategories`; e2e restore not in `finally`; empty-group key (blind, edge) | low | rejected | Unlikely in everyday use and each fix adds guards or branches. |
| Plan file's tasks and notes unfinished (blind) | low | rejected | Process state, filled at step 5. |

## Verification

**Commands:**
- `pnpm vitest run`, `pnpm lint`, `pnpm -r typecheck` -- expected: clean
- `pnpm test:e2e` with `E2E_SEED_COMMAND` -- expected: ledger spec passes
