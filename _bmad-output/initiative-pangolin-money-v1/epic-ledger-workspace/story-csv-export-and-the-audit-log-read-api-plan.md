---
title: 'CSV export and the audit-log read API'
type: 'feature'
ticket: '6'
created: '2026-10-08'
status: 'built'
baseline_revision: '7145643f573b8dfb4a183afff7a861bfc77afe87'
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

**Problem:** Users cannot export filtered transaction records to CSV, and the system lacks an HTTP endpoint to inspect privacy-scoped, redacted audit events. Stale sessions must be rejected on export, formulas neutralized, and audit entries kept owner-only for private accounts and private eras.

**Approach:** Implement `GET /api/ledger/export` behind recent re-authentication (`requireRecentAuth`, 403 `ReauthRequired`) accepting query filters from `parseTransactionQuery` and formatting RFC 4180 CSV with formula neutralization; add a header Export action and inline reauth fallback to `TransactionList`; and expose `GET /api/system/audit` using `listAudit` with per-viewer account visibility, person scoping, and `redact()` before/after sanitization.

## Boundaries & Constraints

**Always:** `GET /api/ledger/export` requires re-authentication within 5 minutes (`requireRecentAuth`); filters match the transaction list parser (`parseTransactionQuery`); partner B never sees partner A's private accounts; hidden-name descriptions for non-owners read `"Hidden until <date>"` with null payee; cells starting with `=`, `+`, `-`, or `@` are prefixed with `'` on export; `GET /api/system/audit` returns `{ audit: listAudit(ctx) }` where rows with `accountId` filter through `visibleAccounts`, rows with `personId` return only to that person, rows with neither return to both, private-era rows stay owner-only via `person_id`, and before/after JSON is sanitized by `redact()`; route manifest pending entries for export and audit are replaced with concrete `read` entries.

**Never:** Allow stale or unauthenticated export; leak private accounts, payees, or raw hidden names across partners; add external UI packages or inline styles.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Recent auth export | Signed-in person (`authAt` < 5 min), `GET /api/ledger/export?from=2026-07-01` | 200 `text/csv; charset=utf-8`, filtered rows exported | No error expected |
| Stale session export | Signed-in person (`authAt` > 5 min), `GET /api/ledger/export` | 403 with `{ error: { code: "ReauthRequired" } }` | `AppError("ReauthRequired")` |
| Hidden name, partner | A hides transaction name; B requests export | B's CSV has `"Hidden until <date>"`, empty payee | No error expected |
| Formula injection | Description is `=SUM(A1:A10)`, `-14.50`, or `@payee` | Prefixed with `'` (`'=SUM(A1:A10)`, `'-14.50`, `'@payee`) | No error expected |
| Multi-split row | Transaction with splits $60 groceries and $40 household | 2 CSV rows matching split amounts/categories | No error expected |
| Audit scope per viewer | A's private-account row, B's person-scoped row, shared household row | A sees private + shared; B sees person + shared | No error expected |
| UI ReauthRequired | User clicks Export CSV with expired re-auth | Inline alert with "Sign in again" button calling `signOut` | Caught `ApiError` |

</frozen-after-approval>

## Code Map

- `packages/app/src/ledger/export-transactions.ts` -- `exportTransactionsCsv(ctx, input)` enforcing `requireRecentAuth`, reading transactions via `listTransactions` / `toTransactionFilter`, resolving account/category/payee names, formatting RFC 4180 CSV with formula neutralization (`=`, `+`, `-`, `@`)
- `packages/app/src/ledger/export-transactions.test.ts` -- unit tests for `exportTransactionsCsv`: re-auth window, query filters, hidden-name redaction, formula escaping, multi-split rows
- `packages/app/src/index.ts` -- export `exportTransactionsCsv`
- `apps/server/src/http/app.ts:312-322` -- register `GET /api/ledger/export` (`text/csv`, attachment filename) and `GET /api/system/audit` (`{ audit: listAudit(ctx(c)) }`)
- `apps/server/src/privacy/route-manifest.ts:345-356` -- replace pending entries with `read("/api/ledger/export")` and `read("/api/system/audit")`
- `apps/server/src/http/app.test.ts` -- test `/api/ledger/export` (200 CSV, 403 ReauthRequired, query filters) and `/api/system/audit` (viewer visibility, person scoping)
- `apps/server/src/privacy/privacy.test.ts:493-505` -- update pending entries check; verify export and audit in person entries pass across worlds
- `apps/web/src/api.ts` -- `exportTransactions(params: TransactionsSearch): Promise<string>`
- `apps/web/src/pages/TransactionList.tsx` -- header "Export CSV" button, blob download, inline `ReauthRequired` alert with "Sign in again" button
- `apps/web/src/pages/TransactionList.test.tsx` -- component tests for Export CSV button, download trigger, and inline ReauthRequired prompt

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/ledger/export-transactions.ts`, `packages/app/src/index.ts` -- `exportTransactionsCsv` use case with `requireRecentAuth`, query parsing, name resolution, and RFC 4180 formula neutralization -- core use case
- [x] `packages/app/src/ledger/export-transactions.test.ts` -- test re-auth enforcement, filter parameters, hidden-name redaction, multi-split lines, and formula escaping -- use-case tests
- [x] `apps/server/src/http/app.ts`, `route-manifest.ts` -- register `/api/ledger/export` and `/api/system/audit` and swap pending manifest entries for `read` entries -- server routes
- [x] `apps/server/src/http/app.test.ts`, `apps/server/src/privacy/privacy.test.ts` -- route integration tests and privacy suite update -- server tests
- [x] `apps/web/src/api.ts`, `TransactionList.tsx`, `TransactionList.test.tsx` -- client method, header Export CSV button, blob download, inline ReauthRequired alert, and tests -- web UI

