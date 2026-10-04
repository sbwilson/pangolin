---
title: 'Tracer bullet: one account''s transactions, seen per viewer'
type: 'feature'
ticket: '1'
created: '2026-10-04'
status: 'built'
baseline_revision: '496e09e4d5b50b28951027ef3b698bae675c6599'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No ledger tables, privacy path or API exist, so nothing proves a partner sees a shared account and only their own private one.

**Approach:** Thinnest path through every layer: migration, `visibleAccounts`/`visibleTxn` (private-account rule only), `createAccount` and `createTransaction` use cases with audit, `GET /api/ledger/transactions`, a minimal list page, seed accounts, an admin `seed` command that links the seed's two people to the signed-up logins, and an e2e run per partner.

## Boundaries & Constraints

**Always:** STRICT tables, ULID text ids, integer `_cents`, `YYYY-MM-DD` dates, `created_at`/`updated_at`; later-entry columns nullable and omitted. Writes only in `app` use cases, audited in the same transaction with `accountId`. Visible = public accounts plus the viewer's own private ones; a non-owner addressing a private account gets `NotFound`. A private account's splits carry `beneficiary` = owner. Reads set `Cache-Control: no-store`. Follow existing package boundaries and the commit-msg hook.

**Decisions:** The `seed` command maps seed `person-a`/`person-b` onto the existing signed-up people by sign-up order and attaches the seed accounts to them (no new identity use case). It reads the existing `dist/demo-seed.json` (no path argument, no CI mount).

**Never:** Edit migrations 0000–0007, auth tables, `review_item`, existing CLI commands or the boundary map. No hidden-name nulling, `redact()`, lint rule, split-sum rule, editing or search (entries 2–5, epic-ledger-workspace). No FKs for `payee_id`, `category_id`, `property_id`, `tax_category_id`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shared account | Either partner lists transactions | Shared account's transactions returned | No error expected |
| Own private | Partner A lists | A's private account's transactions included | No error expected |
| Other's private | Partner B lists | A's private transactions absent | No error expected |
| No viewer | `visibleAccounts()` with no viewer | Throws | Programming error |
| Create on other's private | B creates a transaction in A's private account | `NotFound` | `AppError` NotFound |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/*.ts`, `schema/index.ts` -- add account, account_owner, transaction, split; core columns per data-model.md Tables.
- `packages/db/migrations/0008_*.sql`, `meta/0008_snapshot.json`, `_journal.json` -- via `pnpm --filter @pangolin/db db:generate`, then hand-add `) STRICT;` and drizzle-style named CHECKs (see `0002_jobs_review_items.sql`).
- `packages/db/src/migrate.test.ts` -- bump table count/names 8→9 migrations; grep other hard-coded counts.
- `packages/db/src/review-item-repo.ts` (+ test) -- repo pattern to copy; `unit-of-work.ts` wiring.
- `packages/app/src/ports/unit-of-work.ts`, `testing/memory-uow.ts` -- `TxRepos`/`ReadRepos` ports and the in-memory mirror.
- `packages/app/src/identity/create-person.ts` -- use-case shape (Zod `.strict()`, `write`, `ctx.newId`); new `accounts/create-account.ts`, `ledger/create-transaction.ts`, a list use case; export from `index.ts`.
- `apps/server/src/http/app.ts` -- add `.get("/api/ledger/transactions")`; tests in `http/app.test.ts`.
- `apps/web/src/App.tsx`, `api.ts` -- router, typed `hc` client; add a minimal ledger page.
- `tools/seed/src/world.ts`, `modules/index.ts`, `modules/people-and-household.ts` -- add account/transaction events and an accounts module (shared + private per `person-a`/`person-b`).
- `apps/server/src/admin/seed.ts`, `admin/commands.ts`, `admin/index.ts`, `cli.ts` -- `applySeed` loader and a new `seed` admin command (`systemViewer("cli:seed")`); keep demo mode (`demo.ts`) working.
- `e2e/auth.spec.ts`, `e2e/helpers/account.ts`, `.github/workflows/ci.yml` -- save both partners' credentials, run seed after sign-up, new ledger spec using `helpers/csp.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/db` -- schema, migration 0008, `visibleAccounts`/`visibleTxn`, account and transaction repos, tests -- data and privacy path
- [ ] `packages/app` -- ports, memory UoW, `createAccount`, `createTransaction`, list use case, unit tests incl. NotFound and audit -- business rules
- [ ] `apps/server` http route plus tests -- API
- [ ] `apps/web` list page -- minimal view
- [ ] `tools/seed`, `admin/seed.ts`, `seed` command, CLI -- seed and login linking
- [ ] `e2e` and CI -- per-partner sign-in check

**Acceptance Criteria:**
- Given the seeded ledger, when each partner signs in and opens the list, then they see the shared account's transactions and only their own private account's.
- Given migrations applied, when `pnpm check:strict`, `check:upgrade` and generate+`git diff --exit-code` run, then all pass.
- Given demo mode, when it loads the extended seed, then it still starts.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 2 medium, 1 low, 4 false, 12 deferred/rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | Conflict guard in `linkSeed` checks transactions only; accounts-without-transactions get duplicated on retry. Confirmed at `seed.ts:275`. |
| low | patch | "leaves the household settings alone" test cannot fail: household matches seed defaults (verification-gap, pre-verified). |
| medium | defer | `seed` not atomic, event schemas loose (`postedOn` string): partial ledger on a bad seed. Dev tool, seed is checked-in data. |
| medium | defer | `seed` command available on real installs; guarded by empty-ledger/two-partner checks. Plan decision names an admin `seed` command. |
| low | defer | `visibleTxn` ignores soft-deleted accounts; no soft-delete use case exists yet. |
| low | defer | DB enforces neither private-account one-owner rule nor `split.beneficiary`; use cases do. Epic entry 3 (privacy core). |
| low | defer | Unbounded list endpoint; no pagination. Epic-ledger-workspace. |
| low | defer | Audit rows carry private payloads with no `visibleAudit`; audit API is epic-ledger-workspace. |
| low | defer | UI hard-codes AUD, shows no account name or private marker. Minimal page by intent. |
| low | defer | e2e: API check only as first partner; seed not rerunnable on a reused stack; seed deactivated-person ordering; `linkSeed` not concurrency-safe; `events` count overstates; missing CHECK/owner-cap tests. |
| false | reject | Web query cache leaks across sign-in: `App.tsx:430` calls `queryClient.resetQueries()` on sign-out. |
| false | reject | Plan file stale / no doc update: plan edits are out of scope for a fix. |
| false | reject | "Later-entry columns omitted" vs nullable `payee_id` etc. present: plan's Never says no FKs, not no columns. |
| false | reject | Seed currency mismatch makes the command always fail: base currency defaults to AUD and the e2e run passed. |

## Design Notes

`visibleAccounts(viewer)` is a raw SQL fragment, like `visibleReviewItems`, throwing on an undefined viewer. Repo reads take the viewer first; Drizzle tables stay inside `packages/db`.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green
- `pnpm check:strict && pnpm check:upgrade` -- expected: green
- `pnpm e2e` -- expected: ledger spec passes for both partners
