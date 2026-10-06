---
title: 'A closed account locks after its closed date'
type: 'feature'
ticket: '23'
created: '2026-10-07'
status: 'built'
baseline_revision: '97ae1df6ae0feb8828a1c3057839f4ef54c1daf6'
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

**Problem:** `closeAccount` only sets `closedOn` and no ledger write looks at it (`close-account.ts:19`, `update-account.ts:74`), so a closed account keeps taking entries and can be closed before its latest entry. Simon decided on 2026-10-06 that a closed account is a historical record: data can be added and amended up to its closed date and is locked after it until the account is opened again.

**Approach:** One lock helper used by every person-initiated ledger write on a closed account, and a check in `closeAccount` and `updateAccount` that refuses a closed date earlier than the account's latest entry; both refusals are a `Conflict` that carries the choice (move the closed date, or move the manually entered entries' dates).

## Boundaries & Constraints

**Always:**
- An entry is locked when its `postedOn` is after the account's `closedOn`; a balance snapshot when its `asOf` is. Anything on or before `closedOn` stays editable. Clearing `closedOn` (reopening) lifts the lock.
- A write that sets a date after `closedOn` is refused, including a date change that moves an entry across `closedOn`. A date change that moves a later entry back to on or before `closedOn` is allowed.
- Splits, tags, hide and unhide, transfer groups and delete follow the entry's `postedOn`.
- The `Conflict` details are `{ accountId, closedOn, latestEntryDate, manualEntries: [{ id, postedOn }], importedCount }`. Manually entered means `importId` and `externalId` are both null, read from the stored columns, not the hidden-name projection. The server stays stateless; the client then calls `closeAccount` or `updateAccount` with the later date, or `updateTransaction` with an earlier one.
- Closing, or setting `closedOn`, earlier than the latest live entry or snapshot is refused with the same details.
- Invariant upkeep bypasses the lock with a test: decision 81's transfer unlink of a survivor, which may sit in a closed account. The system viewer is exempt (the seed, jobs); imports honour the lock through the handoff note in epic-import-dedupe-transfers.

**Never:** change privacy, hiding or owner rules; add a table or column; lock reads; touch entries 24 to 26's scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit before close | Closed account, entry on or before `closedOn` | Add, amend, delete, split, tag, hide allowed | none |
| Write after close | Entry dated after `closedOn` | Refused | Conflict with details |
| Date across | Move an entry from before to after `closedOn` | Refused | Conflict |
| Date back | Move a later (legacy) entry to on or before `closedOn` | Allowed | none |
| Close early | `closeAccount` with a date before the latest entry | Refused | Conflict with details |
| Reopen | `updateAccount` `closedOn: null` | Entries after the old date allowed again | none |
| Snapshot | `asOf` after `closedOn` | Refused | Conflict |
| Upkeep | Delete one side of a transfer whose survivor is on a closed account | Survivor unlinked | none |
| System | Seed or job writes on a closed account | Allowed | none |

</frozen-after-approval>

## Code Map

- `packages/app/src/ledger/` -- new `closed-lock.ts` with `requireOpenOn(account, date, details)`; used in `create-transaction.ts:43-65` (account in hand, new `postedOn`), `update-transaction.ts:49-86` (load the account with `tx.accounts.findVisible(ctx.viewer, before.accountId)`; old and new `postedOn`), `delete-transaction.ts:28-33` (the deleted `before` row only, never the survivors at `:43-85`), `set-splits.ts:81`, `set-split-field.ts:115`, `split-tags.ts:38`, `hide-name.ts:85,118`, `transfer-groups.ts:40-41,90-96` (each by `before.postedOn`; `split-targets.ts:47` `privateOwner` already loads the account).
- `packages/app/src/accounts/balance.ts:39-57` (`recordBalanceSnapshot`, `asOf`), `close-account.ts:24-33`, `update-account.ts:74-83` -- the snapshot lock and the early-close check.
- `packages/app/src/ports/unit-of-work.ts:418-496` (`TransactionRepo`) -- add viewer-first reads `latestPostedOn(viewer, accountId)` and `listManualAfter(viewer, accountId, day)` (plus the imported count), reading stored columns; `packages/db/src/ledger-repos.ts` (model on `softDelete` ~:415, `liveVisibleTxn`) and `packages/app/src/testing/memory-uow.ts:849`; `latest` snapshot date from the existing `balanceSnapshots.listVisible` (`:545`).
- `packages/app/src/errors.ts:18-27` (`AppError` details), example `accounts/set-privacy.ts:84-106`.
- Tests: `ledger.test.ts`, `splits.test.ts`, `hidden-names-transfers.test.ts` (the survivor case at "deleting one side of a transfer"), `packages/db/src/accounts.test.ts`, `ledger-repos.test.ts`, `testing/repo-parity.test.ts` and `accounts-parity.test.ts`, `apps/server/src/http/app.test.ts` (accounts, transactions, errors); `privacy-harness.ts:729-750` records snapshots and closes accounts, check the order against the lock.
- Do not change: `seed.ts` callers (system), `set-privacy.ts`, `hide-name.ts` rules.

