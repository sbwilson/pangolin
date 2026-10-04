---
title: 'Ledger: transactions'
type: 'feature'
ticket: '6'
created: '2026-10-04'
status: 'built'
baseline_revision: 'fbea231ed83eff67d56daf576f45f67b78898dab'
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

**Problem:** `createTransaction` makes two identical manual lines collide on the AD-20 fingerprint key, nothing edits or deletes a transaction, `transaction.needs_review` is never written, and the only ledger route lists transactions.

**Approach:** Give manual entries a key that cannot collide, add update, get and soft delete (behind recent re-authentication) with audit, keep `needs_review` in step with open review items, and add the API routes.

## Boundaries & Constraints

**Always:** Each created transaction has one split for its full amount (beneficiary `shared`, or the owner on a private account). Manual fingerprint is `fingerprintManual(accountId, transactionId)` (SHA-256 of `manual`, account id and the server-minted transaction id) with `fingerprint_version = 2`; it never changes on edit and never matches an import key. Deleted rows keep their keys, so they still count for dedupe, and are excluded from every read. `deleteTransaction` calls `requireRecentAuth(ctx)` first, then `findVisible` (NotFound for a missing, deleted or partner-private row), then soft-deletes, then resolves open review items for that transaction with the resolution "transaction deleted". `updateTransaction` takes `{id, postedOn?, amountCents?, description?, notes?}` (`.strict()`). Any visible transaction, imported or manual, may have `notes` added, changed or cleared (the user's additional description; plain text, at most 1000 characters, `null` clears it; it is never hidden). Date, amount and description change only on manual rows (`importId` and `externalId` null); sending any of them for an imported row gets `Conflict`. It updates the single split's amount with the transaction amount, refuses a transaction with more than one split with `Conflict`, never touches status, `performedBy`, fingerprint, hidden-name fields, payee or categories, and skips the write and audit when nothing changed. `needs_review` is true exactly when at least one open review item has `entity_ref = 'transaction:<id>'` and is never accepted from input; it is re-synced in the same write whenever such an item is raised or resolved, through a `ledger`-registered listener for the `transaction:` entity prefix that `raiseReviewItem` and `resolveReviewItem` call (the `system` module cannot import `ledger`). Every ledger audit row sets `accountId` and carries before and after, including splits. Routes call `writable()`, set `Cache-Control: no-store`, and use `objectBody` so the path id wins. A partner's private-account transaction is `NotFound` on every route. Memory unit of work mirrors every new repo method with parity tests.

**Never:** No hiding of names or transfer groups (story 2.7), no split editing, tags, payee or category changes (stories 2.13, 2.5 use cases), no review-item kinds beyond the sync, no new password re-entry endpoint, no change to `visibleTxn`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Identical manual lines | Two creates with the same account, date, amount, description | Both succeed, different fingerprints | No error expected |
| Edit manual | New date, amount or description on a one-split manual row | Row and split amount updated, one audit row | No error expected |
| Edit imported | Date, amount or description on a row with `importId` or `externalId` | Refused | Conflict |
| Add notes | `notes` on an imported or manual row | Saved, audited, visible to both partners, `null` clears | Validation over 1000 characters |
| Edit multi-split | Amount change on a transaction with more than one split | Refused | Conflict |
| No-op edit | Same values | No write, no audit | No error expected |
| Delete fresh auth | Recent auth, visible row | Soft-deleted, open review items resolved, one audit row | No error expected |
| Delete stale auth | Session older than the window | Nothing changes | ReauthRequired, HTTP 403 |
| Delete twice | Already deleted | Not found | NotFound |
| Delete dedupe | Soft-deleted row, then insert with the same key | Still blocked by the unique index | Conflict |
| Partner's private row | Partner gets, edits or deletes it | 404 | NotFound |
| needs_review | Raise then resolve an open item for `transaction:<id>` | Flag true, then false | No error expected |
| Demo mode | Any write | Refused | 409 |

</frozen-after-approval>

## Code Map

- `packages/app/src/ledger/create-transaction.ts` -- already one full-amount split; switches to `fingerprintManual` and drops the fingerprint `Conflict` catch; `fingerprint.ts` and its test gain the manual scheme (`ledger.test.ts:145` pins the old Conflict and must change).
- `packages/app/src/ledger/{update-transaction,delete-transaction,get-transaction}.ts` (new), `list-transactions.ts`, `index.ts` -- pattern `accounts/update-account.ts`.
- `packages/app/src/identity/reauth.ts` -- `requireRecentAuth`; `ReauthRequired` maps to 403 in `apps/server/src/http/errors.ts`.
- `packages/app/src/system/review-items.ts` -- `raiseReviewItem`, `resolveReviewItem`; add the entity-sync listener registry and `ReviewItemRepo.countOpenForEntity`.
- `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/ledger-repos.ts`, `review-item-repo.ts`, `unit-of-work.ts`, `testing/memory-uow.ts` -- `TransactionRepo.update`, `setNeedsReview`, split amount update, open-item resolve by entity.
- `apps/server/src/http/app.ts` -- `POST /api/ledger/transactions` (201), `GET`, `PATCH` (200), `DELETE` `/api/ledger/transactions/:id` (204).
- `apps/server/src/admin/seed.ts`, `apps/server/src/http/app.test.ts` -- callers of `createTransaction`.
- Tests: `packages/app/src/ledger/ledger.test.ts`, `packages/db/src/ledger-repos.test.ts` (parity), `apps/server/src/http/app.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] manual fingerprint, create changes and fingerprint tests
- [ ] ports, repos, memory mirror, parity tests for update, needs_review and split amount
- [ ] `updateTransaction`, `deleteTransaction`, `getTransaction`, needs_review sync with unit tests per matrix row
- [ ] routes and API tests (partner 404, stale auth 403, demo 409)
- [ ] audit tests: every action carries `accountId`

**Acceptance Criteria:**
- Given two identical manual lines in one account, when both are created, then both exist.
- Given a stale session, when a transaction is deleted, then HTTP 403 and nothing changes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 4 medium and low patches; 9 deferred; 6 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | The hidden-name `Conflict` guard and description-preserving update path in `updateTransaction` have no test (verification-gap, pre-verified); the blank-notes branch is unexercised. |
| low | patch | `update` and `updateSplitAmount` results ignored in `updateTransaction`. |
| low | patch | `registerEntitySync` and `resolveReviewItemsForEntity` have no direct tests; HTTP gaps: imported-row 409, notes over 1000 characters, deleted row 404. |
| medium | defer | `needs-review.ts` registers its listener by side-effect import; a process that raises `transaction:` items without loading ledger would silently skip the sync. |
| medium | defer | Soft-deleting one transfer leg leaves the other live; transfer groups belong to story 2.7. |
| low | defer | No protection against an accidental double POST (plan accepts deliberate repeats); create audit has no splits snapshot; delete's audit `after` is hand-built. |
| low | defer | Update validators duplicate the create schemas; `setNeedsReview` touches deleted or missing rows without a signal; audit snapshots come from the viewer's view of the row. |
| false | reject | Multi-split date or description edits succeed: the decision refuses only an amount change. |
| false | reject | Removed fingerprint `Conflict` catch and seed re-runs duplicating lines: manual keys cannot collide, and `linkSeed` refuses a ledger that already has transactions. |
| false | reject | Stale plan file, missing `Location` header and PATCH stale-auth test: not defects against the plan. |

## Design Notes

The import epic's `(account, posted_on, amount)` matching will still surface a manual line as a probable duplicate; that is intended. A deleted row counts for dedupe, so re-importing its line does not bring it back.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green (known unrelated failures: `deploy/install.test.ts` x2, `backup.test.ts` restic timeout)
- `pnpm check:strict` -- expected: green

