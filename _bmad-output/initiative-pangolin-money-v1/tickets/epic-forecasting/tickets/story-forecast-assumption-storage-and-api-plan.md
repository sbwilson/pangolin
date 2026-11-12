---
title: 'Forecast assumption storage and API'
type: 'feature'
ticket: '4'
created: '2026-11-13'
status: 'built'
baseline_revision: 'e0a25c9a003840aa47d4805a75ae4e4ded9adf4d'
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

**Problem:** The net-worth projection (8.5) and assumption chips (8.7) need editable per-person assumptions — savings rate, low/mid/high returns, super contribution rate, mortgage-with-offset selection — and nothing stores them yet.

**Approach:** The AD-22-named `forecast_assumption` table holds one row per person with rates as integer basis points; a child `forecast_assumption_mortgage` table holds per-loan selections keyed (person_id, account_id). `getForecastAssumptions` returns defaults when nothing is stored; `upsertForecastAssumptions` partial-merges scalars and replaces the mortgage list, audited. GET/PUT routes + privacy manifest + a seed event so demo values flow through the use case.

**Decisions (human, 2026-11-13):**
- Defaults when nothing is set: every rate 0 bps, no mortgage rows — neutral zeros; demo values (returns 3/5/7%, super 12%, savings 45%, offset counted) come from seed only. Unedited projections stay flat until the person opts in.
- Mortgage-with-offset shape: per-account selection in a child table — row present = that `home_loan` is paid down in the projection; `count_offset` = whether its offset balances are netted. Multi-loan households pick per loan.

## Boundaries & Constraints

**Always:**
- `forecast_assumption`: `person_id` TEXT PRIMARY KEY references person; `forecast_assumption_mortgage`: composite PK (person_id, account_id), both FKs; only the person sees either row (repo guard + use-case guard, AD-22).
- Rates are integer basis points with CHECK 0..10000; `count_offset` CHECK IN (0,1).
- GET returns defaults (zeros, `mortgages: []`) when no rows exist and writes nothing. PUT partial-merges scalar fields (omitted keeps existing), replaces the mortgage list wholesale when present, and writes one audit row in the same transaction via `write()`.
- zod `.strict()` schemas parsed in the use case (routes pass raw bodies); `AppError("Validation")` → 400; non-person viewer → `Unauthenticated`. PUT accepts `personId` only for the system viewer (seed), mirroring the `upsertPayAnchor` guard; a listed `accountId` that isn't a visible `home_loan` → `NotFound` → 404.
- Migration generated with `pnpm --filter @pangolin/db db:generate`, CREATE TABLEs hand-edited to add `STRICT`, generated SQL committed (ci asserts no drift).

