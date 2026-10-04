---
title: 'Accounts module'
type: 'feature'
ticket: '4'
created: '2026-10-04'
status: 'built'
baseline_revision: '85af142490d063c08c65621056378a0a7145d775'
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

**Problem:** Only `createAccount` exists. Nothing edits or closes accounts, manages institutions, records balance snapshots, computes a balance, enforces the privacy-change rule or pool and payer, and no account routes exist.

**Approach:** Add the accounts use cases and API routes on the schema and repos from stories 2.1–2.3, with `balanceAsOf` as one SQL function in `db` that the backup manifest (entry 9) will reuse.

## Boundaries & Constraints

**Always:** Every `:id` goes through `accounts.findVisible(viewer, id)`, so a partner's private account is `NotFound` for reads and writes (AD-5); ids are minted on the server. Every account-scoped use case audits with `accountId` and its entity; institutions are household-wide with no `accountId`. Currency equals the household base currency and is immutable. A private account has exactly one owner holding the whole share; shared shares sum to 100%. `poolOf` is "shared" with two or more owners, else the sole owner (AD-26); the payer is `performedBy`, else the sole owner, else "shared". `setPrivacy` to private is refused with `Conflict` while any split of the account is shared (AD-7); making it public has no split rule. `balanceAsOf` (AD-19, cash types transaction, savings, offset, credit_card, home_loan only; others `Validation`) is the latest snapshot on or before the date (ties by `created_at`, then `id`) plus transactions with `posted_on` after that snapshot's `as_of` and up to the date; with no snapshot it starts at 0; it includes pending and posted rows and excludes soft-deleted ones. Any viewer who can see an account may record a snapshot. Memory unit of work mirrors every new repo method; viewer-first reads.

**Decisions:** The `setPrivacy` shared-split check counts live transactions only. Making a two-owner account private is refused; the owner list must first be edited down to one person through `updateAccount`, which replaces owners and shares with the same validation as create. Closing sets `closedOn` only; clearing it through `updateAccount` reopens the account; `createTransaction` is untouched.

**Never:** No web UI (epic-ledger-workspace). No manifest format change (entry 9). No new migration or snapshot uniqueness (ties break by `created_at`/`id`). No account deletion. No change to transaction visibility or redact.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Partner's private account | Partner reads or writes by id | 404 | NotFound |
| Make private, shared split | Any live split has `beneficiary = shared` | Refused, nothing changes | Conflict |
| Make private, clean | One owner, no shared split | Account private | No error expected |
| Balance, snapshot | Snapshot 1000 on 2026-09-01, txns -100 on 09-01 and -50 on 09-03 | `balanceAsOf(09-05)` = 950 | No error expected |
| Balance, none | No snapshot, txns -100, -50, one soft-deleted | Sum of live rows | No error expected |
| Balance, wrong type | Brokerage account | Refused | Validation |
| Currency | Create or update with another currency | Refused | Validation |
| Owners | Private with two owners, or shares not 100% | Refused | Validation |
| Institution | Create, rename, list | Household-wide, audited without `accountId` | No error expected |
| Audit | Every account use case | Audit row carries `accountId` | No error expected |

</frozen-after-approval>

## Code Map

- `packages/app/src/accounts/create-account.ts` -- shape to copy; extend with `institutionId`, `openedOn`, `isSavings`.
- `packages/app/src/accounts/` (new) -- `updateAccount`, `closeAccount`, `setPrivacy`, `listAccounts`, `getAccount`, `createInstitution`, `updateInstitution`, `listInstitutions`, `recordBalanceSnapshot`, `listBalanceSnapshots`, `balanceAsOf`, `poolOf`/`payerOf`; export from `packages/app/src/index.ts`.
- `packages/app/src/ports/unit-of-work.ts` -- `AccountRepo` gains update, replace-owners, has-shared-split; `InstitutionRepo` gains update; a balance query.
- `packages/db/src/ledger-repos.ts`, new `balance.ts` -- repo methods and the shared balance SQL; `unit-of-work.ts` wiring.
- `packages/app/src/testing/memory-uow.ts` -- mirrors, parity with SQLite.
- `apps/server/src/http/app.ts`, `http/errors.ts` -- routes chained after `/api/ledger/transactions`: `GET/POST /api/accounts/institutions`, `PATCH /api/accounts/institutions/:id`, `GET/POST /api/accounts`, `GET/PATCH /api/accounts/:id`, `POST /api/accounts/:id/close`, `POST /api/accounts/:id/privacy`, `GET /api/accounts/:id/balance?asOf=`, `GET/POST /api/accounts/:id/snapshots`. Check how demo mode blocks writes.
- Tests: `packages/app/src/accounts/*.test.ts` on real SQLite, `packages/db/src/ledger-repos.test.ts`, `apps/server/src/http/app.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] ports, db repos, `balance.ts`, memory mirror, parity test
- [ ] use cases and unit tests per rule on real SQLite
- [ ] routes and API tests (partner's private account NotFound for read and write)
- [ ] a test per use case that its audit row carries `accountId`

**Acceptance Criteria:**
- Given a private account, when the partner reads or writes it by id through the API, then the response is 404.
- Given the manifest will reuse it, when `balanceAsOf` runs, then it is the same db function with soft-deleted rows excluded.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 4 low test patches; 8 deferred; 6 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | Path id overriding a body `id`/`accountId` is untested; swapping the spread keeps every test green (verification-gap, pre-verified). |
| low | patch | `createAccount` audit row's `account_id` has no assertion though the plan requires one per use case. |
| low | patch | Create with a non-base currency is untested (update path only). |
| low | patch | Balance route: non-cash type and empty `?asOf=` untested over HTTP. |
| low | defer | Memory mirror drift: `balanceAsOf` ignores soft-deleted accounts, `replaceOwners` unchecked, owner order unsorted, tie-break and soft-delete not in parity scenario. |
| low | defer | No-op `setPrivacy`/`updateInstitution`/empty `updateAccount` still write and audit. |
| low | defer | `poolOf` throws on an ownerless account (one bad row 500s the list); `replaceOwners` accepts an empty list. |
| low | defer | Future `closedOn`/`asOf` accepted, duplicate same-day snapshots unbounded, db `balanceAsOf` checks date shape only (manifest caller must use real date parsing). |
| low | defer | `objectBody` returns `never` so route-to-use-case calls are not type-checked; no body size limit; N+1 owners query and no pagination in lists. |
| low | defer | `ledger-repos.ts` `balanceAsOf` reads `orm.$client`; unverified for a repo built over a transaction orm. |
| low | defer | No route to delete an institution or correct a snapshot. |
| low | defer | Use-case tests sit in `packages/db` (app may not import db); repo-level tests for `update`, `replaceOwners`, `hasSharedSplit` missing. |
| false | reject | `setPrivacy` returns Validation before Conflict for two-owner shared accounts: both rules refuse; decision 2a settled owner-first. |
| false | reject | Client `source` silently dropped on snapshots: the API deliberately records `manual`. |
| false | reject | Demo guard duplicated, stale docstring, route and use case both default `asOf`, missing `http/errors.ts` edit, stale plan file: not defects. |

## Design Notes

`poolOf` and `payerOf` are pure functions over owners and `performedBy`; nothing is stored. Owner changes apply from the next open period, so no history is rewritten.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green (known unrelated failures: `deploy/install.test.ts` x2, `backup.test.ts` restic timeout)
- `pnpm check:strict` -- expected: green

