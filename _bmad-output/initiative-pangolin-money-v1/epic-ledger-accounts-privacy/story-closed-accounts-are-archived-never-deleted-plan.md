---
title: 'Closed accounts are archived, never deleted'
type: 'feature'
ticket: '25'
created: '2026-10-07'
baseline_revision: '31ddc1925ca7a5322d9b6d7ff3758cc53f5ef851'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A closed account is still mixed into the account list, and nothing says a closed account is kept as a read-only record and never deleted. Simon decided on 2026-10-06 that closing is the soft delete: closed accounts are archived, not deleted.

**Approach:** The account list read model leaves closed accounts out by default and includes them on request; `closedOn` is the only archive state. A test asserts that no route or use case deletes an account.

## Boundaries & Constraints

**Always:**
- Closed means `closedOn !== null && closedOn <= today` (by the clock): its closed date has come, so the ledger refuses later entries (`ledger/closed-lock.ts`). An account with a future `closedOn` is still open and stays in the default list until that date (decision, Simon, 2026-10-07). Archived is closed: no new state, column or migration.
- `listAccounts` takes `includeClosed` (boolean, default false). The default result is open accounts only; with `includeClosed` it is every account the viewer can see, oldest first, as today. `GET /api/accounts` passes it from the query `includeClosed=true`; any other value or none means false.
- A closed account keeps its transactions, balance snapshots, owners and audit rows, and `getAccount`, the transaction and balance reads still answer for it. Reopening (`updateAccount` with `closedOn: null`) returns it to the default list.
- The visibility rule is unchanged: a partner who cannot see a private account never sees it, closed or not, with or without `includeClosed`.

**Never:** add a delete route or use case for an account; change the closed-date lock, the closing-balance warning, privacy or owner rules; build screens or pickers (handoff to epic-app-shell-settings-theming and epic-ledger-workspace); change the repository ports.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default list | One open, one closed account | Only the open one | none |
| On request | `includeClosed: true` | Both, closed one with its `closedOn` | none |
| Record intact | Closed account with entries, snapshots | Transactions, balance and audit rows read as before | none |
| Reopen | `closedOn` cleared | Back in the default list | none |
| Future close | `closedOn` after today | Still in the default list; archived once `closedOn` is today or earlier | none |
| Private | A's private account closed | B's default and `includeClosed` lists never hold it | none |
| No delete | Every registered route and the app's exports | No account delete route or use case | none |
| Bad input | `includeClosed: "yes"` use case input | Rejected by `parseInput` | `Validation` error as for other inputs |

</frozen-after-approval>

## Code Map

