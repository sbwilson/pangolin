---
title: 'Transaction list: URL filters, keyset paging, virtualised'
type: 'feature'
ticket: '2'
created: '2026-10-07'
baseline_revision: '4e447e17b845932a28ea7fb03a8c10dc9e7f870d'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `GET /api/ledger/transactions` returns every visible row at once and `/ledger` is a plain list, so a household with thousands of transactions can neither page, filter nor share a filtered view by URL.

**Approach:** The list API pages by keyset with a server total, summary and day nets, and filters on `visibleTxn`; the page at `/transactions` (with `/ledger` redirecting to it) holds its filters and date range in URL search params, groups rows by date and shows a virtualised table. Split by Simon on 2026-10-07: the CSP nonce wiring for popover, sheet and toast and the nav badge are not in this plan (see `deferred-work.md`).

## Boundaries & Constraints

**Always:**
- The API path is unchanged. It returns `{ transactions, page, summary, dayNets }`: 50 rows a page ordered `posted_on` desc, `id` desc; `page` carries `total`, `pageCount`, `page` and the `next` and `prev` keyset cursors; `summary` is `count`, `inCents` and `outCents` for the whole filter; `dayNets` maps each date on the page to its net. All of it is computed by the server, on `visibleTxn`, per viewer; the web never sums money.
- Filters: account, date range, category, tag, payee, amount range, type (in or out), uncategorised, transfers and hidden. Decided by Simon, 2026-10-07: "hidden" means rows whose name is hidden from the viewer now (`visibleTxn`'s `hidden`, the other person's unexpired hiding); "uncategorised" means at least one split has no category. Payee, hidden and any text-bearing filter use the projection (`visibleTxn`'s `payeeId`, `hidden`), never the raw columns, so another person's scoped payee, tag or a hidden name cannot be probed. A filter parser is exported from `@pangolin/app` for reuse by search (entries 5 and 6).
- Paging by keyset cursor (`next`, `prev`); a jump to page p [ASSUMPTION] runs the same sort with OFFSET (p−1)×50 over the filter and returns the cursor for paging on, landing on the rows keyset paging reaches.
- The page `/transactions` (`/ledger` replace-redirects there keeping its search params, no extra history entry): chips All · Needs review (shown disabled) · Uncategorised · Transfers, Type, Account and Category controls (native `select` elements), and the date range (Quarter · FY to date, and Custom as two native date inputs; decided by Simon, 2026-10-07, so the calendar popover and shared Select wait for the CSP nonce wiring), all in URL search params; Clear filters resets all but the date range; the date-range control sits in the page's own header; rows grouped by date with the day net; the summary line; the pager "Showing X of N · Page p of P"; a virtualised table; empty state "No transactions yet" (no Import button yet) and no-match state "Nothing matches those filters." with Clear filters; below `md` the Account column and the checkbox column are hidden; no horizontal scroll at 320 px.
- The sidebar item is renamed Transactions at `/transactions`.

**Never:** build the nav badge, the CSP nonce wiring, text search, the bulk bar, the transaction sheet or the Import flow; change the read rule or `redact()`; sum money on the client.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First page | No filters, 120 rows | 50 rows, `total` 120, `pageCount` 3, `next` set, `prev` null | none |
| Keyset next and prev | The `next` then `prev` cursor | The following then the preceding 50 rows, no gap or overlap | none |
| Page jump | `page=3` | The rows keyset paging reaches at page 3, with the cursor | `page` out of range: 400 `Validation` |
| Each filter | Account, dates, category, tag, payee, amount, type, uncategorised, transfers, hidden | Only matching rows; total, summary and day nets follow the filter | bad value: 400 `Validation` |
| Per viewer | B lists with A's private rows and A's scoped payee or hidden name present | B's totals, rows and filters are as if they did not exist | A's payee id filter returns nothing, no error difference |
| Redirect | `/ledger?type=in` | Lands on `/transactions?type=in`, one history entry | none |
| Clear filters | Chips and selects set, a date range chosen | All reset except the date range | none |
| Empty and no match | No rows; filters match nothing | "No transactions yet"; "Nothing matches those filters." with Clear filters | none |
| Phone | 375 px and 320 px | Filters, summary and list render, Account and checkbox columns hidden, no horizontal scroll | none |
| 1000 rows | 1000 rows given to the table | Windowed; date-group headers; `aria-rowcount` correct | none |

</frozen-after-approval>

## Code Map

- API: `apps/server/src/http/app.ts:310` (add query parsing with the exported parser; keep `no-store`); `packages/app/src/ledger/list-transactions.ts` (input schema, paging and summary; keep `toLedgerTransaction`); new filter parser export from `packages/app/src/index.ts`.
- Port and adapters: `ports/unit-of-work.ts:537` (`listVisible`; add a page method, a count and summary, day nets; keep `ReadRepos` Pick at `:1202` in step); SQLite `packages/db/src/ledger-repos.ts:497` and `privacy.ts:85-153` (`visibleTxn`: filter on its `where`, `payeeId`, `hidden`; splits and tags via `visibleTxnId`, tag scope `privacy.ts:200`); memory mirror `testing/memory-uow.ts:1178` (same text-compare ordering, `nameHiddenFor`, `transferLabelFor`). An index for `(posted_on, id)` needs migration `0012` and its snapshot (`packages/db/drizzle.config.ts`, `migrate.test.ts`) if the profile shows it is needed; the 300 ms budget is entry 6's.
- Privacy: `privacy-harness.ts:422-472` wraps `listVisible` for fault injection: wrap each new method; `route-manifest.ts:163` entry stays (queries are not in the manifest); extend `readTranscript` (`privacy.test.ts:75`) or add a scenario so B's filtered reads are compared in paired worlds.
- Web: `apps/web/src/router.tsx:9` (add `/transactions`; `/ledger` becomes a `beforeLoad` replace-redirect that keeps search), `routes/ledger.tsx`, `routes/search.ts` (string search params), `api.ts:259` (`fetchTransactions(params)` and types), `pages/LedgerPage.tsx` (becomes the transactions page; reuse the spacer-row virtualiser, 40 px rows), `RootLayout.tsx:14` (`NAV` label and path), `components/ui/` (small native `select` and date-input wrappers).
- Tests: `ledger.test.ts`, `repo-parity.test.ts` (list, count, cursors, filters on both adapters), `app.test.ts:661` (query params, 400s), `privacy.test.ts`; web `router.test.ts:49` and `api.test.ts:169`; e2e `routing.spec.ts` (stub `**/api/ledger/transactions*` with the new shape, 1000-row test at `/transactions`, redirect, 375 and 320 px), `ledger.spec.ts` (paths, first page 50 rows, total from the server).
- Do not change: `redact.ts`, `ledger/transaction-view.ts` semantics, entries 3 and 4 surfaces.

## Tasks & Acceptance

**Execution:**
- [x] filter parser, `listTransactions`, port, SQLite and memory adapters, route -- paging, total, summary, day nets, filters
- [x] parity, API and privacy tests -- the matrix at repo, use-case and HTTP level; paired worlds for the filters
- [x] router, `/transactions` page, sidebar -- URL state, groups, summary, pager, states, phone layout, virtualised table
- [x] web unit and e2e tests, existing specs updated

**Acceptance Criteria:**
- Given a viewer with 120 visible rows, when they page by `next`, `prev` and a jump, then each page is the same 50 rows whichever way it is reached, and `total`, `summary` and `Page p of P` are the server's.
- Given any filter in the URL, when the page loads, then the rows, summary and day nets match, and Clear filters keeps only the date range.
- Given the partner's private data, when the viewer lists with any filter, then nothing about it appears or changes a total.
- Given `/ledger?…`, when opened, then the browser lands on `/transactions` with the same params and one history entry.

## Implementation Notes

Decisions the plan left to the builder: `type=in` is amount above 0 and `type=out` below 0; `minCents` and `maxCents` compare the absolute amount; `outCents` is returned non-negative; a day net covers the whole filtered day, not only the rows on the page; `transfers=false` and the other `=false` flags read as absent; the Quarter preset is the calendar quarter (also the Australian FY quarter) and FY to date runs from 1 July; the browser's clock decides today for the presets. A page past the end is a 400, as the matrix says; the web validator and an error-state "Reset filters" control keep a stale link from dead-ending. No migration: the profile (100k rows) put the worst case, a deep offset jump with the uncategorised filter, at about 190 ms.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 1 patched, 5 low patched, 1 deferred group, 15 rejected, false 1, maybe-false 1.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| A transaction in a closed account shows a blank Account cell and cannot be filtered by account: `fetchAccounts` omits closed accounts since story 2.25 (blind, edge, VG) | medium | patch | `api.ts` `fetchAccounts` calls `/api/accounts` with no `includeClosed`; the list still returns closed-account rows. Ask for `includeClosed=true`. |
| Clear filters is inert when only a date range is set, so the no-match state offers no way out (blind, edge) | low | patch | `hasFilters` counts the range, `clearedFilters` keeps it. Show the button only when another filter is set, and otherwise suggest a wider range. |
| The web search validator checks shape only: impossible dates, reversed ranges and `page` with a cursor reach the server's 400, and a stale `?page=N` ends in "Transactions unavailable" with no way out (blind, edge) | low | patch | `routes/search.ts`; tighten the validator (real calendar dates, drop a reversed pair, drop `page` when a cursor is set) and give the error state a control that resets the filters. The server's 400 for a `page` past the end is the plan's. |
| No test asserts exact `dayNets` for a day split across a page or a day partly excluded by a filter (VG) | low | patch | `app.test.ts` and `ledger.test.ts` assert `any(Number)` and the filtered check holds with or without the filter; add exact values. |
| Changing a filter from page 2 dropping `after`, `before` and `page` is unverified (VG) | low | patch | `withChanges`; extend the seeded e2e case: Next, change Type, expect no cursor and Page 1; also Previous and the jump form. |
| `parseTransactionQuery` says it validates and mentions search consumers that do not exist yet (blind) | low | patch | Reword the doc comment. |
| No unit tests for `groupByDate`, `withChanges`, `activeChip`, the jump handler; no loading cue; stale rows beside the error alert; chips can disagree with a URL that sets both flags; `All` looks pressed with other filters; `today` is fixed at mount; partial date-input edits (blind, edge) | low | defer | Web logic is covered by e2e only (the web vitest has no DOM setup); none corrupts data. |
| Virtualisation only engages with a stubbed response (page size 50, threshold 200) (blind, edge, intent) | low | rejected | The ticket asks for a virtualised table and a 1000-row check; the threshold keeps the existing behaviour. |
| Inert row checkboxes, filters with no control (tag, payee, amount, hidden), disabled Needs review chip (blind, intent) | low | rejected | The plan lists them (checkbox column hidden on phone; filters are API and URL). |
| Unknown or empty query values give 400; the old `/ledger` Back button is gone; filter changes add history entries; the redirect drops a hash (edge, blind) | low | rejected | Strict parsing is the plan; navigation choices are not defects. |
| No index or plan check for the new queries (blind) | false | rejected | The implementer profiled 100k rows: worst case about 190 ms for a deep offset jump with the uncategorised filter. |
| `listAllTransactions` is O(pages) and has no loop guard; privacy probes omit `category`, `hidden` and combined cursors; harness tamper modes do not model a raw-column filter (blind, edge) | low | rejected | Seed and test helper only; the parity test shows scoped payee, tag and hidden name match nothing for B. |
| Stale-cursor page number may disagree with a `?page=p` jump (edge) | maybe-false | rejected | The parity test pins keyset and offset to the same rows; the cursor fallback lands on a whole page. |

## Design Notes

Filters read the projection so a probe by another person's payee or hidden name cannot tell data from none. The cursor is `(posted_on, id)`; the jump uses OFFSET only to find a page's first row and then hands back a cursor, so the table follows keyset paging from there.

## Verification

**Commands:**
- `pnpm vitest run` -- expected: pass; `pnpm lint` and `pnpm typecheck` -- expected: clean
- `pnpm test:e2e` (or the repo's e2e script, with `E2E_SEED_COMMAND`) -- expected: routing and ledger specs pass at `/transactions`

**Outcomes (2026-10-07, after review pass 1):** `pnpm vitest run` 105 files, 1,624 tests passed (1 expected fail, 1 skipped, both existing); `pnpm lint` 0 errors, 8 existing warnings; `pnpm -r typecheck` clean, including the e2e project. The implementer built the app and ran it in demo mode in a browser: paging, the Transfers and Quarter chips, the no-match state and 320 px with no horizontal scroll behaved. **Not run:** the e2e specs (`routing.spec.ts`, `ledger.spec.ts`), which need the container and `E2E_SEED_COMMAND`; CI runs them. Unverified under Playwright: the `rowheader` role on date headers and the exact "Showing 50 of N · Page 1 of P" text.
