---
title: 'Server-side privacy suite'
type: 'feature'
ticket: '10'
created: '2026-10-05'
status: 'built'
baseline_revision: '06a5288e1266831bc42c40e38b0fa9256c6b79e1'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Privacy is tested piece by piece, but nothing proves across the whole API that partner B cannot learn anything from partner A's private data, and nothing fails when a new route ships without a privacy check.

**Approach:** Add a suite, run in CI, that derives every registered route from the Hono app, requires each to have a manifest entry, and for each checks that B's responses are byte-identical when only A's private data changes, that A's private ids are `NotFound` for reads and writes, and that hidden names lift on the test clock; review items are covered through `visibleReviewItems` and `redact()`; and the suite fails on a deliberate leak.

## Boundaries & Constraints

**Always:** The route set comes from `createApp(deps).routes` (drop the `ALL` middleware entries and non-`/api` routes; expand `app.on` methods), and the manifest must match it in both directions: a route without an entry fails, and so does a stale entry. Each manifest entry is `person` (with its id params and entities, read or write), `system`, `identity` or `exempt` with a written reason. Two worlds W1 and W2 are built from the same seed, the same deterministic id generator state and the same clock, differing only in A's private delta (applied last, through the use cases): extra, renamed, closed and deleted private accounts, their transactions and splits, owner-scoped tags, payees, aliases and activities, snapshots, account-scoped review items, and audit rows. For every `GET` route that returns person data, B's status and body text must be equal as strings in W1 and W2; B's writes that collide with names (a payee, tag or account) must behave the same in both worlds. For every manifest route taking an id, B calling it with an id of A's private data (account, transaction, split, snapshot, scoped payee, tag, alias, activity, transfer group, and creates naming A's account as `accountId` or `originAccountId`) gets 404 with a body byte-identical to the 404 for a well-formed nonexistent id, and A's rows are unchanged afterwards. Hidden names: A hides a shared-account transaction on the test clock; B sees "Hidden until <date>" and no real text until the day before the hide-until date, and the real name on that date (12 months at most, re-hiding restarts the clock). Review items: at use-case level, B's `redact(listReviewItems)` is identical in both worlds for account, person and household scopes. Every audit row written for an account-scoped entity carries an `accountId`; the suite fails otherwise. The suite also runs a "deliberate leak" group: with a test-only wrapper that drops `visibleAccounts` from a list, returns an A-private id's data, or makes `redact` the identity, the same assertion function must report a failure for each class (list leak, by-id leak, hidden-name leak). The suite lives in `apps/server/src/privacy/` (`route-manifest.ts`, `privacy-harness.ts`, `privacy.test.ts`) and runs under the existing `pnpm test` in CI. Where the suite demonstrates a real leak of private data, it is fixed in this story.

**Decisions:** Each leak the suite demonstrates (for example an A-scoped payee id on a shared transaction, a deleted private account's rows in `visibleTxn`, an audit row with no `accountId`) is fixed in this story, with a test. The cross-scope cascades and ownership gaps (a shared payee delete soft-deleting A's scoped aliases, a category delete clearing A's scoped payee defaults, a partner deleting a transfer group with a private counterpart, hiding a name without an ownership check) are documented as manifest exemptions with written reasons until a product decision is made. The manifest has a `pending` entry kind so epic-ledger-workspace's search, export and audit routes cannot ship without a privacy entry.

**Never:** No search, export or audit API (epic-ledger-workspace), no change to privacy rules beyond closing demonstrated leaks, no UI, no change to the better-auth routes beyond manifest entries.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New route | A route registered with no manifest entry | Suite fails naming the route | CI failure |
| Stale entry | Manifest entry with no route | Suite fails | CI failure |
| Byte-identical | A's private data differs between W1 and W2 | B's GET responses are equal strings | Difference fails the suite |
| A's id, read | B reads an A-private id | 404, same body as a nonexistent id | NotFound |
| A's id, write | B writes with an A-private id | 404, A's rows unchanged | NotFound |
| Name collision | B creates a name A's scoped row holds | Same response in both worlds | No error expected |
| Hidden name | A hides, clock before the lift date | B sees "Hidden until <date>" | No error expected |
| Lift day | Clock on the hide-until date | B sees the real name | No error expected |
| Review items | Items on A's private account and person scope | B's redacted list equal in both worlds | No error expected |
| Audit | Account-scoped entity write | Audit row carries `accountId` | Suite fails if not |
| Deliberate leak | Wrapper injects a leak | Assertion reports failure | Suite passes only when it detects it |

</frozen-after-approval>

## Code Map

- `apps/server/src/http/app.ts` -- `createApp`/`createApi` and `app.routes`; routes listed: system (4 GET), identity (2 GET, 9 POST), better-auth `/api/auth/*`, ledger transactions (list, create, get, patch, delete, splits, split field, split tags, name-hidden, transfer groups), accounts (institutions, accounts, close, privacy, balance, snapshots), classify (tags, payees, payee aliases, activities, category groups, categories, tax categories).
- `apps/server/src/http/app.test.ts` -- fake gateway with one session (`user-a`) and `deps()` with `fixedClockAt`; reuse the patterns, build a new harness with sessions for A and B, a mutable clock, a deterministic id generator.
- `apps/server/src/admin/seed.ts` (`applySeed`/`linkSeed`), `apps/server/scripts/demo-seed.ts` (`generateSeedFile`) -- load the seeded ledger (hidden names, transfer group with a private counterpart).
- `packages/db/src/privacy.test.ts`, `read-rule.test.ts` -- existing privacy tests and the "catches a deliberate direct read" pattern to mirror.
- `packages/db/src/review-item-repo.ts` (`visibleReviewItems`), `packages/app/src/system/review-items.ts`, `redact.ts`, `list-audit.ts` -- review item and audit use-case coverage.
- `.github/workflows/ci.yml`, `vitest.config.ts` -- `pnpm test` already runs `**/*.test.ts`; no change expected.

## Tasks & Acceptance

**Execution:**
- [ ] route manifest and the two-way route-set test
- [ ] harness: two signed-in partners, mutable clock, deterministic ids, seeded world builder with the A-private delta
- [ ] byte-identical, NotFound, collision, hidden-name and review-item tests
- [ ] audit `accountId` assertion
- [ ] deliberate-leak group proving the suite detects each class
- [ ] fix any real leak the suite demonstrates, with a test

**Acceptance Criteria:**
- Given a route added without a manifest entry, when the suite runs, then it fails naming the route.
- Given a deliberate leak injected into a list, a by-id read or `redact`, when the suite's assertions run, then each reports a failure.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 6 medium and 3 low patches; 5 deferred; 7 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | The NotFound probe aims A's id at slot 0 of an entity only (the second transaction of `POST /api/ledger/transfer-groups` never); `PATCH .../splits/:splitId` is never sent `field: "activity"` with A's activity id; A's scoped payee is never aimed at `POST /api/ledger/transactions` (verification-gap, pre-verified). |
| medium | patch | `apiRoutes` drops all `ALL` and non-`/api` routes, so an `app.all` handler or a data route outside `/api` needs no entry; `person` entries are not checked against their path params; `identity` entries need no reason; `PersonEntry.query` is dead. |
| medium | patch | The deliberate-leak group covers only the accounts and transactions repos, `redact-identity` never swaps `redact`, review items and audit assertions are never shown to fail, and the by-id leak runs reads only (verification-gap, edge-case). |
| low | patch | `probed` module state makes the coverage test order-dependent; audit check passes with zero rows of the named entities and `aliasGone` assertion is vacuous; collision cases never take names A holds; no explicit timeouts; overstated test title. |
| low | defer | Account-scoped review items on A's private account are not reachable through a notice id, so `notices/:id/dismiss` is never aimed at them. |
| low | defer | Hidden-name checks run in the base world only, not beside A's private delta; no time-of-day edge at the lift moment. |
| low | defer | Harness uses `as never` casts and raw `INSERT`s for logins; `system` and `identity` GETs are not replayed in the two-world comparison. |
| low | defer | No account-delete use case, so the delta soft-deletes an account with raw SQL and the delete path and its audit are unexercised. |
| low | defer | Only whole-day clock precision at the lift boundary. |
| false | reject | Responses are not byte-identical because minted id suffixes are masked: random ids minted by B's own requests are not a leak (AD-4 design note). |
| false | reject | Hard-coded dates drift: the seed's today is a fixed constant. |
| false | reject | Plan file stale, acceptance criteria shorter than the frozen intent, plan example leaks not fixed (none reachable). |

## Design Notes

Search, export and the audit API join the manifest in epic-ledger-workspace. The elimination residual (a partner can infer that a private account exists from a "Transfer from <owner>" label) is accepted by AD-4 and is not asserted away.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green
- `pnpm check:strict` -- expected: green

