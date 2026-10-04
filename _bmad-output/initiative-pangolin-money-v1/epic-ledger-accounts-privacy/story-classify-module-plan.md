---
title: 'Classify module'
type: 'feature'
ticket: '5'
created: '2026-10-04'
status: 'built'
baseline_revision: '2a41bbe275abea9c2a059f974e5a2c1b8b55f412'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/categorisation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The classification tables and repos exist (story 2.2) but nothing creates or edits categories, tags, payees, aliases, activities or tax categories, there are no default categories, and no routes.

**Approach:** Add the classify use cases, the default categories and tax categories, and the API routes, with payee, alias, tag and activity scope derived from an origin account per AD-18.

## Boundaries & Constraints

**Always:** Category groups, categories and tax categories are household-wide and any viewer may edit them. Payee, payee_alias, tag and activity are scoped: create takes an optional `originAccountId` and never a client-supplied scope; no origin or a public origin account gives a shared row (origin null); a private origin account gives `scopePersonId` = its sole owner and stores the origin. The origin account is never in a row type, view or audit payload. A partner's scoped row is absent from lists and `NotFound` by id for get, update and delete; `findVisible` on a partner's private origin account is `NotFound` (AD-5). Names are unique per scope among live rows; a `Conflict` message never mentions scope. A shared name colliding with the partner's hidden scoped name succeeds. An alias takes the scope of its payee: same scope, or a shared payee; a shared alias never points at a scoped payee. Update and soft-delete take the viewer first and apply `visibleScope` in SQL and in the memory mirror (closes the deferred scoped-write item). Every audit row of a scoped row carries `personId = scopePersonId`, plus `accountId` of the origin only when it is private; household-wide rows carry neither. Scope is never changed by update; promotion to shared is epic-import-dedupe-transfers. Categories soft-delete and keep referencing splits; a deleted category clears payee `default_category_id`. Alias regex patterns must compile and have a length cap; activity `startsOn <= endsOn`, `budgetCents >= 0`. Memory unit of work mirrors every new repo method with parity tests, including CHECK parity for kinds and match kinds.

**Decisions:** Defaults are seeded by an idempotent `seedDefaults` use case run as the system at server start after migrate, only when there are no category groups; ids are server-minted; the demo and e2e seed paths run it too. Essentials are fixed-cost: rent, mortgage repayments, rates and strata, home and contents insurance, electricity, gas, water, internet, mobile, registration and CTP, car insurance, private health insurance, subscriptions, life and income protection insurance, investment-property loan repayments and council rates; all others are false. A scoped name equal to a visible shared name is allowed (different scope). Deleting a payee always soft-deletes it, with no in-use check (a check would reveal hidden transactions, AD-5); transactions keep their payee id and its name, and only lists and pickers stop showing the payee. Seeded ATO tax categories (D1, D2, D4, D5, D9, D10, D15, rental schedule) default to a deductible share of 0.

**Never:** No attach/detach of tags to splits (story 2.6), no rule table, no promotion, no UI, no logo upload, no case-insensitive uniqueness migration. Category groups have no delete (rename, kind and sort only). No change to `visibleTxn`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Private-origin payee | Owner creates with a private `originAccountId` | Scoped to the owner, origin never returned | No error expected |
| Partner reads | Partner lists, gets, updates or deletes that payee | Absent from list; 404 by id | NotFound |
| Partner's private origin | Partner passes the owner's private account as origin | 404 | NotFound |
| Same name, other scope | Partner creates a shared payee with the owner's scoped name | Succeeds | No error expected |
| Same name, same scope | Duplicate live name in one scope | Refused, scope not mentioned | Conflict |
| Alias on scoped payee | Shared alias targeting a scoped payee | Refused | Validation |
| Category deleted | Soft-delete a category used by a payee default and splits | Splits untouched, payee default cleared | No error expected |
| Bad alias | Regex that does not compile | Refused | Validation |
| Defaults | First start on an empty household | Default groups, categories and tax categories exist once | No error expected |
| Audit | Scoped create or update | Row carries `personId`, no origin in payload | No error expected |

</frozen-after-approval>

## Code Map

