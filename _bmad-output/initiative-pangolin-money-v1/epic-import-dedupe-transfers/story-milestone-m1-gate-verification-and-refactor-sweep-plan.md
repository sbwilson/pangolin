---
title: 'Milestone M1 gate verification and refactor sweep'
type: 'feature'
ticket: 10
created: '2026-10-21'
baseline_revision: '171a4d29662edfed2bb4e935eb2952470f11bef6'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/import-pipeline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The M1 gate ("twelve months imported, no unexplained balance gaps") cannot be checked: pipeline step 7 (reconcile) was never built, so nothing records whether a statement's balances hold together or whether months are missing, and `import-statement.ts` has grown to 1,250 lines with seven inline parsers.

**Approach:** Add a pure reconcile check, run it on every import with printed balances and record the result on the batch, add a read-only M1 report (admin command `m1-report`) with a sign-off runbook, test it on generated twelve-month data, and tidy the package: split the inline parsers into files with no behaviour change and clear the lint warnings. The gate itself is closed by the human on real statements.

## Boundaries & Constraints

**Always:**
- An unexplained gap is either (a) a batch whose printed running balances do not chain, or (b) a span between an account's covered date ranges (union of its non-undone batches' first and last posted dates) with no statement, counted from 2024-07-01 to the newest covered date. The report lists both per account; zero of each is the gate's machine check.
- Reconcile reads only `balanceCents` from the parsed rows and orders them by file order, accepting newest-first or oldest-first input (the orientation that fits more pairs); formats without printed balances record `unavailable`, never a failure.
- Record `reconcile_status` (`ok | gap | unavailable`), `reconcile_gap_cents`, `first_posted_on` and `last_posted_on` on `import_batch` (migration 0019, nullable for existing rows); a gap also raises one `import.balance_gap` review item (account scope, entity `import_batch:<id>`, idempotent key). Importing never fails or blocks over a gap.
- The refactor moves the seven `parseBuiltin*` functions and their helpers to `packages/app/src/imports/parsers/` with identical outputs, proved by the existing import tests.
- The report and command are read-only and run `app` use cases as the system viewer; `docs/m1-gate.md` follows `docs/m0-gate-rehearsal.md` (evidence rows; the human marks the gate closed).

**Never:**
- No closing of the M1 gate by Claude, no real statements in the repo, no changes to dedupe, fingerprints or balance snapshots, no new boundary-rule exceptions, no dedupe between `app` parsers and `packages/importers`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean file | CSV whose balances chain | `reconcile_status = ok`, gap 0, no item | n/a |
| Broken chain | One row's amount missing | `gap`, `reconcile_gap_cents` = break size, `import.balance_gap` item | Import still commits |
| Either order | Newest-first or oldest-first file | Same result | n/a |
| No balances | OFX, QIF, Up CSV | `unavailable`, no item | n/a |
| Coverage hole | Batches cover Jul–Sep and Nov–Jun | Report lists the Oct hole | n/a |
| Twelve months | Generated 12 monthly files, contiguous | Report: 0 gaps, 12 months covered | n/a |
| Undone batch | A batch is undone | Excluded from coverage and counts | n/a |
| Re-import | Same file again | No new batch, report unchanged | n/a |

</frozen-after-approval>

## Code Map

- `packages/domain/src/reconcile/reconcile-statement.ts` -- new pure `reconcileStatement(rows)`; export from `packages/domain/src/index.ts`; domain tests.
- `packages/db/src/schema/import-batch.ts`, `migrations/0019_*.sql` (+ journal, `meta/0019_snapshot.json`), `migrate.test.ts`, `system-health-repo.test.ts` -- new columns and the schema-version bump as in 0017 and 0018.
- `packages/app/src/ports/unit-of-work.ts` (`ImportBatchRow`, repo), `packages/db/src/repositories/import-repos.ts`, `packages/app/src/testing/memory-uow.ts` -- columns and a `listCommittedForAccount` read.
- `packages/app/src/imports/import-statement.ts` -- call `reconcileStatement` after parsing, store the result, raise `IMPORT_BALANCE_GAP_REVIEW`; this file shrinks as parsers move.
- `packages/app/src/imports/parsers/*.ts` -- one file per format plus `shared.ts` (`parseCsvLine`, `extractTag`); `import-statement.ts` re-imports them.
- `packages/app/src/imports/m1-report.ts` -- new `m1GateReport(ctx)`; `apps/server/src/admin/commands.ts`, `cli.ts` (`USAGE`), `cli.test.ts` -- `m1-report` command.
- `packages/importers/src/generators/mock-statements.ts` -- add a 12-month generator with running balances; `tools/` unaffected.
- `docs/m1-gate.md` -- runbook and evidence table.
- Lint: `deploy/pangolin.test.ts` (7 template-string warnings), `packages/app/src/imports/handoff.test.ts` (non-null assertions), `identity/preferences.test.ts` (`any`), `admin/seed.test.ts` (unused variable) -- fix without changing behaviour.

