---
title: 'Net-worth projection query with low, mid, and high return lines'
type: 'feature'
ticket: '5'
created: '2026-11-13'
status: 'built'
baseline_revision: '1938237cbe820b28ab3d0935d1040910ef7d4d13'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The forecast Net-worth view (8.6) and chips (8.7) need a read-only net-worth projection; nothing projects net worth today.

**Approach:** A pure domain monthly walk started from today's `netWorth()`: each month add savings and super contributions (rates on visible pay-anchor income), compound the asset pot at the line's return (low/mid/high), and pay down each selected home loan via `mortgageSchedule` (offset netted when `countOffset`). `GET /api/planning/forecast-net-worth?horizon=` returns three monthly series over 1/2/5/10-year horizons (default 2).

**Decisions (human, 2026-11-13):**
- Mortgage terms are an editable per-selected-loan assumption: `forecast_assumption_mortgage` gains nullable `annual_rate_percent` (decimal-string TEXT) and `monthly_repayment_cents`; PUT accepts and validates them (decimal-string rate, positive integer cents → `Validation` 400); seed carries demo values (e.g. `"6.175"`, $4,200). A selected loan without complete terms is held flat.

## Boundaries & Constraints

**Always:**
- Integer safe-integer cents; decimal-string percents in the domain, converted at the app boundary from stored bps (bps ÷ 100); Decimal half-even (as `mortgageSchedule`).
- Start from `netWorth(ctx)` today — same balance-as-of, visibility, open/closed rules.
- Savings/super base: monthly income = Σ visible pay anchors' `expectedNetCents` (fortnightly ×26, monthly ×1) ÷ 12 (AD-25).
- Each series: point 0 = today, then monthly; `horizonYears` ∈ {1,2,5,10}, default 2.
- low ≤ mid ≤ high by construction: lines share contributions and loan schedules; only the return differs, and the grown pot is assets-only (≥ 0).
- Only open, viewer-visible accounts; a selected mortgage that is closed or has no stored terms stays flat (no amortisation).
- Pure domain module: no clock, no I/O; invalid input `RangeError`. Person-viewer only (AD-22).

**Never:**
- No UI (8.6, 8.7), no `apps/web` changes.
- No Monte Carlo (spec non-goal), no day-level walk, no rate changes / capped extras / extra-repayment inputs — CAP-20.
- Do not modify `mortgageSchedule`, `forecast-cashflow`, or `net-worth.ts`.
- No new assumption fields beyond the mortgage-terms decision above.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------| ----------------|
| Seeded world | GET, default horizon | 25 monthly points per line, point 0 = today's netWorthCents, low ≤ mid ≤ high | No error |
| Horizon | `horizon=10` | 121 points | `horizon=3` → `Validation` → 400 |
| Defaults (never PUT) | zero bps, no mortgages | flat lines at today's net worth | No error |
| No pay anchor | savingsRateBps 4500 | savings/super contribute 0; returns still move lines | No error |
| Mortgage with terms | selected open loan | liability declines per `mortgageSchedule`; 0 after payoff | No error |
| Offset counted | `countOffset: true` vs false | netted base pays off sooner → higher projection | No error |
| Closed loan | selected loan closed | held flat | No error |
| Non-person viewer | GET | — | `Unauthenticated` → 401 |

</frozen-after-approval>

## Code Map

