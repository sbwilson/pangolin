---
title: 'Ledger: hidden names and transfer groups'
type: 'feature'
ticket: '7'
created: '2026-10-04'
baseline_revision: 'd942f9d2767f96106645925d23bba34495dc7637'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The read path already hides names and renders "Transfer from <owner>", but nothing sets or lifts `name_hidden_until`, and nothing links two transactions into a `transfer_group`, so neither can be used through the API.

**Approach:** Add hide and unhide use cases with the 12-month cap, create and delete use cases for manual transfer groups, and API routes. The privacy projection (`visibleTxn`, `redact`) is not changed.

## Boundaries & Constraints

**Always:** Hiding applies only to a live transaction in a shared (non-private) account that the viewer can see; any owner may hide. `hideTransactionName` takes `{ id, until? }`; `until` is `YYYY-MM-DD`, after today and at most 12 calendar months after today, and defaults to the 12-month maximum. It sets `nameHiddenBy` to the viewer and `nameHiddenUntil` to that day; re-hiding replaces both, restarting the clock, still capped at 12 months from now. While a hiding is active (`nameHiddenUntil` after today) only `nameHiddenBy` may re-hide or unhide it; any other viewer gets `Conflict` and nothing changes (a name hidden from them stays hidden from them). A lapsed hiding may be replaced by anyone. `unhideTransactionName` clears both columns and is a no-op returning the transaction when none is set. Hide and unhide change nothing else: amount, date, category, tags and notes stay visible. A private-account, missing, deleted or partner-private transaction is `NotFound`. The hider sees the real name; the other person gets the `redact` placeholder while the hiding is active.

Transfer groups: `createTransferGroup` takes `{ transactionIds: [a, b] }`, both live and visible to the viewer, in two different accounts, with amounts of opposite sign summing to 0, neither already in a group; otherwise `Validation` (shape, accounts, amounts) or `Conflict` (already grouped); a missing or invisible id is `NotFound`. It inserts a `transfer_group` with `matched_by = manual`, sets `transferGroupId` on both, and returns both transactions. `deleteTransferGroup` takes `{ id }`, clears `transferGroupId` on every transaction in the group (including ones the viewer cannot see) and deletes the row; the viewer must be able to see at least one live member (`transferGroups.find`), else `NotFound`. Linking a private-account transaction to a shared one is allowed for the private owner only (the viewer must see both); the partner then reads the shared side as "Transfer from <owner>" through the existing projection and learns nothing else. Both writes are audited as an `update` of each affected transaction with its `accountId`, before and after snapshots including `transferGroupId` and the hidden-name fields; a group create or delete also audits the `transfer_group` row if the audit entity list allows it. The memory unit of work mirrors every new repo method with parity tests. Demo mode refuses writes (409). All routes are `no-store` and viewer-scoped.

**Never:** No automatic or rule-matched groups (`rule`, `auto` belong to epic-import-dedupe-transfers), no change to `visibleTxn`, `redact` or `auditHiddenUntil`, no hiding in private accounts, no search or export work, no web UI, no `is_hidden` change, no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hide, default | Shared account, no `until` | Hidden 12 months; partner sees the placeholder, hider sees the name | No error expected |
| Hide, over cap | `until` more than 12 months out | Nothing written | Validation |
| Hide, past | `until` today or earlier | Nothing written | Validation |
| Re-hide by hider | Active hiding | Clock restarts, capped at 12 months from now | No error expected |
| Re-hide or unhide by other owner | Active hiding by the partner | Nothing changes | Conflict |
| Hide over lapsed hiding | `until` in the past, other owner | Replaced | No error expected |
| Hide, private account | Own private account | Nothing written | Validation |
| Unhide | Hidden by viewer | Both columns null; partner sees the name | No error expected |
| Partner's private row | Any new route | 404 | NotFound |
| Group across private counterpart | Owner links private txn to shared txn | Group made; partner's shared side reads "Transfer from <owner>" (inflow) or "Transfer to <owner>" | No error expected |
| Group, same account or same sign | Two ids | Nothing written | Validation |
| Group, already linked | A txn with a group | Nothing written | Conflict |
| Delete group | Visible member | Both ids cleared, row removed | No error expected |
| Demo mode | Any write | Refused | 409 |

</frozen-after-approval>

## Code Map

