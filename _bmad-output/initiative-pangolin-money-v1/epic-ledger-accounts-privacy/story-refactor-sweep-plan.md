---
title: 'Refactor sweep'
type: 'refactor'
ticket: '11'
created: '2026-10-05'
status: 'built'
baseline_revision: '530e426597acf4856485c2840e0352b740bf1832'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The epic's build left cleanups its reviews named: repeated route boilerplate, a type-erasing `objectBody`, dead repo methods, duplicated validators and loose test casts. They are small, but they make later stories harder to change safely.

**Approach:** Clean up a bounded list of those findings with no change in behaviour, one traceable change per commit-sized step, with lint, types and the full suite green after each.

## Boundaries & Constraints

**Always:** Cleanup only: behaviour, responses, error messages and HTTP statuses stay the same unless a Decision below says otherwise. Every change traces to a named deferred finding or build record of this epic (list the source in the Implementation Notes as each is done). In scope: (1) replace the per-handler `Cache-Control: no-store` in `apps/server/src/http/app.ts` with one `/api/*` middleware, keeping the header tests; (2) make `objectBody` stop returning `never` and remove the `as never` route casts (`app.ts` around the split PATCH, `recordBalanceSnapshot` and others), letting the use-case Zod schemas remain the check; (4) remove the unused `TagRepo.detach` and the unchecked `tags.attach` from the port, `classify-repos.ts`, the memory mirror and the parity test; (5) share the field schemas (description, notes, postedOn) between `create-transaction.ts` and `update-transaction.ts` with identical messages; (9, casts only) remove the `as never` casts in the privacy harness and tests, `admin/seed.ts` and the two production casts in `ledger-repos.ts`, and add the two small named tests (partner by-id on aliases and activities over HTTP; repo tests for `update`, `replaceOwners`, `hasSharedSplit`); (12) share one validator between `tools/seed/src/world.ts` and `checkReferences`, and document `PANGOLIN_ENABLE_SEED` in an env reference; (13) put the Biome read-rule group in one place. Also in scope (decided): (3) drop the duplicate top-level `remainingCents` from the `PUT /api/ledger/transactions/:id/splits` response, keeping the one inside `transaction`; (7) make `scopeFor` and `poolOf` throw a typed `AppError` instead of a plain `Error` on corrupt data, accepting the HTTP status change for that case; and the larger bundle (8) the memory-mirror parity gaps (CHECK parity for status, posted_on, kind, match_kind, source and matched_by, soft-deleted accounts in `balanceAsOf`, `replaceOwners` validation and owner order, payee update FK order, activity date CHECK, `replaceSplits` id-collision parity, same-day snapshot tie-break and soft-deleted transactions in the parity scenario) and (11) moving `./testing/memory-uow` out of the public package exports (parity tests move beside it or into a testing package, with the boundary lint adjusted). Run lint, types and the full suite after each item.

