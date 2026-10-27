---
title: 'Shared core: money, IDs, time and periods'
type: 'feature'
ticket: '2'
created: '2026-09-27'
status: done
baseline_revision: 'e9ac56b95053679cff49f5fc2190d06bf6d31339'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
warnings: [oversized]
deferred:
  - summary: >-
      Nothing lint-enforces that domain and shared never read the system clock (AD-14).
    evidence: |-
      Biome restricts only temporal-polyfill and ulid imports. Date.now, new Date() and
      Temporal.Now (re-exported by shared/temporal) are all reachable from packages/domain
      and packages/shared. No code breaks the rule today.
    location: >-
      biome.json
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Every finance epic needs money, IDs, dates and periods, and the spine (AD-5, AD-13, AD-14) says each exists exactly once. Without them, epics would each round money, mint IDs and compute fortnights and FYs their own way.

**Approach:** Add `Cents` with `allocate` (largest remainder) and `toCents` (half-even), branded ULID IDs generated only on the server, `shared/temporal`, `shared/period` (fortnightly and clamped-monthly cadences, FY labels) and the `Clock` port. All are pure and unit-tested.

## Boundaries & Constraints

**Always:**
- `Cents` is a branded safe integer. `allocate(total, weights)` uses the largest-remainder method, and its parts always sum exactly to `total`, negatives included. `toCents(amount)` takes a decimal amount in currency units (dollars), as a `decimal.js` value or a decimal string, and returns cents rounded half-even. These are the only two functions that round money (AD-13).
- IDs are ULID strings branded per entity (`Id<"Account">`). The brand types and Zod parsers live in `shared`. The generator lives in `app`, which `apps/web` may not import, so IDs can only be minted on the server (AD-5).
- `PlainDate` comes only from `@pangolin/shared/temporal`: the native global `Temporal` when present, otherwise `temporal-polyfill`. Dates cross the wire as `YYYY-MM-DD` only.
- Periods are half-open `[start, end)` in code. A fortnightly cadence has an anchor date. A monthly cadence has a day of month from 1 to 31, clamped to the month's last day. FYs are labelled by the year they end (FY2025 = 2024-07-01 to 2025-06-30 inclusive).
- `Clock` (`today(): PlainDate`, `now(): Temporal.Instant`) is a port in `app`. The `domain` and `shared` packages never read the system clock.
- Tests take plain values and use no real clock.

**Never:** No payday business-day roll-back, pay-deposit detection or `PayCalendar` (epic 6). No `UnitsMicro`, no entity-specific ID aliases beyond examples in tests, no public holidays, no tables or migrations, and no wiring into HTTP routes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Even split | `allocate(100, [1,1,1])` | `[34,33,33]`; the earlier index wins remainder ties | — |
| Basis points | `allocate(1001, [5000,5000])` | `[501,500]`, sums to 1001 | — |
| Negative total | `allocate(-100, [1,1,1])` | `[-34,-33,-33]` | — |
| Huge values | total 9e14 cents, weights 10000 bp | exact parts, no float overflow | — |
| Bad weights | empty, all zero, negative or non-integer weights | — | throws `RangeError` |
| Half-even | `toCents("0.125")`, `toCents("0.135")`, `toCents("-0.125")` | `12`, `14`, `-12` | — |
| Unsafe amount | `toCents` result beyond `Number.MAX_SAFE_INTEGER` | — | throws `RangeError` |
| FY | any date in 2024-07-01..2025-06-30 | label `FY2025`, range `[2024-07-01, 2025-07-01)` | — |
| Clamped month | monthly day 31, date 2026-02-15 | period `[2026-01-31, 2026-02-28)`; next is `[2026-02-28, 2026-03-31)` | day outside 1..31 throws `RangeError` |
| Leap year | monthly day 31, date 2024-02-29 | period starts `2024-02-29` | — |
| Fortnight | anchor 2026-07-02, date before or after the anchor | the 14-day window containing the date | — |
| Date strings | `parseDate("2026-02-30")`, `parseDate("2026-2-3")` | — | throws |
| ID | a freshly generated ID, and garbage | the generated ID parses under its brand's schema; garbage is rejected | Zod error |

</intent-contract>

## Code Map

