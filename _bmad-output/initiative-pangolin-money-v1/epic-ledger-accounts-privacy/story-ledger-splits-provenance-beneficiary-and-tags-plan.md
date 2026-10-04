---
title: 'Ledger: splits, provenance, beneficiary and tags'
type: 'feature'
ticket: '13'
created: '2026-10-04'
status: 'built'
baseline_revision: '6ecdf2c75403edc909260e1c2d09631d9d1b52ec'
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

**Problem:** A transaction has one split and nothing replaces splits, sets a split's category, activity, tax category or beneficiary with a record of where the value came from, or tags a split. Multi-split amounts cannot be edited at all.

**Approach:** Add a replace-splits use case with the sum invariant and a server-returned remaining amount, a `setSplitField` use case with per-field provenance, a split tags use case, and API routes.

## Boundaries & Constraints

**Always:** Split amounts are signed integers that sum exactly to the transaction amount, with at least one split and at most 50; the server computes `remainingCents = transaction amount - sum of splits` and returns it on every transaction read (get and list) and on the replace response. A failing replace is `Validation` with `details: { remainingCents }` and writes nothing. Replace takes `{ splits: [{ id?, amountCents, categoryId?, activityId?, beneficiary?, taxCategoryId?, deductibleBp?, memo?, propertyId? }] }`; a supplied `id` updates in place and keeps its provenance and tags, a missing `id` mints a new split, omitted existing splits are deleted together with their `split_tag` rows (AD-10). Provenance is stored as per-field text columns on `split` (migration 0010): `category_source`, `activity_source`, `tax_category_source`, `beneficiary_source`, `deductible_bp_source`, each NULL or one of `user`, `rule`, `payee`, `activity`, `llm` (CHECK); NULL means unset, so any source may write; existing rows stay NULL. Precedence: user 5 > rule 4 > payee 3 > activity 2 > llm 1; a write succeeds when the new rank is at least the current rank (a user re-edit works); `source: user` with `value: null` clears the field and records the clear so rules do not refill it; beneficiary cannot be cleared. A write that changes only the source (a rank upgrade) counts as a change and is audited. `setSplitField` fields are category, activity, tax category, beneficiary and deductible_bp; memo and property are plain fields set through replace and carry no provenance; `payee_id` stays on the transaction and is outside `setSplitField` (the AD-10 mismatch is noted). HTTP forces `source: user` and rejects a client-supplied source; rule, payee, activity and llm sources are internal use-case inputs only. Targets are validated by viewer: a missing, deleted or other-scope category, activity or tag is `NotFound`. Beneficiary is `shared` or an existing person id; any viewer who can see the transaction may set it; in a private account it is the account owner, filled in when omitted. Tags on a split are replaced as a whole set, are scope-checked by `tags.find(viewer, id)` (a partner's scoped tag is `NotFound`), a deleted tag is not attachable, and a shared tag may go on a private split; this closes the deferred item that `tags.attach` has no viewer check. Every write is audited as an `update` of the transaction with `accountId`, with before and after snapshots including splits, their sources and tag ids. The transaction view exposes tags per split through one batch read. `updateTransaction` keeps refusing a multi-split amount change. The memory unit of work mirrors every new repo method with parity tests, and the DB gets CHECKs for the source and beneficiary columns.

**Decisions:** A lower-ranked source writing over a higher-ranked value is a no-op returning `{ applied: false, reason }`. A zero-amount split is allowed only when the transaction itself is 0. A private account with an explicit beneficiary that is not the owner is refused with `Validation`. An owner-scoped tag on a split in a public account is refused with `Conflict` until promotion exists.

**Never:** No suggestions, rules, payee defaults or LLM writers (epic-import-dedupe-transfers and later; leave a hook for closing open suggestions), no tag promotion to shared, no split UI, no change to hiding or transfer groups (story 2.7), no tag or activity delete rule.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Replace, sum matches | Splits sum to the transaction amount | Splits replaced, ids stable, `remainingCents` 0 | No error expected |
| Replace, sum short | Splits sum to less or more | Nothing written | Validation with `remainingCents` |
| Replace drops a split | Omitted existing split | Split and its `split_tag` rows removed | No error expected |
| Provenance up | User sets category over a rule value | Applied, source `user` | No error expected |
| Provenance down | Rule sets category over a user value | `{ applied: false, reason }`, nothing changes | No error expected |
| User clear | `value: null`, source user | Field NULL, source `user` | No error expected |
| Private account | Replace with another person's beneficiary | Refused, nothing written | Validation |
| Private account default | Beneficiary omitted | Owner filled in | No error expected |
| Zero amount | A 0-amount split | Allowed only in a 0-amount transaction | Validation otherwise |
| Tag, partner's scoped | Partner tag id on a split | Not found | NotFound |
| Tag, owner-scoped on public | Owner's scoped tag on a split in a public account | Refused, nothing written | Conflict |
| Partner's private row | Any new route | 404 | NotFound |
| Demo mode | Any write | Refused | 409 |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/split.ts`, `migrations/0010_*.sql`, `meta/0010_snapshot.json`, `_journal.json` -- source columns and CHECKs (generate with drizzle-kit, add named CHECKs); `migrate.test.ts` counts.
- `packages/app/src/ports/unit-of-work.ts` -- `SplitRow` gains sources; `TransactionRepo.replaceSplits`, `updateSplit`; `TagRepo.detach`, `replaceForSplit`, batch `listForSplits`.
- `packages/db/src/ledger-repos.ts` (`splitColumns`, `withSplits`), `classify-repos.ts`, `unit-of-work.ts`, `testing/memory-uow.ts` -- implement and mirror.
- `packages/app/src/ledger/` (new) -- `set-splits.ts`, `set-split-field.ts`, `split-tags.ts`, `provenance.ts`; extend `transaction-view.ts` (`remainingCents`, tags per split), `list-transactions.ts`, `get-transaction.ts`; export from `packages/app/src/index.ts`.
- `packages/app/src/ledger/update-transaction.ts` -- keep the multi-split refusal; point its message at the replace route.
- `apps/server/src/http/app.ts` -- `PUT /api/ledger/transactions/:id/splits`, `PATCH /api/ledger/transactions/:id/splits/:splitId` (`{ field, value }`), `PUT /api/ledger/transactions/:id/splits/:splitId/tags` (`{ tagIds }`); `writable()`, no-store, `objectBody`; `errors.ts` carries `details` for Validation.
- Tests: `packages/app/src/ledger/ledger.test.ts`, `packages/db/src/ledger-repos.test.ts` and `classification-repos.test.ts` (parity), `apps/server/src/http/app.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] migration 0010, schema, ports, repos, memory mirror, parity tests
- [ ] `provenance.ts`, `set-splits.ts`, `set-split-field.ts`, `split-tags.ts` with unit tests per matrix row
- [ ] view changes: `remainingCents` and tags per split
- [ ] routes and API tests (partner 404, demo 409, forced user source, Validation details)
- [ ] audit tests: every write carries `accountId` and before/after splits

