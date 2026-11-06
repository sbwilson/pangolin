---
title: 'Savings reconciliation engine: invariant check, deficit buffer absorption, and shortfall detection'
type: 'feature'
ticket: '3'
created: '2026-11-05'
status: 'built'
baseline_revision: 'de17beb6eebc685f20fa318f946d8f80c3346cb1'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/data-model.md'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 7.2's allocation engine takes `savingsCents` as caller input; nothing derives a period's new savings from savings-flagged accounts, and nothing checks the invariant "goal balances + buffer = pool savings balance". Deficit periods (spend exceeds income) and over-committed pools (goals exceed real savings once the buffer is exhausted) go undetected, so the books can silently disagree with the bank.

**Approach:** A reconciliation engine in `packages/app/src/planning/savings-reconciliation.ts`: per visible pool, derive period new savings (change in pool savings balances minus interest), feed positive amounts into the existing `executeSavingsAllocation` (idempotent per pool + period), let deficits pass through with zero allocations so only the derived buffer shrinks (Option A), and compute the invariant to report buffer and shortfall. The buffer stays derived — never stored.

## Boundaries & Constraints

**Always:**
- New savings for a pool = `balanceAsOf(periodEnd-1d) − balanceAsOf(periodStart-1d)` summed over the pool's savings-flagged accounts (AD-19, AD-26 pool keys), minus interest income credited to those accounts in the period (splits in category "Interest" under an income-kind group; interest lands in the buffer by default).
- Invariant by construction: `bufferCents = max(0, actualSavingsCents − goalTotalCents)`; `shortfallCents = max(0, goalTotalCents − actualSavingsCents)`; status `ok` when buffer ≥ 0, `over-committed` when shortfall > 0.
- Option A: a deficit never writes negative allocations and never touches `goal` or `goal_allocation` rows — goal balances only decrease via confirmed drawdowns (AD-24, built in 7.5).
- Idempotent per pool and `period_start` (AD-11): if any `goal_allocation` row for the pool's goals already exists at `periodStart`, skip allocation and report `alreadyAllocated: true`.
- Integer cents only (AD-13); viewer scoping: shared pool plus the viewer's own personal pool only (AD-3, AD-22); period input is half-open `[periodStart, periodEnd)` like `shared/period`.

**Never:**
- No review items, mismatch classification ("newly flagged account", "history not imported"), or buffer-adjustment UX — story 7.7 wires `review_item` from this engine's report. No goals-page UI (7.4), no drawdown/cover engine or `GoalDrawdownRepo` (7.5).
- Do not store a buffer balance, reconciliation-state table, or stored expectation anchor — derived on read (AD-11).
- Do not modify `goal_allocation` rows of earlier periods; do not resolve PayCalendar periods inside the engine (caller supplies period dates, as `executeSavingsAllocation` already does).
- Excluding goal-linked/covered withdrawals from new savings (AD-24) is out of reach here: `goal_link`/drawdown repos do not exist yet — leave a named extension point in the derivation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Positive derived savings | Pool savings up $1,000 in period, no allocations yet, stage rules active | `executeSavingsAllocation` runs with $1,000; allocations match stage shares; remainder is buffer | No error |
| Deficit period | Pool savings down $300 in period, buffer was $500 | Zero allocations; goal rows untouched; buffer now $200; status `ok` | No error |
| Deficit exhausts buffer | goalTotal $10,000 > actual $9,500 | buffer 0; shortfallCents 500; status `over-committed` | No error |
| Re-run same period | Allocations already exist for pool + periodStart | Allocation skipped; report `alreadyAllocated: true`; no duplicate rows | No error |
| Interest only | $100 interest credited, no other flow | New savings 0; no allocations; buffer grows $100 | No error |
| Intra-pool transfer | Move between two savings accounts of one pool | Δ 0; no allocations; no shortfall | No error |
| Personal pool | Person's own pool reconciles | Only that person's goals/accounts touched; partner viewer sees no report rows | AD-22 skip |
| Bad dates | periodStart ≥ periodEnd or non-YYYY-MM-DD | Rejected by zod input parse | `ValidationError` |

</frozen-after-approval>

## Code Map

