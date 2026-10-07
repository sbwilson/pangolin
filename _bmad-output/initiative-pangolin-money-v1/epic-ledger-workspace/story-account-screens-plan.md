---
title: 'Account screens (Accounts page and /accounts/:id)'
type: 'feature'
ticket: '4'
created: '2026-10-07'
status: 'built'
baseline_revision: '1e0e2b5d057bba0dac5eee67ac1e5fa1a0954d86'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter','edge-case-hunter','verification-gap','intent-alignment']
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The web app has no way to see, create or edit accounts, or to see one account's balance and transactions; the accounts API and its refusals are unused by the UI.

**Approach:** Add an Accounts page (grouped rows, Properties placeholder, create/edit sheet for details, owners and shares, privacy) and an `/accounts/:id` page (balance, freshness, that account's transactions through the existing list and date-range control), surfacing API refusals verbatim.

## Boundaries & Constraints

**Always:** Tailwind classes only (CSP forbids inline styles); the web never sums money, so use server figures; keep the `["ledger","transactions"]` query-key prefix; groups are Cash (transaction, offset) · Savings (savings) · Cards (credit_card) · Loans (home_loan) · Investments (brokerage, super) · Other (vehicle, other); stale means newest posted_on more than 45 days old, shown in the warning colour; the lock shows for private accounts to their owner only.

**Decisions:** Freshness comes from a new `newestPostedOn` field on the accounts API (`AccountView`/list, `packages/app/src/accounts`, `apps/server`), not per-account web queries. Non-cash types (brokerage, super, vehicle, other) show no balance, on the list or the detail page.

**Never:** Import provenance, the stale row's Import shortcut, '% repaid', 'Add loan by hand'; other server or `packages/app/src/accounts` changes; changes to `routes/search.ts`, `lib/date-range.ts`, `components/ui/*`, `fetchAccounts`/`AccountSummary`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Grouped list | Seeded accounts | Rows land in their groups; Properties card placeholder shown | No error expected |
| Stale | Newest posted_on over 45 days old | Stale caption in warning colour | No error expected |
| Create | Valid name, type, owners summing to 100% | Account appears in its group | Validation message shown |
| Remove other owner | Non-owner edits owners | Refused | Server message shown |
| Private with others' splits | setPrivacy(private) | Refused | Conflict message shown |
| Public with scoped refs | setPrivacy(public) | Refused, naming references and owners | Conflict message and `details` shown |
| Account detail | `/accounts/:id?from&to` | Balance, freshness, only that account's transactions in range | Unknown id shows not found |

</frozen-after-approval>

## Code Map

- `apps/web/src/router.tsx:10-16` -- add `accountsRoute`, `accountRoute` to `routeTree`
- `apps/web/src/routes/transactions.tsx` -- route pattern to copy; new `routes/accounts.tsx`
- `apps/web/src/components/RootLayout.tsx:14-17` -- add Accounts to `NAV`
- `apps/web/src/pages/TransactionsPage.tsx:40-223,351-423` -- date-range fieldset, `withChanges`, pager are hard-wired to `/transactions`; extract into a shared component taking route and forced account
- `apps/web/src/api.ts:77-127,331-343` -- `ApiError`, `Me` (personId, partner), add full `AccountView` client functions (list, get, create, update, setPrivacy, balance)
- `apps/web/src/styles.css:6-52` -- add `--warning`/`--color-warning` (DESIGN.md: #8A5600 light, #E6B455 dark)
- `packages/app/src/accounts/{pool,list-accounts}.ts`, `apps/server/src/http/app.ts:381-458` -- add `newestPostedOn` to `AccountView`; refusals already exist
- `packages/app/src/accounts/balance.ts:81-108` -- cash types only; web hides balance for the rest
- `tools/seed/src/modules/institutions-and-accounts.ts` -- seeds only cash, savings, offset, card, loan; no Investments, Other or property rows
- `pages/TransactionSheet.test.tsx`, `e2e/ledger.spec.ts` -- component and seeded e2e patterns

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/accounts/*`, `apps/server/src/http/app.ts` -- `newestPostedOn` on account views, with a test -- freshness source
- [ ] `apps/web/src/api.ts` -- account client functions and types -- UI needs them
- [ ] `apps/web/src/styles.css` -- warning tokens -- stale caption
- [ ] `apps/web/src/pages/AccountsPage.tsx` -- groups, Properties placeholder, lock, stale caption, create/edit sheet with owners, shares, privacy and refusals -- story core
- [ ] `apps/web/src/pages/AccountPage.tsx` plus shared date-range/list component -- balance, freshness, filtered transactions
- [ ] `router.tsx`, `routes/accounts.tsx`, `RootLayout.tsx` -- routes and nav
- [ ] `AccountsPage.test.tsx`, `e2e/accounts.spec.ts` -- component tests for create, owners, privacy refusal; e2e for grouping, placeholder, stale caption and detail range

**Acceptance Criteria:**
- Given the seeded ledger, when Accounts opens, then each account sits in its group and the Properties placeholder shows.
- Given an account whose newest posted_on is over 45 days old, when listed, then the stale caption uses the warning colour.
- Given `/accounts/:id` with from and to, when it loads, then it shows that account's balance, freshness and only its transactions in range.
- Given the e2e CSP guard, when the pages load, then no violations occur.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; high 0, medium 1, low 4, false 9, maybe-false 1)

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | defer | `property` accounts appear in no group. Intent allows only a Properties placeholder; real handling belongs to epic-loans-property. |
| low | patch | TransactionList keeps state when the route id changes; `key={id}` on AccountPage. |
| low | patch | Private-create path (`choosePrivate`) untested. |
| low | patch | Edit-diff and no-op save in `save()` untested. |
| low | patch | e2e `getByText` count matches by substring. |
| low | defer | Stale `?account=` on `/accounts/:id` still counts in `hasFilters`; unlikely, fix adds branches. |
| low | defer | Owner who is neither me nor my partner is dropped on owner edits; two-person household today. |
| low | defer | e2e `accounts` project depends on `chromium` and is skipped if that fails. |
| maybe-false | defer (low, rejected) | `latestPostedOn` counts pending and future-dated lines; would settle by checking it against the epic's assumption. |
| false | rejected | `parseCents("60")` gives 6000 bp, so shares parse correctly; the server checks the 100% sum. |
| false | rejected | Invalidating `["accounts"]` in `changeCategory`; a category change affects neither balance nor newest date. |
| false | rejected | Non-cash accounts reading "No transactions yet"; decision 2a and the epic's assumption set this. |
| false | rejected | Malformed `newestPostedOn` strings; the server always emits `YYYY-MM-DD` or null. |
| false | rejected | Changes to `ports/unit-of-work.ts`, `memory-uow.ts` and the db unit of work; required to expose `latestPostedOn`, so the plan's Never clause does not reach them. |
| false | rejected | Unsafe `as never` typing, duplicate refusal keys, missing e2e create flow, aria and id nits; no demonstrated bad outcome. |

## Design Notes

The owner picker uses `me` and `me.partner` (no people endpoint). Closed accounts, the removal marker with rejoin, and the closing-balance warning are handoffs from other epics and stay out unless trivial.

## Verification

**Commands:**
- `npx vitest run apps/web` -- expected: pass
- `npx playwright test e2e/accounts.spec.ts` -- expected: pass