**Never:** No behaviour or product decisions (cascades, audit fail-closed, ReDoS, case-insensitive names, pagination, deletion rules, the seed's up-front checks), nothing that belongs to another epic (import fingerprinting, workspace pages), no route renames, no new routes, no migration. The `needs-review.ts` side-effect import stays as is (its own story before the import epic).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Behaviour parity | Any existing route or use case | Same responses and statuses as before | No change |
| Header | Any `/api` response | `Cache-Control: no-store` present, from the one middleware | No change |
| Typed body | A route that passes its body to a use case | The call is type-checked; a malformed body is still the same 400 | No change |
| Dead methods | `TagRepo.detach` and unchecked `attach` | Gone from every adapter; nothing else referenced them | Build fails if one did |
| Shared schemas | Create and update with the same bad field | Identical error message | No change |
| Privacy suite | The route manifest and leak group | Still green and still detecting leaks | No change |

</frozen-after-approval>

## Code Map

- `apps/server/src/http/app.ts` -- `no-store` per handler (about 70), `objectBody`, casts near :262, :339, :446.
- `packages/app/src/ports/unit-of-work.ts` (~655), `packages/db/src/classify-repos.ts` (~260), `packages/app/src/testing/memory-uow.ts` (~1460), `classification-repos.test.ts` (~492) -- `TagRepo.detach` and `attach`.
- `packages/app/src/ledger/{create,update}-transaction.ts` -- duplicated description, notes and postedOn rules.
- `apps/server/src/privacy/{privacy-harness.ts,privacy.test.ts}`, `apps/server/src/admin/seed.ts` (~517), `packages/db/src/ledger-repos.ts` (~342, ~354) -- `as never` casts.
- `tools/seed/src/world.ts`, `apps/server/src/admin/seed.ts` (`checkReferences`), `README.md` or an env reference -- validator and env docs.
- `biome.json` -- the read-rule restriction group repeated four times.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the source of each item; mark done items.

## Tasks & Acceptance

**Execution:**
- [ ] one step per in-scope item above, each traced to its finding, lint, types and the full suite green after each
- [ ] after the sweep, mark each completed deferred entry in `deferred-work.md` as done with the commit reference

**Acceptance Criteria:**
- Given the sweep is done, when lint, typecheck and the full suite run, then they pass with the same tests passing as before plus the added ones.
- Given any change in the sweep, when its trace is read, then it names a deferred finding or build record of this epic.

## Implementation Notes

One commit per step on `story-2-11-refactor-sweep`; each traces to an entry in `deferred-work.md` (marked there with its commit).

- (1)(2)(3) `0a21509`: one `/api/*` no-store middleware; `objectBody` is generic and the two non-trivial routes use `jsonObject` plus `asInput`, no `as never`; the replace-splits reply carries `remainingCents` once, inside `transaction`. Sources: tidy classify routes, tidy the accounts API, `tags.attach` / `objectBody` / `remainingCents` entry.
- (4) `64bc96b`: `TagRepo.attach` and `detach` removed from the port, SQLite, memory and the parity scenario (which now sets tags with `replaceForSplit`). Source: the `tags.attach` entry.
- (5) `88f0c6c`: `ledger/fields.ts` shares the description, date and notes schemas, with a test for identical messages. Source: tidy ledger writes.
- (9) `6b5a70c`: `as never` removed from the privacy harness and tests, `admin/seed.ts` and `ledger-repos.ts` (the seed's person IDs are typed as `PersonViewer["personId"]`); partner by-id tests for aliases and activities; repo tests for `update`, `replaceOwners` and `hasSharedSplit`. Sources: strengthen the privacy suite, tidy classify routes.
- (12) `feb3571`: `@pangolin/shared/seed` holds `checkSeedReferences`, used by `tools/seed/src/world.ts` and the server's `checkReferences` (through `@pangolin/app`, because the server may not import shared). The generator's error text changed to the loader's wording. `PANGOLIN_ENABLE_SEED` is in the README's new seed settings table. Source: tidy the seed.
- (13) `014ee77`, `f38e748`: the read rule is `tools/lint/no-ledger-schema-read.grit`, applied by one biome override; `scripts/biome-restrictions.test.ts` proves where it applies. Source: the privacy-core read-rule entry.
- (7) `bc64d1a`: `scopeFor` and `poolOf` throw `AppError` `Conflict` (HTTP 409) on an ownerless account instead of a plain `Error` (500). Sources: harden classify inputs, harden account inputs.
- (8) `a4d38bc`: memory unit of work mirrors CHECKs for transaction status and posted_on, institution kind, balance snapshot source and as_of, transfer group matched_by, account type and owner share; owners validation and order; `replaceSplits` id collision; payee, alias and activity update order (a row that is not matched is never checked; UNIQUE before FK); `check()` before references. The parity scenario covers each, plus same-day snapshot tie-breaks, soft-deleted transactions and a soft-deleted account. Not done: the "activity date CHECK", because SQLite has no such CHECK (the rule is in the use case; adding one is a migration). Sources: memory-mirror entries (CHECK parity, accounts gaps, classify routes, split writes).
- (11) `6d45715`: `./testing/memory-uow` is no longer exported; the parity tests are `packages/app/src/testing/{repo,accounts}-parity.test.ts`. They import `@pangolin/db`, which `scripts/check-boundaries.ts` allows for app test files only (`testOnly`); the link is the repo root's devDependency, because a `packages/app` dependency on `packages/db` is a cycle that makes `pnpm -r` fail. Source: stop exporting memory-uow.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 3 medium and 3 low patches; 6 deferred; 5 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | The read-rule plugin override covers `apps/`, `packages/`, `tools/` only; the old restriction also covered `e2e/` and `scripts/`, and the test dropped those cases (blind, edge-case; two reviewers, confirmed in the diff). |
| medium | patch | The Grit plugin matches only static imports; re-exports, `import type`, dynamic `import()` and `require` that the old rule caught are not matched. |
| medium | patch | The `/api/*` no-store middleware sets the header before `next()`; Hono drops it for the raw `Response` the `/api/auth/*` passthrough returns (reproduced against the repo's hono), contrary to the plan's "any /api response". |
| low | patch | `checkReferences` lost its exhaustiveness (`default: break`); `seed-references.test.ts` misbinds `publicOrigin` and leaves several moved rules without tests; the accounts parity test cannot tell which call threw and leaks its temp db on failure. |
| low | defer | `world.ts` rebuilds `SeedKnown` for every event (quadratic in events), and the generator is stricter and words errors differently than before. |
| low | defer | `objectBody<T>` is a typed cast, so the Zod schema is still the only check; the deferred-work wording says "typed instead of never". |
| low | defer | `@pangolin/db` is a root devDependency for `packages/app` tests (pnpm task cycle), so resolution relies on the root links; `testOnly` covers `*.test.ts` only. The container job will confirm the Docker install. |
| low | defer | Memory mirror parity gaps not yet tracked: per-row (not per-list) CHECK, UNIQUE and FK ordering in `insert` and `replaceSplits`, non-integer `shareBp`, account insert id reuse, date and currency formats. |
| low | defer | `as never` remains in `seed.test.ts`, `demo.test.ts` and app use-case tests outside the plan's list; the SeedKnown type carries unused `grouped` and `hidden` flags. |
| false | reject | The `setSplits` response drops its duplicate `remainingCents` with no changelog: decided in the plan, no consumer found in `apps`, `e2e` or docs. |
| false | reject | 500 to 409 on corrupt data and `no-store` on error and previously unmarked responses: accepted decisions, widening only. |
| false | reject | Commit hashes in `deferred-work.md` go stale: the merge is a no-fast-forward merge, so the commits stay in history. |
| false | reject | README claims about CI and compose, plan file stale, scope beyond the five named classes (decided option (b)). |

## Design Notes

The route-level privacy suite (story 2.10) is the safety net for the `app.ts` changes: it covers every route and must stay green.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green
- `pnpm check:strict` -- expected: green