- `packages/app/src/planning/goal-allocation.ts` -- reuse `executeSavingsAllocation`, `calculateGoalBalances`; same `write(ctx, (tx, audit) => …)` use-case style. Do not modify its allocation math.
- `packages/app/src/planning/goals.ts` -- reuse `SavingsPoolBalance` shape, pool keys (`"shared"` | personId via `poolOf` from `packages/app/src/accounts/pool.ts`), and its savings-flagged account selection (`account.isSavings`; open-at-asOf means `closedOn === null || closedOn >= asOf` -- an account closed mid-period is still in a snapshot taken at a boundary before its `closedOn`, and gone from one taken after). `getSavingsPoolBalances(ctx, {asOf})` gives per-account `balanceCents` at any date via `balanceSnapshots.balanceAsOf` (AD-19).
- `packages/app/src/ports/unit-of-work.ts` -- `DayRange` (line ~533), `TransactionRepo` (add one sum method here), `GoalAllocationRepo.listForPeriod(viewer, periodStart)` (idempotency check), `categories.list` + `categoryGroups.list` (kind `income`) for the Interest category id; `GoalRepo.listVisible`.
- `packages/db/src/ledger-repos.ts` -- `TransactionRepo` SQL impl; add the split-sum query here (SQL pushdown, mirror `cashFlowTotals` style at ~line 424).
- `packages/app/src/testing/memory-uow.ts` -- in-memory impl of the new `TransactionRepo` method; transactions/splits already in `MemoryState`.
- `packages/app/src/testing/repo-parity.test.ts` -- register the new method so memory and SQLite agree.
- `packages/app/src/index.ts` -- export new use cases/types.
- `packages/app/src/planning/goal-allocation.test.ts` -- test style: `memoryUnitOfWork()`, push rows into `uow.state.*`, `UseCaseContext` with `fixedClock`, assert on result + `uow.state`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/ports/unit-of-work.ts` -- Add `sumSplitCents(viewer, accountIds, categoryIds, range: DayRange): number` to `TransactionRepo` (sum of signed split amounts on live transactions of those accounts in range, restricted to the categories) and to the `ReadRepos` narrowing. -- SQL-pushdown sum for interest exclusion
- [ ] `packages/db/src/ledger-repos.ts` + `packages/app/src/testing/memory-uow.ts` + `packages/app/src/testing/repo-parity.test.ts` -- Implement `sumSplitCents` in SQLite and MemoryUow; cover in parity tests. -- one definition, two doubles
- [ ] `packages/app/src/planning/savings-reconciliation.ts` -- New module: `derivePoolNewSavingsCents` (pure: end − start − interest, with named extension point for AD-24 withdrawal exclusions), `reconcilePool` (pure invariant math), use cases `runSavingsReconciliation(ctx, {periodStart, periodEnd, pool?})` (derive → allocate-if-positive via `executeSavingsAllocation` → report; the delta sums per-boundary account sets and the interest sum the union, per Design Notes) and `getSavingsReconciliation(ctx, {asOf?})` (read-only per-pool report). -- domain + use cases
- [ ] `packages/app/src/planning/savings-reconciliation.test.ts` -- Unit tests for every I/O matrix row, for an account closed mid-period (its departure reads as a deficit, never as a phantom gain), incl. "deficit reduces only the buffer" balance-identity assertions and over-committed shortfall amounts. -- ticket verify
- [ ] `packages/app/src/index.ts` -- Re-export the new use cases and result types. -- public surface

**Acceptance Criteria:**
- Given a period where a pool's savings accounts fall while goals hold buffer, when `runSavingsReconciliation` runs, then no `goal_allocation` or `goal` row changes and the report shows the deficit absorbed by the buffer (ticket verify).
- Given goal balances exceeding actual savings, when either use case runs, then the pool reports `over-committed` with `shortfallCents = goalTotal − actual` and buffer 0 (ticket verify).
- Given positive derived savings, when `runSavingsReconciliation` runs twice for one pool and `periodStart`, then allocations exist once (`alreadyAllocated` on the second run).
- Given a period with only interest income in a savings account, when reconciliation runs, then new savings is 0 and the interest appears in the buffer, not in allocations.

## Implementation Notes

- Re-derivation (loopback 1) plus a post-implementation style repair: the new test file initially used 72 non-null assertions (`x!.f()`), tripping biome's `noNonNullAssertion` warnings; converted to optional chaining, with the fixture sites switched to row references (`ef`) and the `fixture()`-exposed `a`/`b` person ids. Final state: `pnpm test` 208 files green, biome back to the baseline 2 errors / 157 warnings (all in `apps/server` and `tools/seed`), `packages/app` typecheck clean.
- Disclosed minimal baseline repairs (pre-existing typecheck debt from 7.2): `write.ts` re-exports `UseCaseContext`; `goals.ts` hoists `ctx.viewer` for narrowing; `goals.test.ts` snapshot fixtures gained `updatedAt`.

## Plan Change Log

### 2026-11-06 — loopback 1 (bad_plan)

- **Triggered by:** review finding — `runSavingsReconciliation` built its account list only from the end-boundary `getSavingsPoolBalances` snapshot; a savings account closed mid-period drops out of both sides of the new-savings delta and out of the interest exclusion, hiding deficits and over-allocating phantom gains. The Code Map's "open at asOf" note is what steered the derivation there.
- **Amended:** Code Map (`goals.ts` closedOn semantics spelled out), Design Notes (two-boundary account-set bullet; `DayRange` field names corrected to `{from, to}`), Tasks (account-set requirement on the module task; closed-mid-period case on the test task).
- **Known-bad state avoided:** one-sided account sets for the period delta; any deviation from the frozen two-boundary sum over the pool's savings accounts.
- **KEEP:** the `sumSplitCents` port + SQL/memory implementations + parity scenarios; `reconcilePool` and `derivePoolNewSavingsCents` (with the named AD-24 `excludedGoalWithdrawalCents` extension point); idempotency via `listForPeriod` + per-pool goal filter; the report shape; Option-A no-write on deficits with the byte-compare tests; interest selection via income-kind group + `"Interest"` name (absent → 0); viewer scoping and the `NotFound` pool guard; date validation; the test-fixture style.

## Review Triage Log

| Finding | Verdict | Action Taken |
|---|---|---|
| Mid-period-closed savings account drops from both sides of the new-savings delta and the interest exclusion (`runSavingsReconciliation` used only the end-boundary `getSavingsPoolBalances` account set) | True (medium) | bad_plan loopback: Code Map + Design Notes pinned the two-boundary account set; code reverted and re-derived. |
| Unknown `pool` key yields an all-zero `ok` report for non-person viewers (`NotFound` guard is person-only) | Low — rejected | No production caller exists; 7.7's keys come from `getSavingsReconciliation` and cannot be unknown; a real fix needs a people lookup — new complexity for an unreached input. The guard mirrors `executeSavingsAllocation`'s person-only check. |
| AC2's read-only branch unproven: `getSavingsReconciliation` is only ever called on `ok` pools, so its over-committed composition (the row 7.7's warning colour reads) has no test (`savings-reconciliation.test.ts`) | True (low) | Patch: asserted `getSavingsReconciliation` over-committed output in the deficit-exhausts-buffer test. |
| Multi-pool run is not atomic — a throw mid-loop leaves earlier pools allocated and later pools unreported (`runSavingsReconciliation`) | False | Refuted: per-pool write transactions with idempotency per pool + `period_start` is the ratified AD-11 design; re-run completes safely (the reviewer concedes it); no demonstrated throw path for engine-supplied integer inputs — loud failure on an unreached situation is correct behavior; the proposed remedy is plan guidance, which triage rejects. |

## Design Notes

- Report shape per pool: `{ pool, actualSavingsCents, goalTotalCents, bufferCents, shortfallCents, status: "ok" | "over-committed", newSavingsCents, allocatedCents, alreadyAllocated }`. 7.7 maps `over-committed` to a shortfall review item and the "any other mismatch" classification needs its own expectation anchor -- deliberately absent here.
- Balance dates: half-open period `[start, end)`; `balanceAsOf` is on-or-before, so boundaries are `start − 1 day` and `end − 1 day`; interest range is the inclusive `DayRange { from: start, to: end − 1 day }`.
- Two-boundary account set: snapshot `getSavingsPoolBalances` at BOTH boundaries. Start balances sum the accounts present in the start-boundary snapshot; end balances those in the end-boundary snapshot; the interest sum covers the union of the per-pool account ids at the two boundaries; an account missing a `balanceAsOf` at a boundary contributes 0 there. An account closed mid-period must therefore weigh on the delta -- its money leaving the pool via closure is a deficit, and skipping it would overstate new savings and over-allocate.
- Interest category id: find category group with `kind === "income"` whose category list contains name `"Interest"` (default tree, `packages/app/src/classify/defaults.ts:35`); when absent, interest exclusion is 0.
- Pool visibility mirrors `getGoalsSummary`: person viewers see the shared pool plus their own personal pool.

## Verification

**Commands:**
- `pnpm --filter @pangolin/app test` -- expected: savings-reconciliation, goal-allocation and goals tests pass
- `pnpm --filter @pangolin/db test` -- expected: ledger repo and parity tests pass
- `pnpm test` -- expected: whole workspace green
- `pnpm lint` -- expected: biome check passes

## CI Fix Trail (post-commit)

CI on `develop` had never run the 7.1/7.2 commits (remote was behind), so first-run failures surfaced only after 7.3's push. None originated in 7.3 code. Sequence:

1. `1556eba` chore(lint): biome import order in `tools/seed/src/modules/index.ts` + formatting in `packages/db/src/migrate.test.ts`.
2. `0c36d07` fix(planning): typecheck — `type Id` import and dropped `archivedAt` inserts in `apps/server/src/http/app.test.ts`; `asOf?: string | undefined` on `getSavingsPoolBalances`/`getGoalsSummary` (exactOptionalPropertyTypes); complete `Session` mock in `GoalsPage.test.tsx`.
3. `d8dbcbe` fix(db): added missing `packages/db/migrations/meta/0028_snapshot.json` — the 7.1 commit shipped `0028_goals_savings.sql` + journal entry without its snapshot, so `db:generate` regenerated the goals/savings tables and the "migrations match the schema" gate failed. Committed SQL and journal left untouched.
4. `8c25c68` test(web): `HouseholdSettings.test.tsx` pay-anchor save switched to `fireEvent.change` — keystroke `user.type` raced on CI (net state `""` at save, 2/2 failures on CI, green locally incl. 6x repeats).

Final run https://github.com/sbwilson/pangolin/actions/runs/42185846127: secret scan, lint+types+tests+STRICT, and container/e2e all success.