- `packages/db/src/classify-repos.ts`, `privacy.ts` (`visibleScope`) -- repos exist with insert, find, list, softDelete; add `update`, viewer-first `softDelete`, group and category updates.
- `packages/app/src/ports/unit-of-work.ts` (~470-620), `testing/memory-uow.ts` (~1043-1290, generic `scoped()`) -- ports, memory mirror and its CHECK parity.
- `packages/app/src/accounts/*` -- pattern to copy (`inputs.ts` `idInput`, `dayInput`; `write`; views); share inputs across modules.
- `packages/app/src/classify/` (new) -- `category-groups.ts`, `categories.ts`, `tax-categories.ts`, `tags.ts`, `payees.ts` (payee and alias), `activities.ts`, `scope.ts` (`scopeFor`), `defaults.ts` (`DEFAULT_CATEGORIES`, tax categories), views; export from `packages/app/src/index.ts`.
- `_bmad-output/specs/spec-pangolin-money/categorisation.md` -- 13 groups and their categories; kinds: Income income, Transfers transfer, the other 11 expense.
- `apps/server/src/http/app.ts`, `errors.ts` -- routes under `/api/classify/*` for category-groups, categories, tax-categories, tags, payees, payees/aliases, activities (GET/POST, PATCH, DELETE where allowed), using `writable()` and `objectBody`; scoped POST bodies accept `originAccountId` only.
- `apps/server/src/admin/seed.ts`, `tools/seed` -- keep working with the defaults.
- Tests: `packages/db/src/classification-repos.test.ts`, new `packages/db/src/classify.test.ts` (real SQLite, as accounts tests), `apps/server/src/http/app.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] ports, repos, memory mirror: `update`, viewer-first writes, CHECK parity, parity tests
- [ ] use cases, `scopeFor`, defaults and the seeding mechanism, unit tests on real SQLite per rule
- [ ] routes and API tests (partner 404, same-name create, demo-mode 409)
- [ ] audit tests: every classify write carries the right `personId`/`accountId`, no origin in payloads
- [ ] test that a shared transaction referencing a scoped payee shows no `payeeId` to the partner

**Acceptance Criteria:**
- Given a private-scoped payee, when the partner lists, reads, updates or deletes it, then it is absent or 404.
- Given a fresh household, when the server starts, then the default categories exist exactly once.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 1 medium resolved by a user decision, 2 medium and 2 low patches; 11 deferred; 4 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | intent_gap, resolved | `deletePayee`'s in-use `Conflict` counted transactions in accounts the deleter cannot see, revealing hidden transactions (AD-5); the user decided a payee delete always soft-deletes, with no in-use check, and the plan decision was amended. |
| medium | patch | Audit scope on `updateTag`, `updateActivity`, `updatePayeeAlias` untested (verification-gap, pre-verified); audit visibility asserted with hand-written SQL instead of the real read. |
| low | patch | Seeding tests weak: `> 60` category count, `.get()` actor check, `applySeed` not asserted to seed or to be idempotent. |
| medium | defer | Cascades touch rows the actor cannot see: a shared payee delete soft-deletes the owner's scoped aliases, a category delete clears scoped payees' defaults. |
| low | defer | Deleted categories, tags and activities cannot be resolved by name (live-only `find`/`list`) and tag/activity delete has no in-use rule. |
| low | defer | Alias regex only compile-checked and length-capped (ReDoS), names case-sensitive, no-op updates audit, uniqueness checked by scanning visible rows and racy to a raw UNIQUE error. |
| low | defer | `scopeFor` throws a plain Error for a private account without exactly one owner; `seedClassifyDefaults` commits before later seed steps. |
| low | defer | Memory mirror parity: payee update FK order, activity date-order CHECK; HTTP tests miss partner by-id for aliases and activities and the audit rows. |
| low | defer | Route hygiene: `/payees/aliases` before `/payees/:id`, `Cache-Control` repeated per handler, no GET by id for groups, categories and tax categories. |
| low | defer | Tax category labels (D15, RENTAL code) not taken verbatim from a source. |
| false | reject | Alias scope "same as payee" claim, "views.ts" missing, plan file stale, `as never` test casts: not defects against the plan. |

## Design Notes

`scopeFor(tx, viewer, originAccountId)` is the one place scope is derived: it finds the account through `tx.accounts.findVisible`, reads its sole owner for a private account, and returns `{ scopePersonId, origin }`.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green (known unrelated failures: `deploy/install.test.ts` x2, `backup.test.ts` restic timeout)
- `pnpm check:strict` -- expected: green

