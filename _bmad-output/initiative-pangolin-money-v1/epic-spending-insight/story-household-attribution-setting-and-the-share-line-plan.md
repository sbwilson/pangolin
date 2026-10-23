---
title: 'Household attribution setting and the share line'
type: 'feature'
ticket: '4'
created: '2026-10-24'
baseline_revision: 'd2e2f75df563069d8fa9254322d4d05f91db0829'
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

**Problem:** The apportionment from 4.3 has no route or UI: nobody can switch contribution/50-50 attribution, see their share of shared spending on Cash flow, or scope the totals to it.

**Approach:** Expose household settings over HTTP and add the attribution control to Settings › Household; add a share endpoint and, on `/cash-flow`, the always-visible share line with the `My share` / `Everything I can see` toggle (URL-held, default Everything) that switches the tiles.

## Boundaries & Constraints

**Always:**
- Reuse `getHouseholdSettings` / `updateHouseholdSettings` (audit already written; `fyStart` stays read-only) and `sharedApportionment` unchanged. New routes are in `route-manifest.ts` and replayed in `privacy.test.ts`; writes call `writable()`.
- Share line copy: `Your share: $X of $Y shared (N%)`, toggle at its right end, directly under the KPI row. Percentage is computed on the server; the web never sums or rounds money.
- Both partners see identical shared totals (public accounts only, AD-7). The toggle lives in the URL; absent means Everything, and range changes keep it.

**Never:**
- Decision (user, 2026-10-24): under `My share`, Money out = the viewer's visible money out with the shared-beneficiary part replaced by their apportioned share; Money in unchanged; Kept and Savings rate follow. Done via a `scope` parameter on cash-flow totals (SQL + memory mirror + parity).
- No change to `apportion`, `sharedFigures` or the `sharedApportionment` output shape; no Spending-page share line; no new tables.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Switch setting | PATCH `sharedAttribution: "even"` | share line becomes 50/50 for both partners | No error expected |
| Toggle My share | `?share=mine` | tiles scoped per decision below | No error expected |
| No shared spending | shared total 0 | `Your share: $0.00 of $0.00 shared`, no percentage | No error expected |
| Bad setting / extra key | `fyStart` or unknown value | 400 | Zod, strict schema |
| Demo mode write | PATCH in demo | Conflict | `writable()` |

</frozen-after-approval>

## Code Map

- `packages/app/src/system/household-settings.ts:43,56` -- existing use cases; wire only.
- `apps/server/src/http/app.ts:321-342,355-361` -- add GET/PATCH `/api/system/household` (model: preferences pair) and GET `/api/reports/shared-apportionment`.
- `apps/server/src/privacy/route-manifest.ts` (`SystemEntry` is GET-only; use `write("PATCH", …)`), `privacy.test.ts:136` -- manifest + replay.
- `packages/app/src/reports/shared-apportionment.ts`, `cash-flow-totals.ts` -- add viewer share/permille; scope for tiles per Q1.
- `apps/web/src/components/HouseholdSettings.tsx` -- replace placeholder with a radiogroup (model `ThemeSwitcher.tsx`).
- `apps/web/src/pages/CashFlowPage.tsx` (~:56 navigate drops extra params; merge search), `routes/search.ts:147` `CashFlowSearch`, `api.ts` fetchers (`sendJson`, `apiError`).
- `e2e/routing.spec.ts`, `settings.spec.ts`, `axe.spec.ts:180`; e2e DB has no transactions, so the spec must create them.

## Tasks & Acceptance

**Execution:**
- [ ] Server routes + manifest + privacy replay + tests (`app.test.ts`, copy `preferences.test.ts`)
- [ ] Report: viewer share and permille; tile scope per Q1 across SQL, memory and parity test
- [ ] Web: fetchers, `HouseholdSettings` control, share line + toggle, `share` search key, tests
- [ ] `e2e` -- change the setting, share line changes; toggle switches totals; partner sees same shared total; axe passes

**Acceptance Criteria:**
- Given a changed setting, when either partner opens Cash flow, then the share line reflects it identically.
- Given the toggle, when My share is pressed, then the URL holds it, tiles refetch, and reload keeps it.
- Given the full suite, when run, then lint, typecheck, unit, Playwright and axe pass.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment)

Counts: high 0 · medium 2 · low 9 · false 4 · maybe-false 0 (patch 4, reject 13 of ~27 findings, grouped).

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | blind + edge | `My share` replaces shared-beneficiary splits on the viewer's private accounts with a public-only share | medium | patch | `ledger-repos.ts` / `memory-uow.ts` sum every visible shared split. Restrict to public accounts; add a private shared case. |
| 2 | blind + edge | Radiogroup unselected option has `tabIndex -1` and no arrow keys | medium | patch | Keyboard users cannot reach it. Drop the roving tabindex. |
| 3 | blind + edge + intent | Toggle disappears when the share fetch fails, trapping `share=mine` | low | patch | Render the toggle regardless of `shared.data`; add a test. |
| 4 | blind | `CashFlowShare` type unused | low | patch | Delete it. |
| 5 | blind + edge | Totals and share read in two snapshots | low | reject | Single-household SQLite; fix adds a combined read path. |
| 6 | blind + edge | Share line shows the previous range under `keepPreviousData` | low | reject | Tiles behave the same; unlikely and fix adds gating. |
| 7 | edge | Viewer absent from people gets share 0 | low | reject | Left-household viewer; fix adds a branch. |
| 8 | blind + edge | Negative shared total, over-100 summed percents, negative money out | low | reject | Refund-only edge cases; no everyday path. |
| 9 | blind + edge | e2e tests share state and leave 50/50 on failure | low | reject | File is serial; a fixture is more than a direct fix. |
| 10 | blind + edge | `fetchHouseholdSettings` casts JSON | low | reject | Matches the preferences fetcher pattern. |
| 11 | blind + edge | PATCH `{}` writes an audit row | false | reject | `updateHouseholdSettings` writes nothing for a no-op patch. |
| 12 | blind | Doc comment over line width | false | reject | `pnpm lint` (biome) passes. |
| 13 | blind + edge + gap + intent | No routing or axe spec change | false | reject | `axe.spec.ts` already loads `/cash-flow` and `/settings`; not run here (no browsers). |
| 14 | blind | Plan record gaps (Q1, empty notes, unchecked boxes) | false | reject | Fix edits this build's plan. |
| 15 | edge | Parity test `at0 <= plain` fragile with shared refunds | low | reject | Fixture is fixed and passes. |

## Verification

**Commands:**
- `pnpm lint`, `pnpm typecheck`, `pnpm test` -- expected: green
- `pnpm e2e` and `pnpm test:axe` -- expected: green