- `packages/app/src/ports/unit-of-work.ts` -- `TransactionRepo` gains `setNameHidden(id, by, until, at)` (null clears) and `setTransferGroup(ids, groupId, at)`; `TransferGroupRepo` gains `delete(id)` and `members(id)` (raw, for clearing); `TxRepos` already carries `transferGroups`.
- `packages/db/src/ledger-repos.ts` (`createTransferGroupRepo` ~L476, transaction repo) and `packages/db/src/unit-of-work.ts` -- implement; no schema change (`name_hidden_*`, `transfer_group_id` exist).
- `packages/app/src/testing/memory-uow.ts` (~L717-760 hide and label logic, `transferGroupRepo` ~L1150) -- mirror; parity tests in `packages/db/src/ledger-repos.test.ts`.
- `packages/app/src/ledger/` (new) -- `hide-name.ts` (hide, unhide), `transfer-groups.ts`; model on `delete-transaction.ts` and `update-transaction.ts` (`write()`, `auditSnapshot`, `toLedgerTransaction`, `tagsOf`); export from `packages/app/src/index.ts` (~L337).
- `packages/db/src/privacy.ts` (`visibleTxn` hidden and `transferLabel`) and `packages/app/src/redact.ts` -- read only; reuse, do not change.
- `apps/server/src/http/app.ts` (~L300-350) -- `PUT` and `DELETE /api/ledger/transactions/:id/name-hidden`, `POST /api/ledger/transfer-groups`, `DELETE /api/ledger/transfer-groups/:id`; `writable()`, no-store, `objectBody`.
- Tests: `packages/app/src/ledger/hidden-names-transfers.test.ts` (new), `apps/server/src/http/app.test.ts`, `packages/db/src/privacy.test.ts` (partner-byte-identical check).

## Tasks & Acceptance

**Execution:**
- [ ] ports, db repos, memory mirror and parity tests for `setNameHidden`, `setTransferGroup`, group delete and members
- [ ] `hide-name.ts` -- hide and unhide with the cap and ownership rules; unit tests per matrix row
- [ ] `transfer-groups.ts` -- create and delete; unit tests including the private counterpart
- [ ] `app.ts` routes and API tests (partner 404, demo 409, validation, partner views)
- [ ] audit tests: each write carries `accountId`, before and after

**Acceptance Criteria:**
- Given a transaction hidden by person A, when partner B reads it through any route, then B sees the placeholder and A's real name, and B's responses are unchanged by A's later private edits.
- Given a hiding set for 12 months, when the day arrives, then the name shows again without any write.
- Given A's private-account transaction linked to a shared one, when B lists transactions, then B sees "Transfer from <owner>" and nothing of A's account.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 3 medium and 1 low patches; 2 deferred; 9 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | No test soft-deletes a transaction before hide, unhide, link or group delete, and the "deleted" NotFound rule and the soft-deleted-member group delete are unpinned (verification-gap, pre-verified). |
| medium | patch | No test shows the partner's `listAudit` hides a hidden name, or omits a private member after a group delete. |
| medium | patch | No HTTP test reads the partner's view of a hidden name or "Transfer from <owner>"; the intent's expectations live at the API. |
| low | patch | No "Transfer to <owner>" (outflow) test although the matrix names it. |
| low | defer | A partner can delete a group whose other member is in the owner's private account (clears the link); plan-specified, effect unclear. |
| low | defer | A non-owner who can see a shared account is not checked as an owner before hiding; the household has two people today. |
| false | reject | Cross-currency link accepted: account currency equals the household base currency (accounts module), so sides always match. |
| false | reject | Non-canonical `until` such as `2026-9-30` stored: `parseDate` rejects non-ISO input. |
| low | reject | Delete-group audit uses raw rows rather than `auditSnapshot`: no leak (`auditHiddenUntil` reads `nameHiddenUntil` from the JSON, private rows scoped by `accountId`), only a shape difference. |
| low | reject | Unhide with exactly one of the two columns null, unchecked `setTransferGroup` count in delete, `as never` casts, test hygiene, chunking, no GET group routes, no `transfer_group` audit row: negligible or out of scope, fix adds complexity. |
| false | reject | Plan file out of step with code (Code Map names, status, empty sections): the plan is not a defect of the code. |

## Design Notes

Refusing re-hide and unhide by anyone but the hider during an active hiding: the other partner cannot see the name, so letting them unhide would defeat the hiding, and letting them re-hide would overwrite `nameHiddenBy` and expose the name to the original hider's partner view mismatch. The epic says "any owner may hide"; this reads it as any owner when no hiding is active.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green (known unrelated failures: `deploy/install.test.ts` x2, `backup.test.ts` restic timeout)
- `pnpm check:strict && pnpm --filter @pangolin/db db:generate` -- expected: green, no schema drift