**Acceptance Criteria:**
- Given a person whose authentication is older than 5 minutes, when requesting `GET /api/ledger/export`, then HTTP 403 `ReauthRequired` is returned.
- Given recent authentication, when `GET /api/ledger/export` is called with filter parameters, then matching rows are returned in RFC 4180 CSV with cells starting with `=`, `+`, `-`, or `@` prefixed with `'`.
- Given partner A with private accounts and hidden transactions, when partner B exports CSV, then A's private accounts are excluded and hidden names read `"Hidden until <date>"` with no payee leak.
- Given audit rows of various scopes, when `GET /api/system/audit` is called, then person-scoped rows return only to their person, private-account rows return only to owners, private-era rows return only to the owner, and unscoped rows return to both.
- Given `route-manifest.ts`, when the privacy suite runs, no routes remain under pending entries and B's reads are byte-identical across the paired worlds.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; high 0, medium 2, low 7, false 2, maybe-false 0)

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | Detached anchor element click and immediate synchronous `revokeObjectURL` in `handleExport` can abort downloads in Firefox/Safari. Fixed by appending anchor to `document.body`, clicking, removing, and deferring `revokeObjectURL` via `setTimeout`. |
| medium | patch | `exportTransactions` API client method unverified in `apps/web/src/api.test.ts`. Fixed by adding unit tests asserting request URL, query parameter forwarding, CSV return, and 403 `ApiError("ReauthRequired")` throwing. |
| low | patch | Leading whitespace or tabs preceding formula triggers bypass `neutralizeFormula`. Fixed by checking `cell.trimStart()[0]` against formula prefixes so trimmed triggers are prefixed with `'`. |
| low | patch | Export CSV button lacked visual loading text and assistive feedback while exporting. Fixed by displaying "Exporting…" and setting `aria-busy={isExporting}`. |
| low | rejected | Missing dismiss action on inline `ReauthRequired` banner. Dismissive alert persists until action re-attempted or sign-in, matching existing `HomePage` and `RecoveryViews` patterns. |
| low | rejected | Missing UTF-8 BOM in CSV export. Standard RFC 4180 CSV without BOM; charset is declared in HTTP headers. |
| low | rejected | Soft-deleted categories resolve to empty strings in CSV export. Soft-deleted categories are intentionally excluded from active classification reads. |
| low | rejected | Unbounded audit log query on `GET /api/system/audit` lacking pagination. The M1 audit API is designed as a direct export of `listAudit` without pagination per spec and epic decisions. |
| low | rejected | Missing test assertion for `before`/`after` JSON sanitization in `app.test.ts`. Covered thoroughly in `privacy.test.ts:879-883` and `privacy-scenarios.ts`. |
| false | rejected | Formula neutralization prefixes negative amounts with apostrophes, converting numbers to text. Refuted: frozen intent, boundaries, and I/O matrix explicitly require negative amounts like `-14.50` to be prefixed with `'` on export (`'-14.50`). |
| false | rejected | Bypassed type safety via `as never` on `api.api.ledger.export.$get`. Refuted: follows established codebase pattern of `fetchTransactions` and `fetchAccounts` where query parameters are parsed by domain parsers. |

## Design Notes

Export rows are generated per split so categories, memos, and tags are preserved and amounts sum to the transaction total. Any cell beginning with `=`, `+`, `-`, or `@` is prefixed with `'` to neutralize formula execution in spreadsheets.

## Verification

**Commands:**
- `npx vitest run packages/app/src/ledger/export-transactions.test.ts` -- expected: pass
- `npx vitest run apps/server/src/http/app.test.ts` -- expected: pass
- `npx vitest run apps/server/src/privacy/privacy.test.ts` -- expected: pass
- `npx vitest run apps/web/src/pages/TransactionList.test.tsx` -- expected: pass
- `npx vitest run` -- expected: pass
- `pnpm -r typecheck` -- expected: pass
- `pnpm lint` -- expected: pass
