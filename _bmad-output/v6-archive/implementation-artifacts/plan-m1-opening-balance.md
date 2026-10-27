---
title: 'M1 gate: start from a derived opening balance'
type: 'feature'
ticket: ''
created: '2026-10-21'
baseline_revision: 'db68f5d2ab2077b3eaf12779b1d5cf4255d3fb05'
status: done
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/docs/m1-gate.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Bank CSV exports only reach back so far, so every account's first statement starts mid-life with a non-zero balance. The M1 report calls that leading span a hole, account balances in the app are transaction sums that ignore the real opening balance, and nothing checks that consecutive files join.

**Approach:** On import, derive the opening and closing balances from a statement's printed running balances and record the opening as a `statement` balance snapshot the day before the first row; let the M1 report accept a leading span that starts from a snapshot, add a cross-file join check, and add an admin command to set an opening balance by hand for accounts whose statements print none (credit cards, and batches imported before this change).

## Boundaries & Constraints

**Always:**
- Opening = balance minus amount of the oldest balanced row (same-day rows by the orientation `reconcileStatement` chose); closing = balance of the newest balanced row. Only for status `ok`; `gap` or `unavailable` records neither a snapshot nor values.
- Record the snapshot only when the account has no live transaction outside this batch dated before the batch's first date and no snapshot dated on or before the day before it. It is `source = statement`, `as_of` = first posted date minus one day, linked to the batch (`import_batch_id`), audited as `create` with the account.
- `undoImportBatch` deletes snapshots linked to the batch, audited as `delete`, in the same write.
- The report treats a leading span as accepted when the account has a snapshot dated before its first covered date; it prints "starts from opening balance <amount> on <date>", does not count it as a hole, and still counts interior holes and broken batches. Without such a snapshot the leading span stays a hole.
- Join check: for batches ordered by first date where the next starts after the previous ends, require previous closing = next opening when both are recorded; a mismatch is a join break, counted in the totals beside holes and broken batches. Overlapping batches are not join-checked.
- `m1-report` prints each account's id; the admin command `opening-balance <account-id> <YYYY-MM-DD> <amount>` records a `manual` snapshot through `recordBalanceSnapshot` as the system viewer (signed amount, liabilities negative).

**Never:**
- No credit-limit field, no web or Import-popover prompt, no backfill of existing batches (use the admin command), no PDF reading, no change to dedupe or fingerprints, no edits to existing snapshots.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First file | Balanced CSV, account empty | Snapshot at day before first row = derived opening | n/a |
| Older file later | Account has newer batch and its snapshot | Older file's own opening snapshot recorded; join check compares closing to newer opening | n/a |
| History exists | Account has earlier transactions | No snapshot | n/a |
| Gap or no balances | `gap` / `unavailable` | No snapshot, no opening/closing | n/a |
| Undo | Batch with snapshot undone | Snapshot deleted and audited | n/a |
| Report | Leading span with a snapshot | "starts from opening balance", 0 holes | n/a |
| Join break | A closes at 100.00, B opens at 90.00 | Join break listed and counted | n/a |
| Manual | `opening-balance <id> 2026-01-12 -500.00` | Manual snapshot; report accepts the span | Unknown account: exit 1 |

</frozen-after-approval>

## Code Map

- `packages/domain/src/reconcile/reconcile-statement.ts` (+ test) -- also return `openingCents` and `closingCents` for `ok`; orientation stays internal.
- `packages/db/src/schema/import-batch.ts`, `schema/balance-snapshot.ts`, `migrations/0020_*.sql` (+ journal, `meta/0020_snapshot.json`), `migrate.test.ts`, `system-health-repo.test.ts` -- nullable `opening_balance_cents`, `closing_balance_cents` on `import_batch`; nullable `import_batch_id` (FK, index) on `balance_snapshot`; schema-version bump.
- `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/*` repos, `packages/app/src/testing/memory-uow.ts` -- `BalanceSnapshotRepo.deleteByImportBatch(batchId)` returning the rows, `TransactionRepo.hasLiveBefore(accountId, date, exceptImportId)`, new batch fields; `ReadRepos` pick for report reads; parity tests.
- `packages/app/src/imports/import-statement.ts` -- store opening/closing, record the snapshot; `undo-batch.ts` -- delete it.
- `packages/app/src/imports/m1-report.ts` (+ test), `apps/server/src/cli.ts` (`printM1Report`), `cli.test.ts` -- accepted spans, join breaks, account ids.
- `apps/server/src/admin/commands.ts`, `cli.ts` (`USAGE`) -- `opening-balance` command reusing `recordBalanceSnapshot` (`accounts/balance.ts`).
- `docs/m1-gate.md` -- the accepted-start definition, join check, how to set openings for cards and existing batches.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- credit-limit field (`account.credit_limit_cents`, in `data-model.md`, absent from the schema) and a web prompt for opening balances.