## Tasks & Acceptance

**Execution:**
- [ ] `ports/unit-of-work.ts`, `db/ledger-repos.ts`, `memory-uow.ts` -- the two reads; parity step
- [ ] `ledger/closed-lock.ts` and the eight ledger use cases, `accounts/balance.ts` -- apply the lock; system viewer exempt; survivors unchecked
- [ ] `close-account.ts`, `update-account.ts` -- refuse a closed date before the latest entry or snapshot, with the details
- [ ] tests -- the matrix over HTTP and in the use-case, repository and parity suites; update tests and the privacy harness that write after a close

**Acceptance Criteria:**
- Given a closed account, when entries and snapshots are written on both sides of `closedOn`, then only those after it are refused, with the details.
- Given an early close, when `closeAccount` runs, then it is refused with the later date and the manual entries, and succeeds with the later date.
- Given reopening, when `closedOn` is cleared, then later entries are accepted.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 1, low 8 patched, 10 rejected, false 1, maybe-false 0. The verification lens deleted the unhide check and no test failed.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| The lock on `unhideTransactionName` is unpinned: deleting the check fails no test (VG) | medium | patch | Mutation run on `hide-name.ts:126`; add the refused-unhide test. |
| A no-op `setSplits` on a locked entry throws while the sibling writes return unchanged (edge) | low | patch | Move the check after the unchanged early return. |
| A snapshot that blocks closing gives no choice: `manualEntries` is empty and the message points at transactions; the message omits reopening (blind) | low | patch | Add `latestSnapshotAsOf` and name all three ways out. |
| `updateTransaction` comment says "can only move back"; weak db and parity assertions (blind) | low | patch | Wording, one test, and two stronger assertions. |
| `findVisible` undefined makes `requireEntryOpen` fail open (edge) | low | rejected | A transaction is visible only through its account's visibility, so an invisible account cannot reach it. |
| Moving `closedOn` later but before the latest entry is refused (edge) | low | rejected | The plan says a closed date earlier than the latest entry is refused; stepwise improvement is a clearer story than the rule. |
| A plain close with no date is refused when a future-dated entry exists (edge) | low | rejected | The Conflict names the latest date; the client closes there. |
| `deleteTransferGroup` refuses a locked member while `deleteTransaction` unlinks a locked survivor (blind, edge) | low | rejected | The plan locks each side by its date and exempts decision 81's upkeep only. |
| Hide and unhide are locked though they only change a person's view (blind, edge) | low | rejected | The entry names hide and unhide; Simon's decision is that nothing changes after the closed date. |
| Newest-first snapshot order assumed; other write paths unguarded; no completeness test; index unchecked; system exemption repeated; long comment lines (blind, VG) | low | rejected | The port documents the order; classification writes touch no dated row; biome passes; the rest is style or speculation. |
| Dates compared as strings (edge) | false | rejected | Dates are validated `YYYY-MM-DD` on input and stored canonical. |
| No screen consumes the choice; only one HTTP test (intent, blind) | low | rejected | The screens are epic-ledger-workspace's, per its handoff note; the other routes are tested at use-case level. |

## Design Notes

The lock is about the entry's date, not the person: an entry before the closed date stays editable by either owner. The `Conflict` carries up to 20 manual entries and the count of imported ones, so a client can offer "move these" or "move the closed date" without a second request.

## Verification

**Commands:**
- `pnpm vitest run` -- expected: pass; `pnpm lint` and `pnpm typecheck` -- expected: clean
