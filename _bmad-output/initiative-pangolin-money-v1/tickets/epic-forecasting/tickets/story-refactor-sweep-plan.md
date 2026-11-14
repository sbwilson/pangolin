---
title: 'Refactor sweep: deferred epic-forecasting hygiene'
type: 'refactor'
ticket: '10'
created: '2026-11-15'
status: 'in-progress'
baseline_revision: '338db853ddf230ad719c5381484b1db01c533ece'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nine builds of epic-forecasting left deferred hygiene: echarts (~1.1 MB) still ships eagerly on first load — only the 2 MiB chunk-split stopgap landed; review findings were deferred or rejected-as-low without follow-up (no safe-integer guard in the net-worth compounding walk, stale chart canvas when accounts go empty, seed-test expectations typed `Record<string, any>`); and the board is stale — deferred-work.md still lists items already fixed, and the merchant-domain plan carries a wrong `epic:` key.

**Approach:** Lazy-load the four echarts-backed chart components at their page mount points (the `PdfStatementCard` precedent), moving `shortDayLabel` out of the chart module so the cash-flow table and page no longer pull echarts; land the two small guards and the seed-test typing; reconcile deferred-work.md and the merchant-plan frontmatter so every deferred finding is resolved or recorded with reasons.

## Boundaries & Constraints

**Always:**
- The four chart components stay the only echarts runtime importers; pages mount them via `React.lazy` + `Suspense` using the `{ default: m.X }` adapter idiom (`components/review/PdfStatementCard.tsx:17`).
- `shortDayLabel` lives in exactly one module; every importer (chart option builder, `ForecastCashFlowTable`, `ForecastPage`) points there — no re-export shim that would keep echarts in the entry graph.
- The empty-accounts path disposes the chart instance instead of returning early with a stale canvas.
- Net-worth walk: a compounded pot exceeding `Number.MAX_SAFE_INTEGER` throws `RangeError` — same guard style as the input guards (`forecast-networth.ts:80`), never silent clamping.
- Ledger annotations keep existing entries intact and add a `resolution:` line quoting the full commit id obtained from git verbatim.
- Deferred findings not fixed here get a written disposition (this plan's Design Notes) naming why.

**Never:**
- No modular `echarts/core` migration, no router-level route lazy-loading, no CI precache-size gate.
- No forecast math changes beyond the safe-integer guard; no migration, schema, or API change.
- Do not touch goal/pay-calendar `!`-assertion lint debt, epic-llm ledger entries, or the epic's built plan files (except the merchant plan's `epic:` key).
- No new test mocks of echarts — tests keep using the real module (jsdom skips canvas init).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------| ----------------|
| First load without charts | any page except the four chart mount points | entry import graph contains no echarts; echarts fetches only when a chart mounts | — |
| Chart page first visit | `/planning/forecast` cash-flow mode, seeded report | Suspense fallback then chart renders lines/warnings as before | — |
| Accounts non-empty → empty | page open, last projected account removed | chart instance disposed; no stale canvas | — |
| Extreme compounding | return bps at CHECK cap × long horizon drives pot past MAX_SAFE_INTEGER | `RangeError` thrown before cents leave the safe range | RangeError |
| Page tests in jsdom | existing ForecastPage/CashFlowPage/NetWorthPage tests, no echarts mock | lazy resolves; all existing assertions green | — |

## Code Map