**Acceptance Criteria:**
- Given splits that do not sum to the transaction amount, when they are replaced, then nothing is written and the response carries `remainingCents`.
- Given a user-set category, when a rule source writes the field, then the user value stays.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 3 medium and 4 low patches; 12 deferred; 5 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | `setSplits` revalidates category, activity and tax category for unchanged splits, so a split whose category was later soft-deleted blocks every other edit. |
| medium | patch | `replaceForSplit` drops tags the viewer cannot see (scoped or deleted), e.g. an owner's scoped tags left after `setPrivacy` flips an account public. |
| low | patch | An explicit `null` on an already-unset field in `setSplits` does not record the user clear that `setSplitField` records. |
| medium | patch | The `registerSplitFieldListener` hook is untested, has no unregister, and its rollback and no-fire cases are unpinned (verification-gap, pre-verified). |
| low | patch | `listForSplits` 400-id chunking untested; migration 0010 upgrade test seeds no `split_tag` row; HTTP gaps for list `remainingCents` and tags, beneficiary PATCH, and 400/409 status mapping. |
| medium | defer | The suggestion-closing listener fires only from `setSplitField`, not from `setSplits` edits. |
| low | defer | A lower-ranked source writing a deleted or invalid target throws before the rank check instead of returning `applied: false`. |
| low | defer | Non-sum Validation errors in `setSplits` carry `remainingCents`; amounts near `MAX_SAFE_INTEGER` could pass the sum check; `sameSplit` compares by key order. |
| low | defer | Memory `replaceSplits` id-collision parity; updating a private-account split whose stored beneficiary is not the owner with beneficiary omitted. |
| low | defer | `TagRepo.detach` has no caller; `tags.attach` itself still has no viewer check (only `setSplitTags` does); create, update and delete audit snapshots carry no tag ids. |
| low | defer | PATCH route spreads its body with `as never` and `PUT /splits` returns `remainingCents` twice. |
| false | reject | Migration 0010 drops `split` under foreign keys and fails on empty beneficiary rows: the runner turns foreign keys off for migrations and `beneficiary` is never empty. |
| false | reject | Existing rows need provenance backfill (the plan accepts NULL), stale plan file, test file name differs from the Code Map. |

## Design Notes

Provenance on `split` columns rather than a side table: the audit snapshot carries them for free and the memory mirror stays trivial. AD-10 lists `payee_id` as a classified field, but it lives on `transaction` here, so payee provenance waits for the story that classifies payees.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green (known unrelated failures: `deploy/install.test.ts` x2, `backup.test.ts` restic timeout)
- `pnpm check:strict && pnpm --filter @pangolin/db db:generate` -- expected: green, no schema drift