## Tasks & Acceptance

**Execution:**
- [ ] Domain reconcile with tests (both orders, none, break size).
- [ ] Migration 0019, schema, repos (SQLite and memory), parity tests.
- [ ] Wire reconcile and the review item into `importStatement`.
- [ ] Move the parsers into `imports/parsers/`; the import and set-aside suites pass unchanged.
- [ ] `m1GateReport`, `m1-report` command, 12-month generated-data test, `docs/m1-gate.md`.
- [ ] Clear the lint warnings; `pnpm lint` with no warnings.

**Acceptance Criteria:**
- Given twelve generated monthly statements, when imported, then every batch is `ok` and the report shows zero gaps and twelve months.
- Given a statement with a dropped row, when imported, then the batch is `gap` with an open `import.balance_gap` item and the import still commits.
- Given the sweep, when `pnpm lint`, typecheck and the suite run, then they pass with zero warnings and `import-statement.ts` holds only the pipeline.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- Set-aside rows mid-file make neighbours look adjacent, faking a `gap` and a false BROKEN line (blind-adjacent, edge, gap) -- verdict: medium -- route: patch -- reconcile returns `unavailable` when the file has set-aside rows (the chain cannot be verified); add a test.
- Pre-0019 batches have null dates and read as holes or "no statements"; label "without printed balances" is wrong for them (blind, edge, gap) -- verdict: medium -- route: patch -- backfill `first_posted_on`/`last_posted_on` in the migration from the batch's transactions, leave `reconcile_status` null, relabel the CLI suffix "not balance-checked"; add a migrate test.
- Runbook says "to the present" but the report checks holes only up to the newest covered date; fix step says "import a corrected file" which leaves the broken batch (blind) -- verdict: medium -- route: patch -- correct the doc: the human confirms the newest covered date, and fixing a gap means undo the batch then import the corrected file; remove the duplicate Date row.
- CLI branches "no statements imported", "not balance-checked" suffix and the no-statements footer untested (gap) -- verdict: medium -- route: patch -- add CLI cases with an empty account and an `up_csv` import.
- `import.balance_gap` shows the generic "nothing to do here" read-only text (gap, blind) -- verdict: low -- route: patch -- give it specific read-only wording (balances don't chain, a row may be missing, undo the import and import a corrected file).
- Rows without balances skipped (partial check), CommBank CSV balance column now parsed (beyond a pure move), all-duplicate batch still counts toward coverage, no JSON/strict output, three `ReconcileStatus` types and no CHECK, invalid-date throw, private-account scope, nondeterministic test ids, parser files untested individually (blind, edge, gap, intent) -- verdict: low/false -- route: reject -- documented design (a statement covers its span even if its rows were duplicates), deliberate and tested change, or polish.

## Design Notes

Chain test per adjacent pair in file order: ascending when `b[i] - b[i-1] = amount[i]`, descending when `b[i-1] - b[i] = amount[i-1]`; pick the orientation with more matching pairs, and sum the absolute mismatches into `reconcile_gap_cents`. Coverage uses calendar days, so a weekend between files is a hole of two days; the report prints the span so the human decides whether it is explained.

## Verification

**Commands:**
- `npx vitest run` -- expected: all pass.
- `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm check:strict` -- expected: clean.
- `node apps/server/dist/cli.js m1-report` or the CLI test -- expected: per-account coverage and gap table.