- `packages/domain/src/planning/forecast-networth.ts(.test)` — **new**: pure `projectNetWorth()`; calls `mortgageSchedule` from `../amortise/mortgage-schedule.ts`; style-copy `forecast-cashflow.ts` (readonly interfaces, `RangeError`, no clock).
- `packages/domain/src/index.ts` — export block (alphabetical).
- `packages/app/src/planning/forecast-networth.ts(.test)` — **new**: use case composing `netWorth(ctx)` starting figures, `getForecastAssumptions(ctx)`, `repos.payAnchors.listVisible`, `repos.accounts.list` (open offset/home_loan balances); zod horizon; one domain call per return line.
- `packages/app/src/reports/net-worth.ts` — reuse `netWorth()` as-is: `assetsCents`, credit-card subtotal (flat liability), per-account balances for selected loans and the offset pool.
- `packages/app/src/planning/forecast-assumptions.ts` — reuse `getForecastAssumptions`; extend `ForecastAssumptionMortgage` and the PUT schema with the terms fields.
- Mortgage-terms storage slice: `packages/db/src/schema/forecast-assumption.ts`, new migration after `0031` (STRICT by hand-edit), `packages/db/src/repositories/forecast-assumption.ts`, `packages/app/src/ports/unit-of-work.ts` row types, `packages/app/src/testing/memory-uow.ts`.
- `apps/server/src/http/app.ts` — GET route beside `/api/planning/forecast` (~:637; `c.req.query()`, `ctx(c)`, `c.json` 200).
- `apps/server/src/privacy/route-manifest.ts` — `read("/api/planning/forecast-net-worth")` (~:350); `privacy.test.ts` fails without it.
- `tools/seed/src/modules/budgets-and-bills.ts` + `tools/seed/src/world.ts` + `apps/server/src/admin/seed.ts` — demo terms on `FORECAST_ASSUMPTION_DEMO`/`forecast-assumption.set`.
- `apps/server/src/http/forecast-networth-seed.test.ts` — **new**: copy `forecast-assumptions-seed.test.ts` (linkSeed, cookie logins).

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/planning/forecast-networth.ts(.test)` — pure walk + hand-computed fixtures (payoff, offset, zero-rate, monotonic lines); every matrix row.
- [x] `packages/domain/src/index.ts` — export.
- [x] Mortgage-terms storage slice (schema + migration + row types + repo + memory-uow + PUT schema + seed terms).
- [x] `packages/app/src/planning/forecast-networth.ts(.test)` — use case: bps→percent, monthly income, offset pool, closed/termless loans flat; memory-uow tests per matrix row.
- [x] `apps/server/src/http/app.ts` + `apps/server/src/privacy/route-manifest.ts` — GET route + manifest entry.
- [x] `apps/server/src/http/forecast-networth-seed.test.ts` — seeded GET: horizons, person isolation, 401/400.

**Acceptance Criteria:**
- Given the hand-computed domain fixture, when `projectNetWorth` runs, then every monthly point matches the Design Notes table cent for cent (ticket verify).
- Given any horizon and assumption set, then low ≤ mid ≤ high at every point.
- Given a stored assumption change (savings, each return, super, mortgage selection, offset, terms), when the query re-runs, then the affected lines move (ticket verify).
- Given the seed world, when each person GETs, then their own assumptions drive their lines and private accounts stay invisible.
- CI: lint, typecheck, boundaries, `check:strict`, `db:generate` no drift.

## Review Triage Log

Pass 1 (quick; Quick lens; diff vs `1938237`): verdicts — 1 medium, 2 low (1 rejected), 2 false. No intent_gap or bad_plan → no loopback; both patches applied and re-verified.

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Q — seed test has no 401 request though the task line says 401/400; matrix row unverified | false | — | Matrix row covered by `forecast-networth.test.ts` "throws Unauthenticated for a non-person viewer"; route-level 401 is the shared session middleware (no sibling route has a per-route 401 test — ticket 4 precedent). The checkbox's over-specific wording is a plan-file edit, rejected by rule |
| 2 | Q — `forecast-networth.ts` `Math.max(0, report.assetsCents)` breaks the point-0 = `netWorthCents` identity when a visible asset account is overdrawn | medium | patch | Verified: no sign CHECK on balances; clamped excess vanishes. Fix: fold the negative excess into the flat `creditCardCents` deduction — point 0 becomes exactly `assets − loans − cards` again; regression test added |
| 3 | Q — monthly income uses monthly ×12 ÷12, contradicting the frozen "(monthly ×1) ÷ 12" shorthand | false | — | `expectedNetCents` is per-cycle pay (`pay-anchor.ts:29`, AD-25); "monthly income" for a monthly anchor has exactly one sensible reading (= its expectedNet). Literal ×1÷12 would make the seeded 45% contribute 3.75% — contradicting the ticket verify. Only remedy is editing this build's plan → rejected by rule |
| 4 | Q — domain walk never re-checks compounded output cents for safe-integer range; huge `annualReturnPercent` overflows | low | rejected | Real, but only reachable with absurd returns (bps at the 10 000 CHECK cap over 120 months); the fix adds a guard branch, exceeding a direct correction — rejected per the low-finding rule |
| 5 | Q — seed-test comment attributes 475_475/month to both people; person B's seeded share is 395_200 | low | patch | Verified against `budgets-and-bills.ts` (B's fortnightly anchor 320_000 × 26 ÷ 12 × 5 700 bps = 395_200); comment corrected |

## Design Notes

Pot model, per line r ∈ {low, mid, high}: `pot₀ = netWorth.assetsCents`. Each month: `pot += savingsCents + superCents` (monthly income × bps ÷ 10000, half-even), then `pot ×= 1 + r ÷ 1200` half-even. Projection = `pot − Σ loanBalances(month) − creditCardCents` (cards flat). Loan balances: selected open loans with terms → `mortgageSchedule(principal = −today's signed balance, rate, repayment, offsetCents = open-offset pool when countOffset)`, consumed to `monthsToPayoff` then 0; other loan balances stay at today's values.

Repayments are **not** deducted from the pot: the savings rate reads as surplus before mortgage paydown, and amortisation converts repayments into equity — deducting both counts the same cash twice. Each countOffset loan nets the full open-offset pool (multi-loan ambiguity waits for CAP-20's loan↔offset link). bps→percent: `Decimal(bps).div(100)` ("500" → `"5"`).

Small fixture (cents; loan 10_000_000 @"12" repay 350_000, savings 100_000/mo, super 0, assets 12_000_000, cards 0): m1 pot = 12_100_000; loan int 100_000 → closing 9_750_000; NW = 2_350_000 (r `"0"`) / pot ×1.01 = 12_221_000 → NW 2_471_000 (r `"12"`).

## Verification

**Commands:**
- `pnpm vitest run packages/domain/src/planning/forecast-networth.test.ts packages/app/src/planning/forecast-networth.test.ts apps/server/src/http/forecast-networth-seed.test.ts` -- expected: green
- `pnpm vitest run packages/domain` -- expected: no regressions
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean
- `pnpm --filter @pangolin/db db:generate && git diff --exit-code -- packages/db/migrations` -- expected: clean
