---
title: 'Backup manifest: per-account balances'
type: 'feature'
ticket: '9'
created: '2026-10-04'
baseline_revision: '56ca9ca0b1b7ffe216bb3e247b597a8e28282c34'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The backup manifest (format 1) proves each table's row count and checksum but says nothing about the ledger's money, so a restore cannot show that every account's transactions and balance came back.

**Approach:** Manifest format 2 adds, per account, the transaction count, the sum of `amount_cents` and `balanceAsOf` (spine AD-19), computed under the system viewer with the one balance SQL in `db`; a restore verifies those figures for format 2 and still reads format 1.

## Boundaries & Constraints

**Always:** `buildManifest` writes `format: 2` with a `balanceDate` (`YYYY-MM-DD`) and an `accounts` list, one entry for every `account` row including soft-deleted accounts, ordered by `id`: `{ id, transactionCount, amountSumCents, balanceCents }`. `transactionCount` counts every transaction of the account, soft-deleted rows included; `amountSumCents` sums `amount_cents` of live rows only; `balanceCents` is `balanceAsOf(db, id, balanceDate)` (live rows, `BALANCE_AS_OF_SQL` in `packages/db/src/balance.ts`) for the cash types `transaction`, `savings`, `offset`, `credit_card`, `home_loan`, and `null` for the others. No viewer filter: this runs on the snapshot connection as the system. `balanceDate` is the household's `ctx.clock.today()` at the backup, passed through `writeSnapshot`; with none given it is today's UTC date. A rebuild for verification uses the manifest's own `balanceDate`, so the figures are reproducible. `parseManifest` accepts format 1 (no `accounts` or `balanceDate`) and format 2, validating each account entry (string id, safe integer counts, integer sums, integer or null balance, no duplicate ids); any other format is refused as now. `compareManifests` and `verifySnapshot` compare accounts only when the expected manifest is format 2: a missing, extra or differing account (count, sum or balance) is a `manifest` check failure named in a sentence per difference, in the existing first-three style. A format-1 manifest verifies exactly as today. The manifest still carries no description, payee or name text.

**Never:** No change to `balance.ts`'s SQL or to `accounts.balanceAsOf`, no balances for non-cash types (they stay `null` until the investment and property epics), no migration, no change to the table checksums or `schemaVersion` rules, no new restore flags.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Build, cash account | Account with a snapshot and later transactions | `balanceCents` equals `balanceAsOf` on `balanceDate` | No error expected |
| Soft-deleted transaction | One deleted row in an account | Counted in `transactionCount`; excluded from `amountSumCents` and the balance | No error expected |
| Non-cash account | `brokerage` or `property` | `balanceCents` is `null`; count and sum still present | No error expected |
| Soft-deleted account | `account.deleted_at` set | Still listed | No error expected |
| Verify format 2 | Snapshot unchanged | Verdict ok | No error expected |
| Verify, a figure differs | A transaction amount edited after the manifest | `manifest` check fails naming the account and figure | Verdict `ok: false` |
| Verify, format 1 | Format-1 manifest on a snapshot | Verdict ok, no account checks | No error expected |
| Parse, bad accounts | Non-integer sum or duplicate id | Refused | `Error` naming the accounts list |

</frozen-after-approval>

## Code Map

