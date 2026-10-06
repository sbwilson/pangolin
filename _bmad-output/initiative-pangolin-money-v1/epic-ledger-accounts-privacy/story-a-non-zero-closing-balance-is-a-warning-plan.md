---
title: 'A non-zero closing balance is a warning'
type: 'feature'
ticket: '24'
created: '2026-10-07'
status: 'built'
baseline_revision: 'bf81e3e817d3960f82ac2b9df1497c2b33383174'
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

**Problem:** An account can be closed while it still holds a balance, and nothing says so. Simon decided on 2026-10-06 that a non-zero closing balance is a warning state, never a block: shown on the account, in settings and, once the inbox exists, as an inbox item.

**Approach:** Derive a closing-balance warning on the account read model, and keep one account-scoped review item in step with it, re-evaluated after every write that can change the balance as of the closed date.

## Boundaries & Constraints

**Always:**
- The warning applies to a closed account of a cash type (`CASH_ACCOUNT_TYPES`) whose balance as of `closedOn` (`balanceSnapshots.balanceAsOf`, AD-19) is not zero. It names the amount. A non-cash type never warns.
- The review item has account scope (kind `accounts.closing-balance`, `entityRef` `account:<id>`, dedupe key `closing-balance:<accountId>`), so everyone who can see the account sees it and a partner who cannot see a private account never does.
- It is raised when the account is closed (or `closedOn` is set or moved) with a non-zero balance, and resolved when the balance reaches zero (`the closing balance reached zero`) or `closedOn` is cleared (`the account was opened again`). It is re-evaluated in the same write after transaction create, update and delete, balance snapshot record, `closeAccount` and `updateAccount` when `closedOn` changes.
- The warning never blocks closing or any write. No schema change.

**Never:** change the closed-date lock, privacy rules or owner rules; add routes (the warning rides on `GET /api/accounts` and `/api/accounts/:id`); build screens or the inbox UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Close with balance | Cash account closed, balance as of `closedOn` is 12,500 cents | View carries `warning` with the amount; one open review item | none |
| Zero balance | Balance is 0 | No warning, no item | none |
| Brought to zero | An entry or snapshot makes the balance 0 | Warning gone; item resolved with its reason | none |
| Moved date | `closedOn` moved later and the balance changes | Warning and item follow the new balance | none |
| Reopen | `closedOn` cleared | Warning gone; item resolved `the account was opened again` | none |
| Non-cash | Closed property or super account with a balance | No warning, no item | none |
| Private | A's private account closed with a balance | B's lists, reviews and responses unchanged | none |

</frozen-after-approval>

## Code Map

- `packages/app/src/accounts/balance.ts` (`recordBalanceSnapshot`, `CASH_ACCOUNT_TYPES`, `balanceAsOf` use case) -- reuse the cash-type list and the repository read; call the sync after the insert.
- New `packages/app/src/accounts/closing-balance.ts` -- the review kind (`defineReviewKind`, as in `system/backups.ts:439`), `closingBalanceOf(tx-or-repos, viewer, account)` returning cents or null, and `syncClosingBalance(tx, audit, ctx, accountId)` using `raiseReviewItem` and `resolveReviewItem` (`system/review-items.ts:106-195`; account scope needs `accountId`).
- `packages/app/src/accounts/pool.ts` (`AccountView`) and `list-accounts.ts` (`viewOf`, `listAccounts`, `getAccount`) -- add `warning?: { kind: "closing-balance"; balanceCents: number }`, computed on read.
- Call sites of the sync: `accounts/close-account.ts`, `accounts/update-account.ts` (only when `closedOn` changes), `accounts/balance.ts`, `ledger/create-transaction.ts`, `update-transaction.ts`, `delete-transaction.ts`.
- Tests: `packages/db/src/accounts.test.ts` (closeAccount, balance snapshots), `packages/app/src/ledger/ledger.test.ts`, `testing/accounts-parity.test.ts`, `apps/server/src/http/app.test.ts` (`/api/accounts`, `/api/review`-style list if one exists), `apps/server/src/privacy/privacy.test.ts` plus `privacy-harness.ts` (A's delta closes accounts: add a non-zero close and assert B's accounts and review items do not change).
- Do not change: `ledger/closed-lock.ts`, `system/review-items.ts`, migrations.

## Tasks & Acceptance

**Execution:**
- [ ] `accounts/closing-balance.ts` -- kind, balance read, sync
- [ ] `pool.ts`, `list-accounts.ts` -- `warning` on the view
- [ ] the six call sites -- re-evaluate in the write
- [ ] tests -- the matrix at use-case, parity and HTTP level; a privacy-suite case for a private account closed with a balance

**Acceptance Criteria:**
- Given a cash account closed with a non-zero balance, when it is listed, then it carries the warning and one open account-scoped item exists.
- Given the balance reaches zero or the account is reopened, when the write completes, then the warning and item are gone.
- Given a private account of A's, when B reads accounts and review items, then nothing about it appears.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 1, low 3 patched, 9 rejected, false 1, maybe-false 0. The verification lens removed each sync call in turn and a test failed for create, update, delete and snapshot.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| The warning on the views `setPrivacy` and `rejoinAccount` return is untested: removing it fails no test (VG) | medium | patch | Mutation run on both returns; add the case. |
| `balance.ts` and `closing-balance.ts` import each other (blind, implementer) | low | patch | Works while the constant is read in functions; move the cash-type list to a leaf module. |
| `AccountWarning` is written out twice (blind) | low | patch | Reuse the named type. |
| The sync runs before the delete's own audit row, unlike create and update (blind, edge) | low | patch | Move it after, so the log reads delete then item change. |
| Transfer survivors are never synced (blind) | false | rejected | `deleteTransaction` unlinks survivors; their amounts, and so their balances, do not change. |
| "Reached zero" is the resolution even if the balance is null; resolve runs on every write; an N+1 on the list; no backfill for accounts closed before this change (blind, edge) | low | rejected | Cash accounts always have a balance (0 with no entries); resolve writes nothing when no item is open; two people; the derived warning is the source of truth and pang-dev holds no ledger accounts. |
| Docs, JSDoc and test-style nits; missing negative-balance and privacy-flip cases (blind) | low | rejected | Biome passes; the matrix rows are covered; style only. |
| "In settings" and the inbox have no screen or route yet (intent) | low | rejected | The plan's Never forbids screens; the handoff notes carry them to epic-ledger-workspace, epic-app-shell-settings-theming and epic-import-dedupe-transfers. |

## Design Notes

The item carries no amount: the amount is read live from the balance on the view, so a later edit that changes a non-zero balance to another non-zero one needs no item change. The sync is idempotent (raise is idempotent on its dedupe key, resolve returns false when nothing is open).

## Verification

**Commands:**
- `pnpm vitest run` -- expected: pass; `pnpm lint` and `pnpm typecheck` -- expected: clean
