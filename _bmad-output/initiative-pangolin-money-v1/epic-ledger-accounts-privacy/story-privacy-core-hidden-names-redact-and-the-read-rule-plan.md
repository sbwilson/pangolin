---
title: 'Privacy core: hidden names, redact and the read rule'
type: 'feature'
ticket: '3'
created: '2026-10-04'
status: 'built'
baseline_revision: '0c424d74c6a38733da0661c65217e6daf07d7726'
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

**Problem:** `visibleTxn` returns raw payee and description, ignores soft-deleted accounts, has no hidden-name projection, no `redact()`, no transfer projection and no rule stopping direct reads of `account` or `transaction`. Review items ignore account visibility and audit rows have no scoped read.

**Approach:** Make `visibleTxn(viewer, today)` a SQL projection per AD-4, add `redact()` at the app boundary, enforce the read rule with a lint and a test, compose `visibleAccounts` into review items and audit reads, and prove it with per-table missing-viewer tests.

## Boundaries & Constraints

**Always:** Hiding applies only to shared-account transactions, for any person other than `name_hidden_by`, while `name_hidden_until > today` (ISO string compare; shows on that date). SQL nulls payee, description and logo; every filter, sort and group runs on that projection. Soft-deleted accounts and transactions never appear. A scoped payee's id is nulled for a viewer outside its scope. `redact(viewer, rows)` renders "Hidden until 12 Mar 2027" and runs once on everything leaving `app`: API responses, exports, audit reads, review items, including the hider's partner's audit entries; notes stay visible. A transfer whose counterpart is in the other person's private account shows as "Transfer from <owner>" when the visible row is an inflow and "Transfer to <owner>" when it is an outflow (sign of the amount); only that label and the owner's display name leave, never the counterpart's account id, amount or transaction id. `today` comes from `ctx.clock.today()`. Ledger and accounts use cases set `audit_log.account_id`. Memory unit of work mirrors every change.

**Never:** No hiding use case, transfer-group use case, search, export or audit routes (later entries and epic-ledger-workspace). No private-account hiding (private accounts are invisible, not hidden). Do not edit auth tables or earlier migrations; no new migration unless a column is genuinely missing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hidden, partner | Shared txn, `name_hidden_until` after today, viewer is not the hider | Payee, description, logo null; redact shows "Hidden until <date>" | No error expected |
| Hidden, hider | Same, viewer is `name_hidden_by` | Real name shown | No error expected |
| Lifts | `name_hidden_until` equals today | Real name shown | No error expected |
| Private account | Name hidden on a private-account txn | Partner never sees the row | NotFound by id |
| Deleted | Soft-deleted account or transaction | Excluded everywhere | No error expected |
| Transfer | Counterpart in the other person's private account | "Transfer from <owner>" (inflow) or "Transfer to <owner>" (outflow), no counterpart ids or amount | No error expected |
| Scoped payee | Shared txn whose payee is the other person's scoped row | `payeeId` null | No error expected |
| No viewer | Any scoped read with no viewer | Throws | Programming error |
| Direct read | Code reads `account`/`transaction` outside the allowed files | Lint and test fail | CI failure |
| Review item | Item on a private account, viewer is the partner | Not listed | No error expected |

</frozen-after-approval>

## Code Map

