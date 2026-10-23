---
title: 'Contribution and apportionment'
type: 'feature'
ticket: '3'
created: '2026-10-24'
baseline_revision: '3ba0a9c12f1a12ae4fe2176244a51a2060a81e80'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing works out who contributed what to shared costs, so a person's share of shared spending cannot be apportioned, and the seed has no personal-to-shared transfers to prove it.

**Approach:** A pure `domain` function apportions the shared total by contribution (or evenly), a `reports.sharedApportionment(range)` use case feeds it SQL sums over public accounts only (AD-7), and the seed gains each partner's transfers into the joint account with `performedBy` set. No route or UI here (entry 4).

## Boundaries & Constraints

**Always:**
- Shared total = −sum of `expense` splits (AD-23) with `beneficiary = 'shared'` on public accounts in the inclusive range. Pending and posted both count.
- Contribution of person P = (a) positive splits on public shared-pool accounts (2+ owners) whose transaction is linked to a counterpart that is not itself a shared-pool account, with payer = `performedBy`; plus (b) shared `expense` out of public single-owner accounts, payer = `payerOf(owners, performedBy)`. Only person payers count; a `shared` payer (null `performedBy` on a joint account) is unattributed. Outflows from shared accounts and salary paid straight into a shared account (unlinked) never count (decision 2026-10-23).
- Everything is computed from public accounts only, so both partners get byte-identical figures. For this, the counterpart of a public row is classed as hidden whenever its account is private, whoever is asking.
- Apportion across the active people. Setting `contribution`: weights = each person's contribution cents; total contribution zero → equal weights. Setting `even`: equal weights. Rounding is only `allocate`, so shares sum exactly to the shared total.
- Sums in SQL (AD-11, AD-13); the web never sums or rounds money.

**Never:**
- No route, settings control, UI, share line or toggle (entry 4); no stored totals, tables or migrations.
- No read of a private account's rows into any shared figure; `db` must not import `domain`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Transfers in | A moves 600, B 400 from their private accounts into joint everyday, `performedBy` set | contributions 600 / 400; 60% / 40% of shared total | No error expected |
| Paid personally | shared-beneficiary −90 on A's public personal account | adds 90 to A | No error expected |
| Even setting | `even` with unequal contributions | 50/50 | No error expected |
| Zero contribution | no attributable contribution in range | 50/50 under `contribution` | No error expected |
| Odd cent | shared total 10001, 50/50 | shares 5001 and 5000 sum to 10001 | No error expected |
| Unattributed | transfer into joint account, `performedBy` null | counts for neither person | No error expected |
| Shared→shared | joint-to-joint transfer | not a contribution | No error expected |
| Partner view | same range requested as A and as B | identical output, including with only A's private data changed | No error expected |
| Bad range | `from` > `to`, or not `YYYY-MM-DD` | 400 | Zod error via existing path |

</frozen-after-approval>

## Code Map