- `packages/db/src/manifest.ts` -- (account scan runs only for a format-2 build or verify; a format-1 verify never touches `account` or `balance_snapshot`) `MANIFEST_FORMAT`, `Manifest`, `buildManifest`, `parseManifest`, `compareManifests`, `verifySnapshot`, `writeSnapshot`; add `AccountManifest`, `balanceDate`, `accounts`, and a supported-formats check (1 and 2); table hashing stays untouched.
- `packages/db/src/balance.ts` -- `balanceAsOf(db, accountId, date)`: call it per cash account, do not change it.
- `packages/app/src/accounts/balance.ts` (`CASH_ACCOUNT_TYPES`) -- the cash type list; `db` cannot import `app` values, so mirror it as a constant in `manifest.ts` and add a test that the two lists agree.
- `apps/server/src/backup/snapshot.ts`, `snapshot-worker.ts`, `apps/server/src/jobs/backup.ts` (~L99) -- pass `ctx.clock.today()` as `balanceDate` through `workerData` to `writeSnapshot`.
- `apps/server/src/backup/restore.ts`, `admin/restore.ts` -- already use `parseManifest` and `verifySnapshot`; check they read nothing format-specific.
- Tests: `packages/db/src/manifest.test.ts` (build, parse, compare, verify, format 1), `apps/server/src/backup/snapshot.test.ts`, `apps/server/src/jobs/backup.test.ts`, `apps/server/src/backup/restore.test.ts` (a stored format-1 manifest still restores).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db/src/manifest.ts` -- format 2 build, parse of 1 and 2, account comparison, `balanceDate` in `writeSnapshot`
- [ ] snapshot worker and backup job -- pass the household date through
- [ ] `packages/db/src/manifest.test.ts` -- one test per matrix row, plus the cash-type list agreeing with `CASH_ACCOUNT_TYPES`
- [ ] server tests -- snapshot writes format 2; restore of a format-1 manifest still verifies

**Acceptance Criteria:**
- Given a ledger with a deleted transaction, when the manifest is built, then the account's count includes it and its sum and balance do not.
- Given a format-2 snapshot whose transaction amount changed, when it is verified, then the check fails on that account.
- Given a format-1 snapshot and manifest, when they are restored, then verification passes as before.

## Implementation Notes

## Plan Change Log

- Pass 1 finding: format-1 verification ran the account scan against old snapshots. Amended: Code Map and Design Notes now say that `verifySnapshot` builds the account list only when the manifest being checked is format 2 (and `buildManifest` takes an option to skip it), so a format-1 manifest on an older-schema snapshot verifies exactly as before. Known-bad state avoided: a pre-ledger snapshot with a format-1 manifest failing restore on a missing `account` table. KEEP: format 2 shape and field names, `MANIFEST_CASH_TYPES` with the agreement test, `balanceDate` passed from `ctx.clock.today()` through the worker, parse validation of format 1 and 2, `compareManifests` sentence style, every matrix-row test; add tests for each of count-only and balance-only account differences, a missing or malformed format-2 `balanceDate`, a `verifySnapshot` on a far-past `balanceDate` that would flip with today's date, a format-1 manifest on a snapshot with no `account` table, and one account-message case where the table checksums pass.

## Review Triage Log

Pass 1 (thorough): 1 medium bad_plan, 3 medium and 1 low test-gap patches; 0 deferred; 10 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | bad_plan | `verifySnapshot` rebuilds with `buildManifest`, which always runs the account scan and `balanceAsOf`; a format-1 manifest from a snapshot at an older schema (no `account` or `balance_snapshot` table) then fails as a `manifest` check, so format 1 no longer verifies "exactly as today". The plan did not say how the rebuild skips the scan. |
| medium | patch | No test gives `compareManifests` a differing `transactionCount` or `balanceCents` (incl. null against a number); deleting either comparison breaks no test. |
| medium | patch | A format-2 `balanceDate` missing or malformed in `parseManifest` is unpinned. |
| medium | patch | No test fails if `verifySnapshot` used today's date instead of `manifest.balanceDate` (the fixture dates are near the run date). |
| low | patch | The "figure differs" `verifySnapshot` test asserts only the table checksum message; one case should pass the table check and show the account message (the tamper changes `balance_snapshot` only). |
| false | reject | Account figures add no tamper detection over table checksums: the plan states the purpose (a restore shows the money came back, and catches logic bugs), not detection beyond the hashes. |
| low | reject | Impossible calendar date (2026-13-45) passes the `DAY` regex; the date is the job's own `clock.today()`, a hand-edited manifest fails the compare anyway. |
| low | reject | UTC default for `balanceDate`, no worker-side date check, partial staging dir on an invalid date, `compareManifests` not naming a date difference, per-account grouping of the three-line cap, safe-integer sums, unbounded messages: negligible, fixes add guards. |
| low | reject | `@pangolin/db` test imports `@pangolin/app` for the cash-list agreement: the package boundary check passes. |
| low | reject | No viewer-independence test against a private account, per-account query cost, plan file process gaps, no docs update: negligible for this change or not defects of the code. |

## Design Notes

The balance date is stored in the manifest so a later rebuild matches: a balance depends on the day it is taken, and a restore verifies hours or years later. The household date comes from the job's clock rather than UTC because posted dates are household-local.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green
- `pnpm check:strict && pnpm --filter @pangolin/db db:generate` -- expected: green, no schema drift

Pass 2 (thorough, after the loopback): 0 high, 0 medium, 0 patches; 0 deferred; all rejected. The bad_plan row above is fixed: a format-1 verify never touches `account` or `balance_snapshot` (tested with a snapshot that has no `account` table).

| Verdict | Route | Finding and evidence |
|---|---|---|
| low | reject | carried: impossible calendar date, UTC default for `balanceDate`, no worker-side date check and partial staging dir on a bad date, `compareManifests` not naming a date difference, per-account message cap, safe-integer sums, `@pangolin/db` test importing `@pangolin/app`, privacy and per-account query cost: negligible, or the fix adds guards. |
| low | reject | A format-2 manifest object with no `balanceDate` given straight to `verifySnapshot` reports accounts as missing: `parseManifest` refuses it, so no real manifest reaches it. |
| low | reject | "balance is none cents" wording, an unclosed test database handle, a UTC-midnight flake in the default-date test, `format: number` instead of a discriminated union: cosmetic or negligible. |
| low | reject | No `restore.test.ts` case for a format-1 manifest: `restore.ts` only calls `parseManifest` and `verifySnapshot`, which the db tests cover for format 1 including an older-schema snapshot. |
| false | reject | Plan file out of sync, no downgrade note for an older reader: not defects of the code. |