- `packages/db/src/privacy.ts` -- `visibleAccounts`, `visibleTxn`, `visibleScope`, `requireViewer`; add `account.deleted_at`, `transaction.deleted_at`, `today`, the name projection and the transfer label.
- `packages/db/src/ledger-repos.ts` -- `transactionColumns` selects raw `descriptionRaw`/`payeeId`; route every read through the projection; `listVisible`/`findVisible` take `today`.
- `packages/db/src/review-item-repo.ts` -- `visibleReviewItems` requires `isNull(accountId)`; compose `visibleAccounts`.
- `packages/db/src/unit-of-work.ts`, `packages/app/src/ports/unit-of-work.ts` -- new audit read repo (`audit.listVisible(viewer)` on `audit_log.account_id` and `person_id`), `today` parameters.
- `packages/app/src/redact.ts` (new), `index.ts` -- `redact(viewer, rows)`; `ledger/list-transactions.ts` applies it; review-item and audit read use cases apply it.
- `packages/app/src/testing/memory-uow.ts` -- `accountVisible`, `visibleRows` mirrors.
- `packages/app/src/write.ts` -- `AuditEntry.accountId`; `accounts/create-account.ts`, `ledger/create-transaction.ts` already set it.
- `biome.json`, `scripts/biome-restrictions.test.ts`, `tools/lint/*.grit` -- import restriction on the `account`, `transaction`, `audit-log` schema files outside `privacy.ts`, `ledger-repos.ts`, `unit-of-work.ts`.
- `packages/db/src/ledger-repos.test.ts`, `classification-repos.test.ts`, `review-item-repo.test.ts` -- parity and per-table missing-viewer tests.
- `@pangolin/shared/temporal` -- `PlainDate`, `parseDate`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db/src/privacy.ts`, `ledger-repos.ts` -- projection, deleted filters, `today`, transfer label
- [ ] `review-item-repo.ts`, audit read repo, ports and memory mirror
- [ ] `packages/app/src/redact.ts` and use-case wiring
- [ ] read-rule lint/import restriction plus a test grepping `packages/db/src` for direct reads
- [ ] tests for every matrix row on SQLite and memory; one missing-viewer test per scoped table
- [ ] a test that every audit row written by the ledger and accounts use cases carries `accountId`

**Acceptance Criteria:**
- Given a hidden transaction, when the partner lists transactions through the API, then the name is "Hidden until <date>" until that date and real on it.
- Given a deliberate direct read of `account`, when lint and the rule test run, then they fail.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 2 medium and 1 low patches; 10 deferred; 9 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | Audit hiding from the row's own before/after JSON is unpinned: tests hide only through the live row, so deleting those branches stays green (verification-gap, pre-verified). |
| low | patch | Review-item fixtures flipped public to private; no test shows a public-account item visible to both. |
| medium | patch | Acceptance criterion names the API but no HTTP test shows the partner's "Hidden until" response (intent-alignment). |
| medium | defer | Audit rows with `account_id` NULL are visible to everyone; only the two existing use cases are tested to set it; later use cases (hide, delete, owner change) must set it. |
| low | defer | Audit and review items of a soft-deleted account vanish for the owner; no delete use case yet. |
| low | defer | Read-rule test and lint see imports only, not raw SQL or `require`; biome group repeated four times; `split`/`payee` outside the rule. |
| low | defer | Audit scrub removes only `descriptionRaw` and `payeeId`; other entities' audit JSON not handled. |
| low | defer | Unbounded audit/transaction reads, correlated subqueries per row, missing indexes on `audit_log.account_id` and `transfer_group_id`. |
| low | defer | Memory/SQL duplication: audit parity scenario, owner-pick order, deleted-row parity, JSON parse guard. |
| low | defer | `redact` is advisory: a future use case could skip it; partner can soft-delete a transaction hidden from them. |
| false | reject | `redact` throws on a malformed `name_hidden_until`: a loud failure that cannot leak, the column is a date by convention. |
| false | reject | Malformed audit JSON breaks `json_extract`: audit JSON is written only by the app. |
| false | reject | Timestamp vs local date skew: `name_hidden_until` is a `YYYY-MM-DD` date by convention. |
| false | reject | Jointly owned private counterpart picks first owner: private accounts have exactly one owner. |
| false | reject | Zero-amount transfer labelled "from", `today` format guard, `visibleAccounts` for system viewers, stale plan, missing grit/write.ts edits: cosmetic or not defects. |

## Design Notes

`visibleTxn(viewer, today)` takes the date string because repos never see the clock. The SQL projection is the single source of nulling; `redact` only formats and never decides visibility.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green (known unrelated failures: `deploy/install.test.ts` x2, `backup.test.ts` restic timeout)
- `pnpm check:strict && pnpm check:upgrade` -- expected: green