- `packages/domain/src/flows/flow-kind.ts`, `index.ts` -- add `packages/domain/src/flows/apportion.ts` beside it and export; pure; rounds only through `allocate` (`packages/shared/src/money.ts:30`; confirm `domain` may import it in `scripts/check-boundaries.ts`).
- `packages/db/src/privacy.ts:184` -- `flowKindSql(viewer)` and `flowCounterpartSql`; add a `publicOnly` option treating private counterparts as `'hidden'`.
- `packages/db/src/ledger-repos.ts:421,816` -- `cashFlowTotals` shape to copy for the new `sharedFigures`; wiring at :816.
- `packages/app/src/ports/unit-of-work.ts:532,696,1695` -- `DayRange`, `cashFlowTotals`, repo-method name list; add `sharedFigures(viewer, today, range)` returning `{sharedExpenseCents, contributions: {personId, cents}[]}`. `HouseholdSettingsRow.sharedAttribution` at :14.
- `packages/app/src/testing/memory-uow.ts:158,1680,3056` -- in-memory mirror (settings, repo, `householdSettings.get`); implement via domain `flowKind` + `payerOf`.
- `packages/app/src/accounts/pool.ts:63,76` -- `poolOf`, `payerOf` (exported from `app` index :67).
- `packages/app/src/reports/cash-flow-totals.ts`, `breakdown.ts:10` -- use-case shape and `rangeInput`.
- `packages/app/src/testing/flow-kind-parity.test.ts` -- parity pattern; extend for `publicOnly` and `sharedFigures`.
- `packages/app/src/ledger/seed-transactions.ts:70` -- hard-codes `performedBy: null`; thread an optional seed `performedBy`.
- `tools/seed/src/world.ts` (`TransactionCreatedEvent`), `tools/seed/src/modules/transfers-and-privacy.ts:108-300`, `modules/catalogue.ts:14` -- `ACCOUNT_KEYS.privateA/privateB` → `everyday` pairs go here, with `expectations`; `packages/shared/src/seed-references.ts:145` validates seed refs; `apps/server/src/admin/seed.ts` applies them.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/domain/src/flows/apportion.ts` (+ export, unit test) -- `apportion({sharedCents, contributions, people, setting})` → per-person shares, basis, via `allocate` -- the one apportioner.
- [ ] `packages/db/src/privacy.ts` -- `publicOnly` option on `flowKindSql` -- viewer-independent classification.
- [ ] `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/ledger-repos.ts`, `packages/app/src/testing/memory-uow.ts` -- `sharedFigures` repo method (SQL sums over public accounts; memory mirror) -- the inputs.
- [ ] `packages/app/src/testing/flow-kind-parity.test.ts` -- `publicOnly` classification and `sharedFigures` memory-vs-SQLite per viewer -- AD-23 parity.
- [ ] `packages/app/src/reports/shared-apportionment.ts` (+ index export, test) -- use case `(ctx, {from, to})` reading settings and people, Zod range -- covers the I/O matrix and a privacy test (changing only A's private data leaves B's result equal).
- [ ] `packages/app/src/ledger/seed-transactions.ts`, `tools/seed/src/world.ts`, `tools/seed/src/modules/transfers-and-privacy.ts`, `packages/shared/src/seed-references.ts` -- seed `performedBy`; add monthly private-to-joint-everyday transfers for A and B in a documented ratio, recorded in `expectations` -- reproducible percentages.
- [ ] `apps/server/src/http/shared-apportionment-seed.test.ts` -- apply the default seed; assert the documented percentages for `contribution`, 50/50 for `even`, a zero-contribution range, shares sum to the total, A and B identical -- the ticket's verify.

**Acceptance Criteria:**
- Given the extended seed, when the use case runs as either partner, then contribution shares match the documented percentages and the output is identical for both.
- Given the `even` setting or a zero-contribution range, when apportioned, then each share is half, exact to the cent.
- Given the full suite, when run, then lint (including boundaries), typecheck, unit and seed/privacy tests pass, and existing seed expectations still hold.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment)

Counts: high 0 · medium 0 · low 6 · false 4 · maybe-false 1 (patch 4, defer 1, reject 12 of ~30 findings, grouped).

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | blind + edge + gap | No-active-people branch returned basis `even` under `contribution` and was untested | low | patch | Fixed to `even-fallback`; test added (SQLite + memory). |
| 2 | gap | Negative-contribution clamp and negative shared total unasserted | low | patch | Three `apportion` cases added. |
| 3 | gap | `performedBy` reference check in `seed-references.ts` had no rejecting test | low | patch | Valid and unknown-key cases added. |
| 4 | blind | Misplaced doc comments in `memory-uow.ts` | low | patch | Comments moved to the right functions. |
| 5 | blind + edge | Correlated SQL is heavy for the 50k profile; no timing evidence | maybe-false | defer | Medium if true; a cash-flow-style perf case on the 50k profile would settle it. |
| 6 | blind | Outflows never net against contributions | false | reject | Plan Always rule and AD-23 count transfers *into* shared accounts only. |
| 7 | blind + edge | Unattributed or null-payer rows summed then filtered | false | reject | Filtered by payer in the same query; I/O row "Unattributed" passes. |
| 8 | blind | Feature not exposed by route/UI | false | reject | Intent excludes route and UI (entry 4). |
| 9 | edge | Zero-owner public account skipped where `poolOf` throws | low | reject | Corrupt data; fix adds a guard in two layers. |
| 10 | blind + edge | Contributions of inactive people silently dropped | low | reject | Plan apportions across active people; unlikely in a two-person household. |
| 11 | blind + edge | `TRANSFERS_AND_SURPRISES = 140` hand-edited magic number | low | reject | Follows the existing literal pattern; deriving it is more than a direct fix. |
| 12 | edge | Seed permille `Math.round` and `noContributionRange` assume two people and a window start | low | reject | Seed has two people and a 24-month window; guards add complexity. |
| 13 | blind + edge | Seed test position-based odd cent, range boundaries, pending rows, `Number(..)||0` | low | reject | Test hardening only; not met in everyday use. |
| 14 | intent | Contribution broader than "transfers into joint" | false | reject | Plan Always rule (b) fixes it; descriptive only. |

## Design Notes

AD-7 says contribution reads "only the shared side of a transfer (`performed_by` on the public account's transaction)", so the seed must set `performedBy`; today it is always null. Seed accounts have no public single-owner account, so term (b) is proved in use-case tests, not by the seed.

## Verification

**Commands:**
- `pnpm lint` -- expected: biome and boundary check clean
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass, including parity, privacy and seed tests