## Tasks & Acceptance

**Execution:**
- [ ] Domain opening/closing, migration 0020, repos in SQLite and memory with parity tests.
- [ ] Import records opening, closing and the snapshot; undo removes it.
- [ ] Report accepted spans and join breaks; CLI output and tests; id in output.
- [ ] `opening-balance` admin command with tests.
- [ ] Update `docs/m1-gate.md`; run the generated twelve-month test and the gap test unchanged.

**Acceptance Criteria:**
- Given a balanced first file, when imported, then `balanceAsOf` on the first row's date equals the printed balance after that row.
- Given an undone batch, when read, then its snapshot is gone and the leading span is a hole again.
- Given two joined files, when one closing differs from the next opening, then the report lists a join break.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- Docs say to undo and re-import to get opening/closing on old batches, but re-import after undo is blocked by the file hash (blind, gap, edge) -- verdict: high -- route: patch -- correct the docs: old batches rely on the `opening-balance` command; only newly imported batches get derived values and join checks; fix the garbled test comment.
- `joinBreaksOf` compares a batch with its sorted neighbour, so a nested batch gives a false break and hides the real predecessor (edge) -- verdict: medium -- route: patch -- compare with the batch holding the greatest last date so far.
- A null-valued batch between two valued ones hides breaks and the report shows 0 join breaks while nothing was compared (blind, edge, gap) -- verdict: medium -- route: patch -- count pairs not compared (`joinsUnchecked`) and print it.
- Accepted start takes any earlier snapshot even if it disagrees with the first batch's opening (blind, edge) -- verdict: medium -- route: patch -- when the first batch has a stored opening, accept only a snapshot with the same balance.
- Opening is wrong when the oldest rows print no balance, or when both orientations chain and the tie picks the wrong end (blind, edge) -- verdict: medium -- route: patch -- `openingCents`/`closingCents` null unless the oldest row is balanced and the orientation is unambiguous; domain tests.
- `opening-balance` accepts impossible dates and can add conflicting same-day snapshots with no delete path (blind, edge) -- verdict: medium -- route: patch -- validate the calendar date (usage error, exit 2) and refuse when the account already has a snapshot that day.
- Audit actor `cli:opening-balance` not asserted; null guard in the join check untested (gap) -- verdict: low -- route: patch -- add both assertions.
- SQLite-backed undo with a snapshot and its audit rows (gap) -- verdict: low -- route: defer -- parity covers the repos; logged.
- Shared boundary day not join-checked (blind, edge) -- verdict: false -- rows on a shared day sit in both files, so closing and opening legitimately differ.
- Import snapshot bypasses `requireOpenOn`/`syncClosingBalance`, same-day other-source transactions, `startsFrom` only when a hole existed, FK on hard delete, typing cast, number-format strictness, docs line length, edited existing tests, plan hygiene (blind, edge, intent) -- verdict: low/false -- route: reject -- imports are not closed-locked elsewhere and `importStatement` already syncs the closing balance; batches are never hard-deleted; the edited tests changed for the new behaviour.

## Design Notes

A snapshot means "balance at the end of `as_of`", so the opening for a first row on day D is stored at D−1, and `balanceAsOf` adds transactions after that day. Mastercard, whose CSV prints no balances, gets its opening from the admin command. Existing batches have no opening/closing values, so their joins are not checked until re-imported.

## Verification

**Commands:**
- `npx vitest run` -- expected: all pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm check:strict` -- expected: clean.
