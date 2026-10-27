---
title: 'Tracer bullet: flowKind and the Cash flow landing page'
type: 'feature'
ticket: '1'
created: '2026-10-23'
status: done
baseline_revision: 'd9513ea88f5bb99cb36c1fde399a598e882f2d40'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing classifies a split as income, expense, transfer or investing, so no report can total cash flow, and `/` still lands on Transactions instead of Cash flow.

**Approach:** Add the single AD-23 `flowKind` (pure `domain` function plus one viewer-aware SQL expression, proven equal by a parity test), a `cashFlowTotals(viewer, range)` use case over `visibleTxn` returning money in, money out and kept, a `/api/reports/cash-flow` route, a minimal `/cash-flow` page with three KPI tiles, and switch `/` and the Cash flow nav link to it.

## Boundaries & Constraints

**Always:**
- AD-23 rules, in order, per split: linked transfer whose counterpart account is `transaction|savings|offset|credit_card` → `transfer`; counterpart `home_loan` → `expense` when the split amount is negative (a repayment), else `transfer` (a redraw; decision 2026-10-23, user); counterpart `brokerage|super` → `investing`; split's category group kind `transfer` → `transfer`; else `income` if amount > 0, `expense` if < 0 (zero → `expense`, contributes 0). A link whose counterpart is any other type, or is deleted, falls through to the category and sign rules.
- A counterpart the viewer cannot see (partner's private account) → `transfer`, whatever its type, so B's figures never depend on A's private data (AD-3, AD-4).
- Money in = sum of `income` split amounts; money out = −sum of `expense` split amounts; kept = in − out (may be negative). `transfer` and `investing` count in neither. Pending and posted rows both count (matches the Transactions summary). Range is inclusive on `posted_on`.
- All sums in SQL over `visibleTxn(viewer, today).where`; the web never sums or rounds money (AD-11, AD-13).
- New `/api` route registered in `route-manifest.ts` so the byte-identical partner privacy test covers it.

**Never:**
- No charts, date-range control, share line/toggle, empty-state card or drill-through (later entries).
- No stored totals or new tables/migrations.
- `db` must not import `domain`; no scoped-table reads outside `privacy.ts`, `ledger-repos.ts`, `unit-of-work.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card repayment | −500 from Everyday linked to +500 on credit card | both splits `transfer`; totals unchanged | No error expected |
| Loan repayment | −2000 Everyday linked to home loan | Everyday split `expense` (out +2000); home-loan side `transfer` | No error expected |
| Loan redraw | +1500 Everyday linked to home loan | `transfer`; in neither total | No error expected |
| Into brokerage | −1000 Everyday linked to brokerage | `investing`; not in out | No error expected |
| Partner's private counterpart | B's shared-account row linked to A's private account (any type) | `transfer` for B | No error expected |
| Unlinked transfer category | +300, category in kind-`transfer` group, no link | `transfer` | No error expected |
| Refund | +40 on expense category, unlinked | `income` (per AD-23 sign rule) | No error expected |
| Uncategorised spend | −25, no category | `expense` | No error expected |
| Bad range | `from` > `to`, or not `YYYY-MM-DD` | 400 | Zod validation error via existing AppError path |

</frozen-after-approval>

## Code Map

- `packages/db/src/privacy.ts:95` -- `visibleTxn`; counterpart-account alias pattern at :120-135 (`transferLabel`) to copy for the counterpart type/visibility lookup. Add `flowKindSql(viewer)` here (scoped-table reads allowed).
- `packages/db/src/ledger-repos.ts:675` -- `summarise`: model for the new SQL aggregate (split JOIN transaction, `visibleTxn().where`).
- `packages/app/src/ports/unit-of-work.ts:522,653` -- `TransactionSummary` / `summarise` port: add the new repo method beside it.
- `packages/app/src/testing/memory-uow.ts:1680` -- in-memory mirror; must implement the new method using domain `flowKind`.
- `packages/app/src/testing/transaction-list-parity.test.ts:396` -- memory-vs-SQLite parity pattern.
- `packages/app/src/ledger/list-transactions.ts:34` -- use-case shape `(ctx, input)` with Zod, `ctx.uow.read`, `ctx.clock.today()`; privacy test style in `ledger/ledger.test.ts:848`.
- `packages/shared/src/money.ts` (`Cents`), `packages/shared/src/period/index.ts` (`Period`).
- `packages/db/src/schema/{account,transaction,split,category,category-group}.ts` -- `account.type`, `transaction.transfer_group_id`, `split.category_id`, `category_group.kind`.
- `scripts/check-boundaries.ts:27-47` -- package import rules.
- `apps/server/src/http/app.ts:246,355` -- `createApi`, route chain, `ctx(c)`; `AppType` :812. Tests in `http/app.test.ts` (`deps()` :78, `signedIn` :121).
- `apps/server/src/privacy/route-manifest.ts:116,222` -- `read("/api/…")` entries.
- `apps/server/src/admin/seed.ts` + `seed.test.ts` -- applying a generated seed in-process (reuse for the hand-sum test).
- `apps/web/src/routes/home.tsx` -- `/` redirect; `routes/review.tsx` + `pages/ReviewPage.tsx` + `api.ts:238` -- page/fetcher pattern; `router.tsx:15`; `lib/money.ts` `formatCents`; `lib/date-range.ts:24` `quarterRange`, `localDay`.
- `apps/web/src/components/AppSidebar.tsx:27`, `MobileNav.tsx:28` -- Cash flow links (`to="/"`, exact).
- `e2e/routing.spec.ts:85`, `e2e/shell.spec.ts:54,80,87,107`, `e2e/axe.spec.ts:164` -- assertions to change / add.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/domain/src/flows/flow-kind.ts` (+ index export, unit test) -- `FlowKind` type and pure `flowKind({amountCents, counterpart, groupKind})` where `counterpart` is `null | "hidden" | AccountType` -- the one classifier.
- [ ] `packages/db/src/privacy.ts` -- `flowKindSql(viewer)`: a SQL CASE over `split`+`transaction` producing the same four strings, resolving counterpart type and visibility via `visibleAccounts` -- one SQL expression for every aggregate.
- [ ] `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/ledger-repos.ts`, `packages/app/src/testing/memory-uow.ts` -- `cashFlowTotals(viewer, today, period): {moneyInCents, moneyOutCents, keptCents}` on the transaction repo -- SQL sum by `flowKindSql`; memory mirror via domain `flowKind`.
- [ ] `packages/app/src/testing/flow-kind-parity.test.ts` -- build every I/O-matrix case (plus deleted counterpart and other-type link) in SQLite; assert `flowKindSql` per split equals domain `flowKind`, and memory vs SQLite `cashFlowTotals` agree per viewer -- AD-23 parity.
- [ ] `packages/app/src/reports/cash-flow-totals.ts` (+ index export, test) -- use case `(ctx, {from, to})`, Zod-validated, `from ≤ to` -- includes a privacy test: changing only A's private data leaves B's result equal.
- [ ] `apps/server/src/http/app.ts`, `app.test.ts`, `privacy/route-manifest.ts` -- `GET /api/reports/cash-flow?from&to` -- route plus 200/400/401 tests and manifest entry.
- [ ] `apps/server/src/http/cash-flow-seed.test.ts` -- apply the default seed, then for each partner compare the route's three figures with an independent hand sum over the seed's splits -- the ticket's verify.
- [ ] `apps/web/src/api.ts`, `routes/cash-flow.tsx`, `pages/CashFlowPage.tsx`, `router.tsx` -- page titled "Cash flow" fetching the current quarter (`quarterRange(localDay())`), three tiles "Money in", "Money out", "Kept" formatted with `formatCents`, loading and error states like ReviewPage.
- [ ] `apps/web/src/routes/home.tsx`, `components/AppSidebar.tsx`, `components/MobileNav.tsx` -- redirect and links to `/cash-flow`.
- [ ] `e2e/routing.spec.ts`, `e2e/shell.spec.ts`, `e2e/axe.spec.ts` -- `/` → `/cash-flow`, Cash flow link lands there with `aria-current="page"`, axe block for `/cash-flow`.

**Acceptance Criteria:**
- Given a signed-in partner, when they open `/`, then they land on `/cash-flow` showing Money in, Money out and Kept for the current quarter.
- Given the seeded household, when each partner requests cash-flow totals, then each figure equals a hand sum of that partner's visible splits by AD-23.
- Given only A's private data changes, when B requests `/api/reports/cash-flow`, then the response bytes are unchanged.
- Given the full check suite, when run, then lint (including boundaries), typecheck, unit, Playwright and axe pass.

## Implementation Notes

- Repo method takes an inclusive `DayRange {from, to}` (new port type), not the half-open shared `Period`.
- Test-only `splitFlowKinds(db, viewer, today)` exported from `@pangolin/db` so the parity test can read each split's SQL class.
- `privacy.test.ts` gained `CASH_FLOW_QUERIES` (real ranges) so the byte-identical replay compares 200s, not two 400s.
- Counterpart with more than two live group rows: lowest id, in SQL and memory. A soft-deleted category still counts for its split.
- `RootLayout.tsx`: every post-sign-in landing now goes to `/cash-flow` (UX: landing after sign-in is Cash flow); `e2e/routing.spec.ts` sign-in assertion updated.
- Deleting one side of a transfer unlinks the survivor (existing behaviour, `delete-transaction.ts`), so A deleting a private side turns B's linked shared row back into income/expense by sign.
- Review patches (loop 1): redraw rule, every account type and a deleted category in parity, hidden-counterpart seed assertion (the seed has no linked loan repayments, so no home-loan assertion), sign-in URL asserts, page error/stale fix, cash-flow perf case (~117 ms on 50k rows).
- Verified: lint, typecheck, `pnpm test` (2276 passed), local Playwright + axe (90 passed, 2 skipped; only the deliberate CSP-failure case fails).

## Plan Change Log

- **Loop 1 (2026-10-23), triage #1 (intent_gap, medium):** a positive split linked to a home loan (redraw) was classed `expense`, shrinking money out. The user decided a redraw is a `transfer`; the frozen home-loan rule and the I/O matrix (new "Loan redraw" row) were amended by the user's decision. Resolved as a targeted fix to `flowKind`, `flowKindSql` and their tests, with no revert. KEEP: everything else in the implementation, which passed lint, typecheck, unit, e2e and axe.

## Review Triage Log

### Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment)

Counts: high 0 · medium 1 · low 13 · false 5 · maybe-false 1 (20 findings).

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | edge-case | Positive split linked to a home-loan counterpart (redraw) is classed `expense`, shrinking money out | medium | intent_gap | Frozen rule maps any `home_loan` counterpart to `expense`; AD-23 only names *repayment into* a home loan. A redraw's class is undecided by the intent. |
| 2 | verification-gap | No test asserts sign-in lands on `/cash-flow` | low | patch | Real sign-in e2e tests check only "Signed in as Alex"; add a `pathname === "/cash-flow"` assertion to the password and passkey tests in `e2e/auth.spec.ts`. |
| 3 | verification-gap | Soft-deleted transfer-kind category not in the parity matrix | low | patch | `deleteCategory` keeps splits; no test builds a deleted category. Add a `deletedCategory` parity case. |
| 4 | blind | Parity test lacks `offset`, `super`, `vehicle`, `other` counterparts; SQL literals unchecked against domain sets | low | patch | `ACCOUNTS` covers 6 of 10 types; a typo in `WHEN 'offset'`/`'super'` passes. Add one linked pair per `FlowAccountType`. (Merged: blind finding on SQL literals not tied to domain sets — same gap.) |
| 5 | blind | Seed hand-sum test never asserts home-loan or hidden-counterpart links exist | low | patch | Only income/expense/transfer counts > 0 are asserted; assert the seed has ≥1 home-loan-linked expense and ≥1 hidden-counterpart transfer (seed has no brokerage, so investing cannot be asserted). |
| 6 | edge-case | Error alert shows beside stale tiles after a failed background refetch | low | patch | `CashFlowPage.tsx` renders the alert on `isError` regardless of cached data; show it only when `data === undefined`. |
| 7 | blind | `formatCents(tile.cents ?? 0)` masks missing data as zero | low | patch | The `dl` renders only when `data` is defined, so the fallback is dead; derive tiles from defined `data` and drop `?? 0`. |
| 8 | blind | Cost of the correlated flowKind subqueries is unmeasured | maybe-false | patch | `ledger-perf.test.ts` has a 50k-row harness; add a cash-flow-over-full-range timing case (≤300 ms like its siblings) to settle it. |
| 9 | blind + edge-case | A deleting/removing A's private leg changes B's figures | low | defer | Every removal path unlinks the survivor (decision 81, `delete-transaction.ts`, `leave-household.ts`), so B's own row loses its link; pre-existing and already visible to B via the vanished transfer label. No change in this diff can prevent it. |
| 10 | blind | Privacy test never deletes A's private leg | low | reject | Same root cause as #9; once unlinked, B's row is B's own data changing, which the byte-identical rule does not cover. |
| 11 | edge-case | 3+ leg transfer groups make B's class depend on A's leg ids | false | reject | `createTransferGroupInput` is `z.tuple([idInput, idInput])` (`transfer-groups.ts:17`): groups are pairs. |
| 12 | blind | `handSum` ignores unknown seed event types | low | reject | Test hardening that adds guards; unlikely to bite in everyday use. |
| 13 | blind | Page never shows which period it covers | low | reject | Range display is the header date-range control of entry 2; the frozen block excludes the range control here. |
| 14 | blind | Error state has no retry and treats 401 as a fault | low | reject | Copies the existing ReviewPage pattern; session expiry is handled by the RootLayout gate. Fix adds new behaviour. |
| 15 | blind | Route casts query instead of a typed validator | false | reject | Matches the file's convention (`c.req.query` at `app.ts:457,503`); Zod in the use case returns 400 for bad input (tested). |
| 16 | blind | Test-only `splitFlowKinds` exported from `@pangolin/db` main entry | low | reject | Lives in `ledger-repos.ts` (an allowed scoped reader); moving it needs a new package subpath, more than a direct correction. |
| 17 | blind | No test compares cash flow with the Transactions summary | low | reject | Not required by intent; the two count different things (flowKind vs sign). |
| 18 | blind | Plan checkboxes unticked, change log empty, stale line numbers | false | reject | Fix edits this build's plan. |
| 19 | blind | Other flows may still treat `/transactions` as home | false | reject | `/ledger` → `/transactions` is a legacy deep-link redirect; `TransactionCards` link is a deep link; recovery completes through `signedIn`/`refresh` and the gate now lands on `/cash-flow`. |
| 20 | intent-alignment | Descriptive: diff implements viewer-dependent classification (A2), current quarter, F3 landing | false | reject | Descriptive only; matches the frozen intent. |

## Design Notes

Counterpart is resolved per transaction from the other live row in the same `transfer_group`; `"hidden"` when that row's account is not in `visibleAccounts(viewer)`. That makes `flowKind` viewer-dependent only through visibility, which AD-3 allows (household totals may differ between partners) and keeps B's figures independent of A's private account types.

## Verification

**Commands:**
- `pnpm lint` -- expected: biome and boundary check clean
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass, including parity, privacy and seed hand-sum tests
- `pnpm e2e` and `pnpm test:axe` (with `E2E_SEED_COMMAND` set as in CI) -- expected: green