- `packages/shared/src/index.ts` -- exports `Cents`, `allocate`, `toCents`, the ID brands and schemas. Placeholder today (story 1.1).
- `packages/shared/src/temporal/index.ts` and `packages/shared/src/period/index.ts` -- placeholder subpath entries, already exported as `@pangolin/shared/temporal` and `@pangolin/shared/period` in `packages/shared/package.json`.
- `packages/app/src/ports/` -- where `system-health.ts` lives; add `clock.ts`. `packages/app/src/index.ts` re-exports.
- `scripts/check-boundaries.ts` -- `apps/web` may import only `shared`. That keeps an ID generator in `app` out of the browser; do not change the map.
- `biome.json` -- linter config; add restricted imports here.
- Conventions from story 1.1:
  - Relative imports carry `.ts`, and `erasableSyntaxOnly` applies (no enums).
  - Versions are pinned exactly.
  - `@types/node` stays 22.x.
  - Tests are colocated `*.test.ts` files that the root `vitest.config.ts` picks up.
  - Node 22 in this sandbox has no global `Temporal`, so the polyfill path is what runs here.
- Pinned versions (npm, 2026-09-27): decimal.js 10.6.0, temporal-polyfill 1.0.5 (import `{ Temporal }` from the package root, not `/global`), ulid 3.0.2.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/temporal/index.ts` + test -- export `Temporal` (native global, or the polyfill), `type PlainDate`, strict `parseDate("YYYY-MM-DD")`, `formatDate` and a `plainDateSchema` (Zod, string in, `PlainDate` out) -- the single entry point for dates
- [x] `packages/shared/src/money.ts` + test -- `Cents` brand, `cents(n)` guard, `centsSchema`, `allocate` (BigInt arithmetic), `toCents` using a private `Decimal.clone({ precision: 40, rounding: ROUND_HALF_EVEN })` -- AD-13
- [x] `packages/shared/src/ids.ts` + test -- `Id<B>` brand, `idSchema(brand)` (26-char Crockford ULID, uppercase) -- AD-5 types
- [x] `packages/shared/src/period/index.ts` + test -- `Cadence` (`{ kind: "fortnightly", anchor }` or `{ kind: "monthly", day }`), `periodContaining(cadence, date)`, `nextPeriod` and `previousPeriod`, `fyOf(date)` → `{ label, start, end }` and `fyRange(year)` -- AD-14
- [x] `packages/app/src/ports/clock.ts`, `packages/app/src/clock.ts` + test -- `Clock` port; `systemClock(timeZone)` and `fixedClock(date, instant?)` -- the Clock port
- [x] `packages/app/src/ids.ts` + test -- `newId<B>()` built on `ulid`'s `monotonicFactory`, plus a factory that takes an injected time and random source for tests -- server-only minting
- [x] `packages/shared/package.json`, `packages/app/package.json`, `pnpm-lock.yaml` -- add decimal.js, temporal-polyfill and zod to shared, and ulid to app -- dependencies
- [x] `biome.json` -- restrict `temporal-polyfill` imports to `packages/shared/src/temporal/**` and `ulid` imports to `packages/app/src/ids.ts` (`noRestrictedImports` with an override) -- keeps the single entry points single
- [x] `packages/shared/src/index.ts`, `packages/app/src/index.ts` -- export the new API

**Acceptance Criteria:**
- Given random totals (including negatives) and random non-negative integer weights, when `allocate` runs, then the parts always sum to the total and each part is within 1 cent of its exact share. This is a property test with a fixed seed over at least 1,000 cases.
- Given `toCents` on `.5`-cent ties, when it rounds, then it rounds to the even cent.
- Given `fyOf(2024-07-01)` and `fyOf(2025-06-30)`, when evaluated, then both are FY2025, spanning 2024-07-01 to 2025-06-30 inclusive.
- Given a monthly cadence on day 31, when asked for the period containing a February date, then the boundary clamps to the last day of February.
- Given a source file outside `shared/temporal` importing `temporal-polyfill`, when `pnpm lint` runs, then it fails.

## Implementation Notes

- `decimal.js` is imported as `{ Decimal }`: under `nodenext` its CJS typings make the default import the module namespace.
- `toCents` rounds with `toDecimalPlaces(2)` before scaling by 100, so a long input is never rounded twice (a multiply would round to 40 significant digits first). String input must be a plain decimal (`[+-]digits[.digits]`); exponent, hex, `NaN` and `Infinity` throw `RangeError`.
- `Temporal` is exported as a value plus a type-only namespace, so `Temporal.Instant` works as a type (allowed under `erasableSyntaxOnly`).
- `systemClock(timeZone, source?)` takes an optional instant source so the time-zone conversion is tested without the real clock. It validates the zone up front.
- `createIdGenerator` throws when the injected time is not a positive integer, because `ulid` treats a seed time of 0 as "use `Date.now()`".
- Biome overrides replace the rule options per path: the temporal folder still bans `ulid`, and `app/src/ids.ts` still bans `temporal-polyfill`. Checked with throwaway probe files.

## Plan Change Log

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 29 findings — high 0, medium 3, low 17, false 9, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: the lint acceptance criterion (Biome import bans) has no repeatable test — added scripts/biome-restrictions.test.ts, which runs Biome on probe files at the restricted paths with the real biome.json; a temporarily removed ban made it fail.
  - `[false]` `[reject]` Blind: lockfile missing from the diff — the review diff excluded pnpm-lock.yaml on purpose; the lockfile is updated and `pnpm install --frozen-lockfile` passes.
  - `[false]` `[reject]` Blind: nothing stops other code importing decimal.js — the spine has prices and FX handled with decimal.js outside money.ts (epic 9), so an import ban would contradict it; AD-13 limits rounding, not the library.
  - `[medium]` `[defer]` Blind: `domain` and `shared` reading the system clock is not lint-enforced — not caused by this change: the rule predates it and no code breaks it; recorded in `deferred`.
  - `[low]` `[patch]` Blind: the native-vs-polyfill `Temporal` selection is never tested — added stub tests: the export is the global when one exists, and the polyfill when it doesn't.
  - `[low]` `[patch]` Blind: the type-only `Temporal` namespace omits types callers will need — added `PlainTime`, `PlainMonthDay`, every `*Like` type and the `*LikeObject` interfaces.
  - `[low]` `[reject]` Blind: `fixedClock` accepts a date and instant from different days, and `Clock` carries no time zone — `fixedClock` is a test and seed helper whose caller picks both values; zone-aware wall time has no consumer yet.
  - `[low]` `[reject]` Blind: `systemClock` reads the source twice, so `today()` and `now()` can straddle midnight — needs two calls either side of midnight within one use case; a snapshot API adds surface with no consumer.
  - `[low]` `[reject]` Blind: no Zod `cadenceSchema` — cadences are stored and sent with pay anchors in epic 6, which owns their wire form.
  - `[low]` `[reject]` Blind: `fyRange` accepts year 0 and negatives — no caller passes such years; bounding adds a guard for an unreachable input.
  - `[low]` `[reject]` Blind: `createIdGenerator` throws ulid's error, not RangeError, for time above 2^48 — needs an injected clock beyond the year 10889.
  - `[low]` `[reject]` Blind: test gaps (L and O, long fortnight walks, unaligned periods passed to next/previous) — `ULID_RE` excludes every non-Crockford letter by construction; next and previous snap to aligned periods by design.
  - `[false]` `[reject]` Blind: plan bookkeeping (empty triage log, empty change log) — the review was in progress; this entry fills it, and the departures are recorded in Implementation Notes.
  - `[low]` `[reject]` Edge: `now()` above 2^48-1 throws ulid's error — same as the Blind 2^48 row.
  - `[low]` `[reject]` Edge: injected `random()` outside [0,1) yields a short ID — the injected source is a test helper; a broken RNG is the caller's bug, and the ID then fails its schema loudly.
  - `[low]` `[reject]` Edge: `today()` and `now()` read twice across midnight — same as the Blind double-read row.
  - `[low]` `[reject]` Edge: an unknown cadence kind falls into the monthly branch — `Cadence` is a closed union; runtime data will go through epic 6's schema.
  - `[low]` `[reject]` Edge: a JS or any-typed caller can pass a float to `toCents` — the signature forbids numbers under strict TS with no `any`; a runtime float guard would guard an unshown state.
  - `[false]` `[reject]` Edge: the 'all are pure' claim — claim wording in the plan's intent; `newId` and `systemClock` are the documented impure adapters, and the fix would edit the plan.
  - `[medium]` `[patch]` VG: the Biome bans have no automated check — same patch as the Blind lint row (pre-verified gap).
  - `[low]` `[patch]` VG: only one branch of the native-vs-polyfill choice is tested — same patch as the Blind selection row; the lens filed it as defer, but the fix is a small test.
  - `[low]` `[reject]` VG other: the `newId` test reads the real clock — the matrix row asks for a freshly generated ID; the test checks only the format, so it is deterministic in practice.
  - `[low]` `[reject]` Intent: 'server-generated' holds at package level, not runtime — no route creates entities yet (routes are out of scope); the boundary map keeps `newId` out of `apps/web`.
  - `[false]` `[reject]` Intent: FY `end` is exclusive (2025-07-01), not 2025-06-30 — spine AD-14: periods are half-open in code and inclusive on screen; the test asserts the inclusive last day is 2025-06-30.
  - `[false]` `[reject]` Intent: the choice to clamp each month and recover in March — the Verify line holds either way, and the spine's clamp rule is per month.
  - `[false]` `[reject]` Intent: `toCents` takes dollars — decided in Design Notes: the spine's conversions (units × price with prices in dollars) yield currency units.
  - `[false]` `[reject]` Intent: `systemClock` and `fixedClock` beyond the Clock port — additions consistent with AD-14 (app injects a Clock); not a defect.
  - `[low]` `[patch]` Intent: types from the polyfill, and only the polyfill path runs — covered by the selection-test and type-alias patches.
  - `[false]` `[reject]` Intent: extras (`cents()`, `centsSchema`, date helpers, `nextPeriod`/`previousPeriod`) — consistent additions, not defects.

## Design Notes

**`toCents` takes dollars.** The spine's conversions (units × price, where prices are decimal strings in dollars) produce currency-unit decimals. A caller holding a fractional-cents decimal divides it by 100 first; that is exact in decimal.js.

**The ID generator lives in `app`, not `shared`.** `shared` is importable by `apps/web`, so a generator there would let the browser mint IDs. `app` is unreachable from web under the existing boundary map.

**Negative allocation:** allocate `|total|`, then negate each part.

**Monthly periods:**
```text
boundary(y, m) = PlainDate(y, m, min(day, daysInMonth(y, m)))
periodContaining(d): start = boundary(d.year, d.month) if d >= it, else boundary of the previous month
end = boundary of the month after start's month
```

## Verification

**Commands:**
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test` -- expected: all green, including the new shared and app tests
- `pnpm build` -- expected: the web and server bundles still build (the polyfill resolves in both)

## Auto Run Result

Status: built

**Summary:** Ticket 1.2 shared core:
- `Cents`, with `allocate` (largest remainder, BigInt arithmetic) and `toCents` (dollars to cents, half-even, decimal.js).
- Branded ULID IDs: types and Zod parsers in `shared`, the generator in `app` so it stays out of the browser.
- `shared/temporal`: native `Temporal` or the polyfill, a strict `YYYY-MM-DD` parse and format, and a Zod schema.
- `shared/period`: fortnightly and clamped-monthly cadences, next and previous periods, and FY labels and ranges.
- The `Clock` port, with `systemClock` and `fixedClock`.
- Biome bans on importing `temporal-polyfill` and `ulid` outside their single entry points.

**Files changed:**
- `packages/shared`:
  - `money.ts` with `Cents`, `allocate` and `toCents`.
  - `ids.ts` with the `Id<B>` brand and `idSchema`.
  - `temporal/index.ts` as the single entry point for dates.
  - `period/index.ts` for cadences and FYs.
  - Tests for each, the new exports, and the dependencies decimal.js, temporal-polyfill and zod.
- `packages/app`:
  - `ports/clock.ts` with the `Clock` port.
  - `clock.ts` with the system and fixed clocks.
  - `ids.ts` with `newId` and `createIdGenerator`.
  - Tests for each, the new exports, and the ulid dependency.
- `biome.json`: the `noRestrictedImports` bans and their overrides.
- `scripts/biome-restrictions.test.ts`: tests that the bans hold at each path.
- `pnpm-lock.yaml`: the updated lockfile.

**Review:** 29 findings.
- 6 rows patched, covering 3 root causes.
- 1 deferred: lint enforcement of "no clock reads in `domain` and `shared`" (medium).
- 22 rejected, each with its reason in the Review Triage Log above.
- Patched entries by verdict: 1 medium (tests for the Biome bans), 2 low (`Temporal` selection test and type aliases).

**Follow-up review:** not recommended (`false`). No high entry and only one medium entry was patched.

**Verification:**
- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` and `pnpm test` all pass: 15 files, 156 passed, 1 skipped as root.
- `pnpm build` builds both the web and server bundles.

**Residual risks:**
- The native-`Temporal` path runs only under a stubbed global here; real native `Temporal` on Node 26 is untested.
- Biome's `--stdin-file-path` mode reports no lint errors in 2.5.14, so the ban test writes probe files to a temp directory.