- `apps/web/src/lib/forecast-labels.ts` — **new**: `shortDayLabel` moved from `ForecastCashFlowChart.tsx:11–26`; its 3 tests move from `ForecastCashFlowChart.test.tsx:35–40` to `lib/forecast-labels.test.ts` (house `lib/*.test.ts` pattern).
- `apps/web/src/components/ForecastCashFlowChart.tsx` — drop the definition, import from `../lib/forecast-labels.ts` (used at :99 axis formatter); in the main effect (:138) dispose `chartInstanceRef` when `accounts.length === 0` before returning.
- `apps/web/src/components/ForecastCashFlowTable.tsx:3`, `apps/web/src/pages/ForecastPage.tsx:14,277` — repoint `shortDayLabel` imports.
- `apps/web/src/pages/ForecastPage.tsx:14,21` — lazy-mount `ForecastCashFlowChart` + `ForecastNetWorthChart`; keep card chrome eager, Suspense fallback a min-height placeholder inside the card to avoid layout shift.
- `apps/web/src/pages/CashFlowPage.tsx:11` — lazy-mount `SankeyCard`. `apps/web/src/pages/NetWorthPage.tsx:8` — lazy-mount `NetWorthTrendChart`.
- `packages/domain/src/planning/forecast-networth.ts` — guard in the compounding walk (~:151); guard style :80; regression test in `forecast-networth.test.ts`.
- `apps/server/src/http/forecast-seed.test.ts:34` — replace `expectations: Record<string, any>` with a typed shape matching what `tools/seed/src/modules/budgets-and-bills.ts` emits (per-viewer `day0`, `byDay`, `allocationDebits`).
- `apps/web/vite.config.ts:44-46` — keep the echarts `advancedChunks` group; it becomes the async chunk. Change only if the build demands it.
- `_bmad-output/initiative-pangolin-money-v1/deferred-work.md` — add `resolution:` lines: day-0 double-count and shared-budget asymmetry (fixed by ticket 8.2, `e63edca77d069543b4dceb300efb90e3502fa97a` + migration 0030), ledger-perf warm request (`0cfd377e1ff91d0eded7c4ccefff7f16dd70af77`), echarts and board-bookkeeping entries (this build's commit, recorded at completion).
- `_bmad-output/initiative-pangolin-money-v1/tickets/epic-llm-categorisation-pdf/tickets/story-merchant-domain-extraction-local-logo-proxy-and-privacy-guar-plan.md` — frontmatter `epic: 11` → `epic: 5` (tickets.toml lists the epic as id 5; its `signature: '5.9::…'` and `ticket: 9` already agree). No tool reads this key (tickets.py reads tickets.toml).
- Do not touch: chart canvas-guard blocks, option builders, `sankey-layout.ts`, vite PWA globPatterns, other plans' Review Triage Logs.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/lib/forecast-labels.ts` + `forecast-labels.test.ts` + repoint `ForecastCashFlowChart.tsx` / `ForecastCashFlowTable.tsx` / `ForecastPage.tsx` — move `shortDayLabel` out of the echarts module.
- [ ] `ForecastPage.tsx`, `CashFlowPage.tsx`, `NetWorthPage.tsx` — `React.lazy` + `Suspense` mounts of the four charts.
- [ ] `ForecastCashFlowChart.tsx` — dispose on `accounts → empty`; regression test.
- [ ] `packages/domain/src/planning/forecast-networth.ts` + `.test.ts` — safe-integer guard on compounded pot + regression test.
- [ ] `apps/server/src/http/forecast-seed.test.ts` — typed seed expectations replacing `Record<string, any>`.
- [ ] `deferred-work.md` + merchant plan frontmatter — ledger reconciliation with full commit ids.
- [ ] Page tests — adjust only if lazy mounting requires (async resolve handling); keep zero echarts mocks.

**Acceptance Criteria:**
- Given `pnpm --filter @pangolin/web build`, then the static import graph from the entry contains no echarts (echarts is an async chunk only), every precached file stays under 2 MiB, and the build succeeds.
- Given every existing web page test (jsdom, no echarts mock), when the suite runs, then all pass.
- Given a mounted cash-flow chart whose accounts become empty, then no stale canvas remains (unit test proves dispose ran).
- Given extreme net-worth compounding, then `RangeError` — no unsafe-integer cents in output.
- Given the ledger, then every epic-forecasting entry is annotated `resolution:` or has a recorded disposition; `pnpm lint && pnpm typecheck` and the unit suites are green (ticket verify).

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Recorded dispositions for rejected-low findings not fixed by this sweep: T6#1 raw `var(--border)` passed to canvas axes — cross-chart house pattern; a real fix needs theme-color plumbing for every canvas consumer, out of sweep scope. T9#3 non-live "· N waiting" bills-gap text — literally true of confirmed bills, matches the chips' established pattern. T4 low≤mid≤high return-rate ordering — no spec requirement; lines render correctly labeled regardless. T1#3 `missingDepositSource` unread — superseded: entry 8.9's not-enough-data card now reads it (`ForecastPage.tsx`). T1#16 private-anchor `missingDepositSource` — maybe-false, contrived configuration, documented at triage.

## Verification

**Commands:**
- `pnpm --filter @pangolin/web build` -- expected: success; workbox precache all files < 2 MiB; echarts emitted as an async chunk (verify via `npx vite-bundle-visualizer` output or the chunk graph: `grep -l echarts dist/assets/index-*.js` finds no static import).
- `pnpm vitest run apps/web packages/domain/src/planning/forecast-networth.test.ts apps/server/src/http/forecast-seed.test.ts` -- expected: green.
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean, no new warnings in touched files.