**Never:**
- No net-worth projection math, return curves, or `mortgageSchedule` calls — entry 8.5.
- No UI: chips (8.7), threshold editor (8.8), web `api.ts` or page changes.
- No reset endpoint and no deletes — reset is a PUT sending default values.
- No JSON-blob column for mortgage selections — relational rows only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------| ----------------|
| No rows | GET, signed-in person, never PUT | Zeros + `mortgages: []`; still no rows | No error |
| Round-trip | PUT {savingsRateBps: 4500, mortgages: [{accountId: L1, countOffset: true}]} then GET | Savings 4500, others 0, mortgage list returned; audit row with before/after | No error |
| Partial merge | PUT {returnMidBps: 600} only | mid becomes 600; every other scalar and the mortgage list unchanged | No error |
| List replace | PUT mortgages [L2] when [L1] stored | List becomes exactly [L2] | No error |
| Cross-person | person viewer PUTs `personId` of partner | Nothing written | `NotFound` → 404 |
| Unvisible loan | PUT lists an accountId the viewer can't see, or a non-home_loan account | Nothing written | `NotFound` → 404 |
| Not a person | non-person viewer GET or PUT | — | `Unauthenticated` → 401 |
| Bad body | unknown key, or bps < 0 or > 10000, duplicate accountId | Nothing written | `Validation` → 400 |
| Seeded world | seed `forecast-assumption.set` events applied via the use case | GET returns the seeded demo values and loan list per person | No error |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/person-preference.ts` — shape to copy: personId text PK → person, `notNull().default(...)`, named `check(...)`, text `createdAt`/`updatedAt` written by the use case (no `$defaultFn`). Account FK precedent: `pay-anchor.ts`. Register both new tables in `schema/index.ts`.
- `packages/db/migrations/` — newest is `0030_budget_funding_account.sql`; next slot `0031_forecast_assumption` (both tables in one migration). drizzle-kit does not emit STRICT — hand-edit (see `0025_pay_anchor.sql`).
- `packages/app/src/identity/preferences.ts` — the literal pattern: `getPreferences` defaults-on-read, `updatePreferences` partial merge + `write(ctx, (tx, audit) => ...)` + `formatInstant(ctx.clock.now())`.
- `packages/app/src/planning/pay-anchor.ts:91-100` — system-viewer `personId` override, cross-person `NotFound` guard, and account-visibility validation of `accountId`; zod `.strict()` schema beside the use case. Copy the guard shape, not the file.
- `packages/app/src/ports/unit-of-work.ts` — add `ForecastAssumptionRow`, `ForecastAssumptionMortgageRow`, `ForecastAssumptionRepo` (pattern: `PayAnchorRepo` :1334); wire into `TxRepos` (:2077) and the `ReadRepos` Pick (:2125).
- `packages/db/src/repositories/pay-anchor.ts` — factory `createXRepo(orm, check)` with `isPersonVisible` guard; new repo: `get(personId)`, `listMortgages(personId)`, `upsert(row)`, `replaceMortgages(personId, rows)` (delete+insert in the tx). Wire in `packages/db/src/unit-of-work.ts` `txRepos` (~:287) and the ReadRepos pick (~:442).
- `packages/app/src/testing/memory-uow.ts` — in-memory twin (see `payAnchorRepo` ~:3345): two state arrays + repo factory.
- `apps/server/src/http/app.ts` — GET pattern :624; PUT pattern :458 (`writable()`, `objectBody(c)`, returns 200).
- `apps/server/src/privacy/route-manifest.ts:201-211` — copy the pay-anchors read+write pair; the write entry needs `bodyEntities: ["account"]` and a body example with the mortgage list; `privacy.test.ts` fails both directions without entries.
- `apps/server/src/admin/seed.ts` — zod event schema (~:205) + `applyEvents` case calling the use case as system viewer (see `pay-anchor.created` :721, including its world-id → account-id resolution).
- `tools/seed/src/world.ts` + `tools/seed/src/modules/budgets-and-bills.ts` — assumption fields on `WorldPerson`; emit `forecast-assumption.set` (that module owns forecast expectations).
- `apps/server/src/http/forecast-seed.test.ts` — real SQLite + `linkSeed` + `fixedClockAt` + cookie `user-a`/`user-b` pattern for the HTTP test.
- `packages/domain/src/amortise/mortgage-schedule.ts` — do NOT call here (8.5 does); rates must stay convertible to its `annualRatePercent` decimal-string input.
- Do not change: `forecast-cashflow` walk, `account` schema, `reports/net-worth.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/forecast-assumption.ts` (+ `index.ts`) — both tables per Always
- [x] `packages/db/migrations/0031_forecast_assumption.sql` — via `db:generate`; add STRICT by hand
- [x] `packages/app/src/ports/unit-of-work.ts` — row types + repo interface + TxRepos/ReadRepos wiring
- [x] `packages/db/src/repositories/forecast-assumption.ts` + wiring in `packages/db/src/unit-of-work.ts` — guarded `get`/`listMortgages`/`upsert`/`replaceMortgages`
- [x] `packages/app/src/testing/memory-uow.ts` — in-memory twin
- [x] `packages/app/src/planning/forecast-assumptions.ts(.test)` — get-with-defaults, merge-upsert + list replace with audit and guards; vitest every matrix row on memory-uow
- [x] `apps/server/src/http/app.ts` — GET/PUT `/api/planning/forecast-assumptions`
- [x] `apps/server/src/privacy/route-manifest.ts` — read + write entries (pay-anchors pair style, `bodyEntities: ["account"]`)
- [x] `tools/seed` (world.ts, budgets-and-bills module) + `apps/server/src/admin/seed.ts` — `forecast-assumption.set` applied through the use case for both seeded people, demo values, each person's household home_loan with offset counted
- [x] `apps/server/src/http/forecast-assumptions-seed.test.ts` — real-DB HTTP test: defaults, PUT→GET round-trip, person isolation, 400s

**Acceptance Criteria:**
- Given a signed-in person with no rows, when GET, then zeros and `mortgages: []` return and no rows are created.
- Given a PUT of one scalar, when GET again, then the changed value returns, omitted fields keep prior values, and one audit row exists.
- Given person B, when GET or PUT, then B reads only own values; a PUT targeting A's `personId` or A's private loan returns 404.
- Given the seed world linked, when each person GETs, then seeded demo assumptions and loan list return for that person.
- Given CI, `db:generate` shows no drift and lint/typecheck/check:strict pass.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (quick; Quick lens; diff vs `e0a25c9`): verdicts — 1 medium, 3 low, 1 false. No intent_gap or bad_plan → no loopback; all patches applied and re-verified.

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Q — staged diff omits `tx-repos-viewer.test.ts` and `migrate.test.ts` updates; full suite fails on the delivered tree | medium | patch | Verified: full `pnpm test` failed "TxRepos.forecastAssumptions is neither a scoped repository…"; both fixes existed in the working tree unstaged; staged them and re-ran the suite |
| 2 | Q — `world.ts` `applyEvents` spreads the stamped event, leaking `module` into `WorldPerson.forecastAssumptions` | low | patch | Verified `run.ts:117` stamps `module`; sibling branches map declared fields; field-by-one mapping applied |
| 3 | Q — inverted "A cannot write B's" comment above the B-writes-A 404 test | low | patch | Verified the following request is user-b PUTing user-a's `personId`; comment corrected to the true direction |
| 4 | Q — 27-char synthetic person id built by `personId("Astrid", "Nyström")` | false | — | Refuted: no such helper exists in any changed file; `addLogins` reuses the tracer's 26-char `01J…00A` template verbatim (`forecast-seed.test.ts:86`) |
| 5 | Q — no-row GET returns `{ ...FORECAST_ASSUMPTION_DEFAULTS }`, sharing the module-level `mortgages: []` array with every caller | low | patch | Verified the spread shares the array reference; now returns a fresh `mortgages: []` |

## Design Notes

Basis points for rates: integer, CHECK-able in SQLite, two-decimal precision, converted at 8.5's boundary to `annualRatePercent` (bps ÷ 100 as decimal string). Mortgage selection is relational (child rows) per the human decision: `row present = pay down; count_offset = net its offset balances`; closed loans survive via `closedOn` (no row deletion), so the FK never dangles — 8.5 filters closed accounts. PUT partial-merge mirrors `updatePreferences` for scalars; the mortgage list is replace-on-present because chips edit the loan set as a unit. No low≤mid≤high cross-field validation — spec is silent, 8.7's editor owns input UX. API/response field names: `savingsRateBps`, `returnLowBps`, `returnMidBps`, `returnHighBps`, `superRateBps`, `mortgages: [{ accountId, countOffset }]`. "Changed" state (8.7) is computed stored-vs-default.

## Verification

**Commands:**
- `pnpm --filter @pangolin/db db:generate && git diff --exit-code -- packages/db/migrations` -- expected: clean after committing 0031
- `pnpm vitest run packages/app/src/planning/forecast-assumptions.test.ts apps/server/src/http/forecast-assumptions-seed.test.ts apps/server/src/privacy/privacy.test.ts` -- expected: green
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean
