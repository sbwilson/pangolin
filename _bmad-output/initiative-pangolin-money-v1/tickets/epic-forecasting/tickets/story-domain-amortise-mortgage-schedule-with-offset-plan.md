---
title: 'domain/amortise: mortgage schedule with offset'
type: 'feature'
ticket: '3'
created: '2026-11-11'
status: 'built'
baseline_revision: 'e681ddcf36913c5ae76ac003dd446d6283e4464d'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The net-worth projection (this epic) and epic-loans-property's loan schedule both need a monthly mortgage amortisation that accrues interest on the balance net of an offset and applies extra repayments. No amortisation code exists anywhere in the repo.

**Approach:** A pure domain module `packages/domain/src/amortise` exposing one function, `mortgageSchedule()`: walk months, accrue interest on (balance − offset), split the constant repayment into interest and principal, and apply a monthly extra repayment as principal-only — which shortens the term, never the payment. Deterministic integer-cent arithmetic, unit-tested against hand-computed schedules.

## Boundaries & Constraints

**Always:**
- Integer safe-integer cents for every amount; annual rate as a decimal-string percent (`"6.175"` = 6.175% p.a.), never a float — matches `shared/money.ts` conventions.
- Monthly interest = Decimal(netBaseCents × ratePercent ÷ 1200) rounded to whole cents half-even (the repo's money rounding).
- The interest base is `max(0, opening − offsetCents)`: an offset never earns interest or drives the base negative.
- Extra repayments are principal-only, applied in the same month after the scheduled repayment; the nominal monthly repayment never changes.
- Pure function: no clock, no I/O. Invalid input throws `RangeError` (as `projectCashFlow` and `allocate` do).
- Import only from `@pangolin/shared` (enforced by `scripts/check-boundaries.ts`); export the public API from the barrel `packages/domain/src/index.ts`.

**Never:**
- Rate changes, capped yearly extras, correction by entered interest, interest-only loans — epic-loans-property extends this module with those later.
- Day-count-basis accrual (monthly accrual is rate ÷ 12 exactly); offset series varying over time.
- No DB, API, UI, or app-layer work — this ticket is the domain module and its unit tests only.
- Do not modify `forecast-cashflow.ts` or any existing module.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Base schedule | principal, rate, repayment; no offset, no extra | rows with opening/interest/principal/closing matching hand calc; total interest; months; payoff date | No error expected |
| Offset under balance | offset < opening | interest accrues on (opening − offset) | No error expected |
| Offset ≥ balance | offset ≥ opening that month | interest 0; full repayment goes to principal | No error expected |
| Extra repayment | extra > 0 | extra applied as principal same month; term shorter than same loan without extras; final extra clamps to remaining balance | No error expected |
| Final month | repayment exceeds interest + balance | payment = interest + remaining balance; closing exactly 0; principal never negative | No error expected |
| Non-amortising | first-month interest ≥ repayment | — | `RangeError` |
| Pathological term | would exceed 1200 months | — | `RangeError` (termination guard) |
| Bad numbers | non-positive principal/repayment, negative offset/extra, non-integer cents, malformed or negative rate string | — | `RangeError` |

</frozen-after-approval>

## Code Map

- `packages/domain/src/amortise/mortgage-schedule.ts` — **new**: the module (input/row/schedule interfaces + `mortgageSchedule()`).
- `packages/domain/src/amortise/mortgage-schedule.test.ts` — **new**: vitest unit tests, hand-computed fixtures.
- `packages/domain/src/index.ts` — barrel; add the amortise export block at the top (alphabetical, before `classify/`). Named exports with `.ts` specifiers, `type` exports interleaved.
- `packages/domain/src/planning/forecast-cashflow.ts` — style exemplar: file-top `//` comment citing ADs, readonly interfaces with per-field docs, `RangeError` guard, no clock. Mimic; do not change.
- `packages/shared/src/money.ts` — re-exports `Decimal`; `toCents` shows the decimal-string validation (`DECIMAL_STRING_RE`, regex is private — replicate locally) and half-even rounding via `Decimal.clone({ precision: 40, rounding: ROUND_HALF_EVEN })`.
- `@pangolin/shared/temporal` — `PlainDate` for `startDate` and row dates (`startDate.add({ months: m - 1 })`).
- `scripts/check-boundaries.ts` — domain may import only shared.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/domain/src/amortise/mortgage-schedule.ts` — create: interfaces + `mortgageSchedule()` walking months per the I/O matrix; guards first, then the loop with a 1200-month cap.
- [ ] `packages/domain/src/amortise/mortgage-schedule.test.ts` — create: the hand-computed fixtures below (base, offset, extra), the half-even tie pair, every matrix error row, payoff-date check.
- [ ] `packages/domain/src/index.ts` — export `mortgageSchedule` and its three interfaces from `./amortise/mortgage-schedule.ts`.

**Acceptance Criteria:**
- Given the base fixture (principal $1,000, rate "12", repayment $350), when `mortgageSchedule` runs, then rows, total interest and months match the Design Notes table exactly, cent for cent.
- Given an offset case and an extra-repayment case, when each runs, then interest accrues on the offset-net base and the extra shortens the term vs the same loan with no extra (ticket verify).
- Given non-amortising or malformed input, when `mortgageSchedule` runs, then it throws `RangeError` — no infinite loop, no partial result.
- Given the finished module, when `pnpm typecheck`, `pnpm lint` and `pnpm vitest run packages/domain` run, then all pass.

## Design Notes

Row/schedule shape (extend later for rate changes — keep it additive):

```ts
MortgageScheduleInput { principalCents; annualRatePercent: string; monthlyRepaymentCents;
  offsetCents? = 0; extraRepaymentCents? = 0; startDate: PlainDate }
MortgageScheduleRow { month /*1-based*/; date; openingCents; interestCents;
  scheduledPrincipalCents; extraPrincipalCents; closingCents }
MortgageSchedule { rows; totalInterestCents; monthsToPayoff; payoffDate }
```

Interest: `Decimal(opening − max(0,offset)) × Decimal(rate) ÷ 1200 → toDecimalPlaces(0, ROUND_HALF_EVEN)` using a private `Decimal.clone({ precision: 40, rounding: ROUND_HALF_EVEN })` (same context as `shared/money.ts`).

Monthly walk: `interest` on the net base → `scheduledPrincipal = min(repayment − interest, opening)` (throw if negative at month 1) → apply extra: `extra = min(extraRepayment, opening − scheduledPrincipal)` → closing. Loop ends when closing is 0.

Hand-computed fixtures (cents):
- **Base** (principal 100000, rate "12", repayment 35000): m1 100000/1000/34000→66000; m2 66000/660/34340→31660; m3 31660/317/31660→0 (clamped). Total interest 1977; 3 months.
- **Offset** (same + offset 40000): m1 base 60000 int 600 prin 34400→65600; m2 base 25600 int 256 prin 34744→30856; m3 base clamped 0, int 0, prin 30856→0. Total interest 856.
- **Extra** (same as base + extra 20000): m1 int 1000 prin 34000 extra 20000→46000; m2 int 460 prin 34540 extra 11460 (clamped)→0. Total interest 1460; 2 months (base: 3).
- **Tie pair** (rate "6"): opening 10100 → 50.5 → 50 cents; opening 10300 → 51.5 → 52 cents. Pins half-even.

## Review Triage Log

Pass 1 — lens `quick`, 2026-11-11. Findings: 1 false, 1 low. Patch applied; verification re-run green (domain 111 tests, typecheck clean, lint + boundaries ok; full suite 3036 passed).

- **false** (rejected — the fix edits this build's plan) `mortgage-schedule.ts` m3 / plan Design Notes — claimed the emitted `scheduledPrincipalCents: 31_660` contradicts the fixture's `31343`, so AC1 is unsatisfiable. Refuted: 31_660 is what the walk formula gives (`min(35000−317, 31660)`) and what the frozen matrix requires (closing exactly 0; 31_660−31_343=317≠0). The `31343` figure was an arithmetic typo in the plan's non-frozen Design Notes; the plan doc was corrected, code untouched.
- **low** → **patch** `packages/domain/src/amortise/mortgage-schedule.ts` `requireCents` — `Number.isSafeInteger(-0)` is true and `-0 < 0` is false, so `offsetCents: -0`/`extraRepaymentCents: -0` passed the guard and `Math.min(-0, positive)` returned `-0`, leaking `-0` into row `extraPrincipalCents` — against the convention `shared/money.ts` `cents()` sets ("never leaks into JSON or equality checks"). Action: `requireCents` now returns the value normalized (`value === 0 ? 0 : value`) and the offset/extra call sites use the return; regression test asserts no row field is `-0` via `Object.is` for `offsetCents: -0, extraRepaymentCents: -0`.

## Verification

**Commands:**
- `pnpm vitest run packages/domain` -- expected: new amortise tests pass, no existing failures.
- `pnpm --filter @pangolin/domain typecheck` -- expected: clean.
- `pnpm lint` -- expected: biome + boundary check clean.
