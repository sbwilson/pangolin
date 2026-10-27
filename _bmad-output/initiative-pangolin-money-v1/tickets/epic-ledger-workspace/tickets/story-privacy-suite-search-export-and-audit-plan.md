---
title: 'Privacy suite: search, export and audit'
type: 'feature'
ticket: '7'
created: '2026-10-09'
status: done
baseline_revision: '7ba615342332545b7c84841b8c88343315fe07ad'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The server-side privacy suite verifies base ledger routes, but has not been extended to the ledger workspace surfaces (search, CSV export, audit-log read API, summary line, total count, day nets, and nav badge count) to prove cross-partner isolation and detect deliberate leaks across all surfaces.

**Approach:** Extend `readTranscript` to cover search and CSV export queries, assert per viewer that summary line, total count, day nets, nav badge count, and amount-search results equal figures computed strictly from the viewer's visible rows, verify partner search never returns hidden-name rows by name, amount, or notes while the owner finds them, test person-scoping on `GET /api/system/audit`, and expand the deliberate-leak test group to catch leaks through search, export, audit, summary line, day nets, and badge count.

## Boundaries & Constraints

**Always:** Partner B's reads across paired worlds (W1 base and W2 delta) must be byte-identical for search (`GET /api/ledger/search?q=...`) and CSV export (`GET /api/ledger/export?${query}`); summary line, total count, day nets, and nav badge count (uncategorised rows) must equal the exact figures derived from only the rows visible to the requesting viewer; partner B searching by name, amount magnitude, or notes must never return a transaction whose name is hidden by partner A, while partner A finds it by each; `GET /api/system/audit` returns person-scoped audit rows only to their respective person, private-account rows only to owners, and shared rows to both; deliberate leaks injected across search, export, audit, summary, day nets, badge, and hidden names must cause the corresponding test assertions to fail.

**Never:** Store visibility in the search index; leak private accounts, scoped entities, or unredacted hidden names across partners; allow search or export to bypass privacy projections.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Search queries byte-identical | Partner B searches by text or amount (`q=coffee`, `q=142`) across W1 and W2 | Byte-identical HTTP responses | No error expected |
| Export queries byte-identical | Partner B exports with filters (`from`, `to`, `account`, `q`) across W1 and W2 | Byte-identical CSV responses | No error expected |
| Per-viewer summary & count | Viewer A and Viewer B request ledger summary, page total, day nets, badge count | Equals exact figures computed from `listVisible(viewer, today)` | No error expected |
| Amount search per viewer | Viewer searches by amount magnitude | Matches visible non-hidden rows only; private amounts isolated to owner | No error expected |
| Hidden-name search, partner | A hides transaction name; B searches by name, amount, or notes | Never returned in results, total, or summary | No error expected |
| Hidden-name search, owner | A hides transaction name; A searches by name, amount, or notes | Returned in results for all three searches | No error expected |
| Audit person-scoping | `GET /api/system/audit` for A vs B | A's person rows return to A, not B; B's person rows return to B, not A; shared to both | No error expected |
| Deliberate leak: search | `tamperRepos` leaks private/hidden rows in search | Assertion detects mismatch or cross-world divergence | Failure caught |
| Deliberate leak: export | `tamperRepos` leaks private accounts in export | Assertion detects mismatch or cross-world divergence | Failure caught |
| Deliberate leak: audit | `tamperRepos` leaks person-scoped or private audit rows | Assertion detects unauthorized rows returned | Failure caught |
| Deliberate leak: summary line | `tamperRepos` leaks private amounts into B's summary | Assertion detects summary mismatch against visible rows | Failure caught |
| Deliberate leak: day nets | `tamperRepos` leaks private amounts into B's day nets | Assertion detects day nets mismatch against visible rows | Failure caught |
| Deliberate leak: badge count | `tamperRepos` leaks private uncategorised rows | Assertion detects badge count mismatch against visible rows | Failure caught |

</frozen-after-approval>

## Code Map

- `apps/server/src/privacy/privacy-harness.ts:410-520` -- extend `LeakMode` (`search`, `export`, `audit`, `summary`, `day-nets`, `badge`) and `tamperRepos` to inject deliberate leaks across these surfaces, adding `audit.listVisible` tampering
- `apps/server/src/privacy/privacy.test.ts:77-122` -- extend `readTranscript` with search and export query replays across paired worlds
- `apps/server/src/privacy/privacy.test.ts:558-806` -- add per-viewer verification that summary line, total count, day nets, badge count, and amount-search results match computations from visible rows; add audit log person-scoping tests
- `apps/server/src/privacy/privacy.test.ts:808-820` -- extend hidden-name tests to assert partner searching by name, amount, or notes never finds a hidden transaction while owner finds it by each
- `apps/server/src/privacy/privacy.test.ts:822-895` -- extend deliberate-leak test group with assertions for search, export, audit, summary line, day nets, badge count, and hidden-name search leaks

## Tasks & Acceptance

**Execution:**
- [x] `apps/server/src/privacy/privacy-harness.ts` -- extend `LeakMode` and `tamperRepos` with audit, search, export, summary, day-nets, and badge leak modes -- harness support
- [x] `apps/server/src/privacy/privacy.test.ts` -- extend `readTranscript` with search and export query replays across paired worlds -- byte-identical coverage
- [x] `apps/server/src/privacy/privacy.test.ts` -- add per-viewer verification that summary line, total count, day nets, and badge count equal calculations from visible rows -- workspace surface verification
- [x] `apps/server/src/privacy/privacy.test.ts` -- add amount-search and hidden-name search tests (checked by name, amount, and notes) per viewer -- search privacy verification
- [x] `apps/server/src/privacy/privacy.test.ts` -- add audit log person-scoping and visibility tests -- audit privacy verification
- [x] `apps/server/src/privacy/privacy.test.ts` -- add deliberate-leak tests for search, export, audit, summary line, day nets, badge count, and hidden-name search -- deliberate leak detection

**Acceptance Criteria:**
- Given paired worlds W1 and W2 differing only in A's private delta, when partner B requests `GET /api/ledger/search` and `GET /api/ledger/export` with varied query parameters, then responses are byte-identical between the worlds.
- Given a viewer, when inspecting the transaction list, then the summary line (`count`, `inCents`, `outCents`, `netCents`), total count, day nets, and nav badge count equal the values computed from only the rows that viewer may see.
- Given a transaction with a hidden name, when partner B searches by its name, amount, or notes, then it is never returned, whereas owner A searching by name, amount, or notes finds it.
- Given audit log entries with person scope, private account scope, and household scope, when calling `GET /api/system/audit`, then person-scoped rows return only to that person, private-account rows return only to owners, and unscoped rows return to both.
- Given deliberate leaks injected into search, CSV export, audit-log API, summary line, day nets, badge count, and hidden-name search, then the privacy suite fails and identifies the leak.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Search index does not store visibility; hidden-name exclusion is enforced at query time via `projection.hidden = 0` and `noForeign` scoping checks. The nav badge count represents uncategorised transactions visible to the viewer (`listTransactions(ctx, { uncategorised: true }).page.total`).

## Verification

**Commands:**
- `npx vitest run apps/server/src/privacy/privacy.test.ts` -- expected: pass
- `pnpm -r typecheck` -- expected: pass
- `pnpm lint` -- expected: pass