- `packages/app/src/accounts/list-accounts.ts` (`listAccountsInput`, `listAccounts`) -- add `includeClosed: z.boolean().optional()`, filter `isArchived(row)` (`closedOn !== null && closedOn <= ctx.clock.today().toString()`) before `viewOf` (so closed rows cost no owner or balance reads); update the JSDoc: the list holds open accounts, and a closed account's closing-balance `warning` shows only with `includeClosed`, on `getAccount` and in the review item. `getAccount` stays as is.
- `apps/server/src/http/app.ts:389` (`GET /api/accounts`) -- pass `includeClosed: c.req.query("includeClosed") === "true"`. Only `/api/accounts/:id/*` write routes exist; none deletes.
- `packages/app/src/index.ts` -- exports `listAccounts` types; nothing to add unless a type is exported.
- Tests: `packages/db/src/accounts.test.ts` (use case on SQLite: default, on request, intact record, reopen, bad input), `packages/app/src/testing/accounts-parity.test.ts` (memory mirror equals SQLite for the same flow; pattern at ~line 536), `apps/server/src/http/app.test.ts` (`/api/accounts` and `?includeClosed=true`; the no-delete route test via the routes Hono exposes on the app: scan every route, assert none with method `DELETE` or `ALL` has `account` in its path, and that some `DELETE` route exists so the scan is live), `apps/server/src/privacy/privacy.test.ts` (~line 686: the closed private account is absent from B's `includeClosed` list in both worlds; A's delta in `privacy-harness.ts` already closes `closed` and `flip`), and `privacy-scenarios.ts:347` (add `/api/accounts?includeClosed=true` to the sweep's read paths so closed private accounts stay probed), and a test that `@pangolin/app` exports no account delete use case (`import * as app` keys; match a delete verb (`delete|remove|purge|destroy|drop|erase`) and `account` in either order, and assert the guard is live).
- Test dates: today is the test clock's; use a past `closedOn` for closed and a future one for the future-close row. Assert ids by set or sort, never by creation order (`list` ties break by random id).
- Existing tests that list closed accounts through `listAccounts` (`accounts.test.ts:629`, `accounts-parity.test.ts:533`, `privacy.test.ts:697`) need `includeClosed: true`.
- Do not change: `ports/unit-of-work.ts`, `db/src/ledger-repos.ts`, `memory-uow.ts`, migrations, `closing-balance.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/accounts/list-accounts.ts` -- `includeClosed` input and filter -- the archive is a view, not a state
- [ ] `apps/server/src/http/app.ts` -- read `includeClosed` on `GET /api/accounts` -- request for closed accounts over HTTP
- [ ] existing closed-account list assertions -- pass `includeClosed: true`
- [ ] tests -- the matrix at use-case, parity and HTTP level; the no-delete assertions; the privacy-suite case

**Acceptance Criteria:**
- Given a closed account with entries and audit rows, when the default list is read, then it is absent; when `includeClosed` is asked for, then it is present and its transactions and audit rows are intact.
- Given it is reopened, when the default list is read, then it is back.
- Given the app's routes and exports, when a test scans them, then nothing deletes an account.
- Given A's private closed account, when B lists with or without `includeClosed`, then it never appears, and B's responses are the same in both privacy worlds.

## Implementation Notes

## Plan Change Log

Loopback 1 (intent_gap, 2026-10-07): review found that a future `closedOn` hid a still-writable account. Simon chose `closedOn <= today`; the frozen block and matrix now say so. Code from pass 1 was reverted and is re-derived; its saved diff is only a reference. Review patches folded into the Code Map: wider no-delete scan with a liveness check, the privacy sweep's `includeClosed` path, the JSDoc, and order-independent assertions. Known-bad state avoided: hiding an account on a future `closedOn`.

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Verdicts below; the intent_gap entry triggers a loopback, so the patch rows are carried until it is resolved.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| An account closed on a future date vanishes from the default list at once, though the ledger accepts entries until `closedOn` (blind, edge) | medium | intent_gap | `closeAccount` has no upper bound on `closedOn` (`requireDatesInOrder` checks only the opened date) and `closed-lock.ts` locks only dates after `closedOn`; the frozen block says closed is `closedOn !== null` without settling a future date. Two readings. |
| Route no-delete scan covers only `/api/accounts*` and has no liveness check; the export regex is anchored on a leading verb (blind, edge, verification-gap) | medium | patch (carried) | `app.test.ts` filters on the prefix; a `DELETE /api/ledger/accounts/:id` would pass. Scan every route, assert some `DELETE` exists, match the verb and `account` in either order. |
| The privacy sweep (`privacy-scenarios.ts:347`) probes `/api/accounts` only, so A's closed private accounts are no longer in it (verification-gap, edge) | low | patch (carried) | Both closed delta accounts are now filtered from the default list; add `/api/accounts?includeClosed=true` to the sweep's read paths. |
| JSDoc says "open accounts" and also "a `warning` for a closed cash account" (blind, edge) | low | patch (carried) | The warning only shows when closed accounts are included, on `getAccount` and in the review item; reword. |
| `toEqual([open, closed])` relies on `createdAt` ties breaking by id (blind) | low | patch (carried) | `list` orders by `createdAt` then `id`; with a fixed test clock the id decides. Assert set membership or sort. |
| The `removal` marker on a closed public account is hidden by default (blind, edge) | low | rejected | Reachable with `includeClosed` and `getAccount`; a closed account the viewer was taken off is rare and a fix adds a guard. |
| Warning invisible in the default list (edge) | false | rejected | Intended by the plan: the warning rides on `includeClosed`, `getAccount` and the review item. |
| `includeClosed` parsing is lenient over HTTP (`TRUE`, `1`) (blind, edge) | low | rejected | The frozen block decides only `true` counts; a stricter parser is added complexity. |
| Other `listAccounts` callers not audited; `privacy-harness.ts:548` (blind, edge, intent) | false | rejected | Searched: the only non-test callers are `app.ts` and the harness, which looks up open joint accounts. |
| No-delete guard does not inspect repository ports or the database (blind, edge) | low | rejected | The intent says route or use case; ports are out of the plan. |
| Plan file state, checkbox and line-number rot, no web client change (blind, intent) | false | rejected | Not code; the plan's Never excludes screens. |

Pass 2 (thorough, after loopback 1). Counts: high 0, medium 0, low 1 patched, 9 rejected, false 2, maybe-false 0. The pass-1 patch rows were re-derived into the code and checked there: the scan covers every route with a liveness check, the export match runs either order, the JSDoc is reworded, ids are compared sorted.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| The switch scenario's `/api/accounts?includeClosed=true` read sees no closed row, since the scenario never closes an account; the HTTP paired-world check of the closed private account is missing (VG) | low | patch | `grep close` over `privacy-scenarios.ts` finds nothing; closing in the scenario would lock its later steps. Remove the path and add the paired HTTP check beside the use-case one in `privacy.test.ts`. |
| An account closed today is archived while entries dated today are still accepted (edge, blind) | low | rejected | Simon chose `closedOn <= today`; the lock refuses only later dates, which the doc says. One day, no data harm. |
| `includeClosed` is lenient over HTTP (`TRUE`, `1`, repeats) (blind, edge, intent) | low | rejected | Carried: the frozen block decides only `true` counts. |
| The `removal` marker on a closed public account is hidden by default (edge) | low | rejected | Carried. |
| Dates compared as strings; clock zone (edge, blind) | false | rejected | `dayInput` validates `YYYY-MM-DD`, and `closeAccount` and the lock compare the same way with `clock.today()`. |
| `privacy-harness.ts:548` and other callers not audited (blind, edge, VG, intent) | false | rejected | Carried: the harness looks up open joint accounts; no web consumer exists. |
| No-delete guards are name-based, miss ports, `POST .../remove` (blind, VG, intent) | low | rejected | Carried: the intent says route or use case; ports are out of scope. |
| Thin interactions (removal marker, review item on reopen, the boundary day through HTTP), a fixed clock not stated, a long JSDoc, a duplicated loop (blind) | low | rejected | The marker and item are carried or story 24's; style only. |
| No UI toggle, API docs or cache-header test for the query (blind) | low | rejected | The plan's Never excludes screens; the route's no-store applies to every `/api` response. |

## Design Notes

The future-close rule needs `ctx.clock.today()`, as `closeAccount` already uses. Filtering before `viewOf` keeps the closing-balance warning query off the default list. `getAccount` by ID still returns a closed account: archived records stay readable.

## Verification

**Commands:**
- `pnpm vitest run` -- expected: pass; `pnpm lint` and `pnpm typecheck` -- expected: clean
