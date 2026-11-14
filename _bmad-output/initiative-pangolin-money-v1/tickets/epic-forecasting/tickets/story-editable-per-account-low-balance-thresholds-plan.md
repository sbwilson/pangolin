---
title: 'Editable per-account low-balance thresholds'
type: 'feature'
ticket: '8'
created: '2026-11-14'
status: 'built'
baseline_revision: '60236f9fbe46a92c22df32fbe4db0e3b77b72a04'
route: 'full'
route_source: 'auto'
risk: 'low'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every account row already stores a low-balance threshold (migration 0029, default 0) and the forecast chart's threshold line, dip dot, warning text and context chips all follow it — but nothing can set it: `PATCH /api/accounts/:id` rejects the field (strict schema) and the account edit sheet has no editor for it.

**Approach:** Open the field end-to-end. `updateAccountInput` accepts `lowBalanceThresholdCents` and writes it to the after row (create already accepts it); `AccountSheet` grows a "Low-balance line" dollar field for transaction accounts — seeded from the stored value, diffed into the PATCH on save. No chart, service, or DB change: the forecast report reads the stored value per request, so the lines and warnings follow automatically and persist across reload.

## Boundaries & Constraints

**Always:**
- Accept `lowBalanceThresholdCents: z.int().nonnegative().optional()` in `updateAccountInput`, mirroring `create-account.ts:32`; omitted keeps the stored value, applied via `?? before` in the `after` row. DB CHECK already bounds ≥ 0.
- The sheet field renders only for `type === "transaction"` (the chart's only plotted type), labelled "Low-balance line" (mockup legend wording), seeded `centsToText(account?.lowBalanceThresholdCents ?? 0)`, parsed with `parseCents`; empty text means 0.
- On edit, the diff sends `lowBalanceThresholdCents` only when parsed value ≠ stored; on create, only when > 0. A save that changes nothing still sends nothing (existing rule).
- Invalid text (not an amount to the cent, or negative) blocks save with the sheet's inline error pattern and sends no request.
- Every threshold rule the chart/chips use today is unchanged: threshold line + dip drawn only for warned accounts; all >0 thresholds listed in the 8.7 context chip; warning = first projected day below threshold.

**Never:**
- No migration, schema, domain, forecast-service, chart, or context-chip change — the read path exists; this ticket is the write path only.
- No threshold editor on `/planning/forecast` — its context chips stay read-only (ticket 7's decision).
- No edit affordance for non-transaction types; no batch editing.
- No not-enough-data/all-clear states (entry 9), no e2e/axe (entry 11), no Monte Carlo.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------| ----------------|
| Set threshold | Edit transaction account, field "200", Save | PATCH body carries `lowBalanceThresholdCents: 20000`; response GET shows 20000; persists across reload (ticket verify) | — |
| Unchanged | Open edit, change nothing, Save | PATCH omits the field; nothing changed → no request at all | — |
| Clear to zero | Stored 20000, clear field, Save | PATCH sends `0`; forecast chip drops to "none set"; no warning for that account | — |
| Invalid text | `abc`, `-5`, `1.234` | Inline error, no PATCH | Sheet `Refusal`-style error, save blocked |
| Raise → warning appears | PATCH threshold above the account's highest projected point | Report `accounts[].lowBalanceThresholdCents` follows; `warnings` gains the account, first below point = first projected date | — |
| Lower → warning gone | PATCH stored warning's threshold to 0 | That account's warning disappears | — |
| Negative via API | PATCH `{lowBalanceThresholdCents: -1}` | — | 400 Validation (nonnegative schema) |
| Non-transaction account | Open any savings/loan account sheet | No threshold field rendered | — |

</frozen-after-approval>

## Code Map

- `packages/app/src/accounts/update-account.ts` — add the field to `updateAccountInput` (:24–41, next to `isSavings`) and apply in the `after` row (:84–92). Audit `before`/`after` pick it up for free.
- `packages/app/src/accounts/create-account.ts` — read-only reference: schema line :32 to mirror verbatim. Do not modify.
- `apps/web/src/api.ts` — add `readonly lowBalanceThresholdCents: number` to `AccountView` (:785–806, server already returns it via `accountView` spread); add optional field to `NewAccount` (:865–873) and to `updateAccount`'s changes (:883–888).
- `apps/web/src/pages/AccountSheet.tsx` — state near :131 (`useState(() => centsToText(...))`), field markup after the Institution select (follow the share-input classes :339–346: `inputMode="decimal"`, right-aligned, tabular-nums), save wiring in the create object (:204–212) and edit diff (:220–227); invalid-parse error via `setError`. `parseCents` already imported; import `centsToText`.
- Tests: `packages/app/src/testing/accounts-parity.test.ts` (update changes threshold / omitted keeps / negative → Validation), `apps/server/src/http/app.test.ts` (accounts PATCH :1072 area: threshold 200 + GET echoes; −1 → 400), `apps/server/src/http/forecast-seed.test.ts` (PATCH the seeded joint everyday threshold → next GET: warning follows, re-prove the first-below invariant at :219–224), `apps/web/src/pages/AccountsPage.test.tsx` (sheet rows: sends changed / omits unchanged / no field for savings / invalid blocks).
- Do not touch: `ForecastCashFlowChart.tsx` (threshold series :66–73 already follows the report), `packages/app/src/planning/forecast.ts`, `packages/domain/src/planning/forecast-cashflow.ts`, `ForecastContextChips.tsx`, db schema/migrations, `apps/server/src/http/app.ts` (PATCH is a passthrough).

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/accounts/update-account.ts` + `packages/app/src/testing/accounts-parity.test.ts` — schema + apply + parity tests (create round-trips it; update changes, omits keeps, negative refuses).
- [x] `apps/server/src/http/app.test.ts` + `apps/server/src/http/forecast-seed.test.ts` — PATCH echo + 400; seeded threshold edit moves/removes the warning.
- [x] `apps/web/src/api.ts` — the three type additions (no runtime mapping exists to test beyond the diff tests).
- [x] `apps/web/src/pages/AccountSheet.tsx` + `apps/web/src/pages/AccountsPage.test.tsx` — field, seed, parse/diff, create-if->0, invalid block; every matrix row the sheet can prove (jsdom, mocked api).

**Acceptance Criteria:**
- Given a transaction account at 0, when the sheet saves "200", then the PATCH carries `lowBalanceThresholdCents: 20000` and a later GET returns it (persist across reload).
- Given the seeded forecast, when the everyday account's threshold is PATCHed above all projected points then to 0, then the report's `warnings` gain then lose that account, and each warning is the first point below the new threshold.
- Given a savings account, then its sheet renders no threshold field.
- Given invalid amount text, then no request fires and the inline error shows.
- CI: `pnpm lint`, `pnpm typecheck`, `pnpm check:strict`, unit tests green.

## Implementation Notes

The plan assumed the row write picks the field up for free; it does not: `AccountRepo.update`
enumerates its columns in both adapters — SQLite (`packages/db/src/ledger-repos.ts`) and the
memory mirror (`packages/app/src/testing/memory-uow.ts`) — and both silently dropped
`lowBalanceThresholdCents`. One added line to each is the only way the PATCH persists; neither
file is on the Do-not-touch list, and the parity test's `*Stored` reads prove the write lands.
The edit diff also gates on `type === "transaction"` so saving an unrelated change on a
savings account can never zero a threshold set through the API.

## Plan Change Log

## Review Triage Log

Pass 1 (quick; Quick lens; diff vs `60236f9`): verdicts — 0 high, 0 medium, 1 low, 1 false. No intent_gap or bad_plan → no loopback; one patch.

| # | Lens — finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Q — the seeded-world threshold test restores `seedThreshold` with a plain trailing statement, not `try…finally` | low | patch | Verified at `forecast-seed.test.ts:292-343`: the file's `app`/`db` come from one `beforeAll`, so a mid-test assertion failure aborts before the restore and any test appended after this one reads a mutated seed; today the test is last in the file, hence latent — the fix is a direct `try…finally` wrap |
| 2 | Q — the restore step never re-reads the forecast, so a "write accepted, forecast stale" world would pass | false | — | Refuted: the `patch()` helper already asserts the stored value through the account GET (the repo read of the row), and the report recomputes from the repositories per request (`forecast.ts` reads `listVisible` fresh, no cache) — the claimed stale-forecast state cannot exist at the cited lines |

## Design Notes

Field copy: label "Low-balance line", muted helper "Warn when the projection dips below this · $0 = none" — the chip legend already calls it the low-balance line. The field sits inside the same `<form>` flow as Name/Type/Institution so Save covers it in both modes.

Integration assertion without re-deriving the seed: from the first GET, take the dipping account's points; `PATCH {lowBalanceThresholdCents: maxPoint + 1}` → next GET warns on that account with date = first projected date; `PATCH 0` → no warning for it. Both GETs re-check the existing first-below invariant loop.

## Verification

**Commands:**
- `pnpm vitest run packages/app/src/testing/accounts-parity.test.ts apps/server/src/http/app.test.ts apps/server/src/http/forecast-seed.test.ts` -- expected: green
- `pnpm vitest run apps/web/src/pages/AccountsPage.test.tsx` -- expected: green
- `pnpm vitest run packages/app apps/server apps/web` -- expected: no regressions
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean
