---
title: 'Transfer matching and probable duplicate detection'
type: 'feature'
ticket: 5
created: '2026-10-21'
baseline_revision: 'ae886895bf542c1315f033f40d42908c7ced5dc9'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/import-pipeline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An import commits both legs of a move between our own accounts as unrelated income and spending, and a transaction that already exists under a shifted date or a different export can be committed a second time.

**Approach:** After an import commits its new rows, a pure matcher pairs each new transaction with an opposite-amount transaction in another visible account within ±3 days: a unique match is linked as a `transfer_group` (`matched_by = auto`), an ambiguous one raises a review item. Rows that look like an existing transaction in the same account are committed but flagged for review, never silently.

## Boundaries & Constraints

**Always:**
- Match only unlinked, live transactions the importing viewer can see (`findVisible` semantics, AD-3); a partner's private account is never a candidate.
- A pair is unique only when the new transaction has exactly one candidate AND that candidate has exactly one opposing counterpart among unlinked visible transactions within ±3 days. Run matching as one pass after all rows of the batch are committed, so batch siblings count.
- Skip a candidate whose account is closed before its date (`requireOpenOn` would throw); never abort the import over a link.
- Link through `transferGroups.insert` + `transactions.setTransferGroup`, audit each side as `update` with its `accountId` (as `createTransferGroup` does).
- Probable duplicate = same account, same `amountCents`, equal normalised description, `postedOn` differing by 1–3 days, candidate live and not already claimed by an exact duplicate in this file, and not both rows carrying distinct `externalId`s. Same-day identical rows stay governed by occurrence counts.
- Detection is idempotent: re-import adds nothing, raises nothing (review `dedupeKey`s are open-item unique).

**Never:**
- No description heuristic for transfers (the ticket's rule is amount, account, ±3 days); no UI, rule-based (`matched_by = rule`) matching, or LLM suggestions.
- No review item for an auto-linked unique match.
- No change to fingerprint/external-id dedupe, migrations, or set-aside flow.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unique transfer | Import −500.00 in A; one unlinked +500.00 in B 2 days earlier | Both linked in one `transfer_group`, `matched_by = auto` | No error |
| Reverse import | +500.00 in B already linked-free; later import of −500.00 in A | Linked when A is imported | No error |
| Ambiguous | Two +500.00 candidates in B/C, or two −500.00 rows both fit one +500.00 | No link; `import.transfer_ambiguous` item per new txn | No error |
| Out of window | Opposite amount 4 days apart | Not matched | No error |
| Probable duplicate | Existing −4.50 CAFE on 03-02, new −4.50 CAFE on 03-03, no exact twin in file | Committed; `import.probable_duplicate` item on the txn, `needsReview` true | No error |
| Genuine consecutive coffees | Statement contains both 03-02 and 03-03 −4.50 CAFE (existing 03-02 is an exact duplicate) | No flag | No error |
| Same-day twins | Two −4.50 CAFE same day | Both commit, no flag | No error |
| Closed account | Sole candidate is in an account closed before its date | Candidate ignored | No error |
| Re-import | Same file again | Zero rows, zero links, zero items | No error |

</frozen-after-approval>

## Code Map

- `packages/domain/src/transfers/match-transfers.ts` -- new pure `findTransferMatch` / `isProbableDuplicate`: ±3 day window, uniqueness both ways, duplicate predicate.
- `packages/domain/src/index.ts` -- export the above.
- `packages/app/src/ports/unit-of-work.ts` -- add `TransactionRepo.listTransferCandidates(viewer, { excludeAccountId?, amountCents, from, to })` (unlinked, live, visible, opposite amount) and `listNearDuplicates(accountId, amountCents, from, to)` (live, same account); expose both in `ReadRepos` pick only if needed (write path only).
- `packages/db/src/ledger-repos.ts` -- SQLite implementations beside `listForDedupe` (~line 760); reuse `visibleAccounts(viewer)` and `isNull(deletedAt)`; keep date params bounded.
- `packages/app/src/testing/memory-uow.ts` -- in-memory versions beside `listForDedupe` (~line 1504).
- `packages/app/src/imports/match-transfers.ts` -- new: review kinds `IMPORT_TRANSFER_AMBIGUOUS_REVIEW` / `IMPORT_PROBABLE_DUPLICATE_REVIEW` (`import.*`, module `imports`, account scope), `matchTransfersForBatch(tx, audit, ctx, newTxns)` linking pattern from `ledger/transfer-groups.ts`, and `keepProbableDuplicate` / `dismissTransferAmbiguity` / `removeProbableDuplicate` (soft-delete via `deleteTransaction`, which already resolves open items) use cases.
- `packages/app/src/imports/import-statement.ts` -- in the commit loop (~line 1090) detect probable duplicates before insert and raise the item with `transactionEntityRef`; after the loop call `matchTransfersForBatch`.
- `packages/app/src/imports/set-aside.ts` -- `fixSetAsideRow` commits one row; run the same two checks for it.
- `packages/app/src/index.ts` -- export kinds and use cases.
- Reuse, don't change: `ledger/transfer-groups.ts`, `system/review-items.ts` (`raiseReviewItem`, `resolveReviewItem`), `ledger/needs-review.ts`, `closed-lock.ts` (`requireOpenOn`).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/domain/src/transfers/match-transfers.ts` + `packages/domain/src/index.ts` -- pure window/uniqueness/duplicate predicates with unit tests -- keeps rules testable without a database.
- [ ] `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/ledger-repos.ts`, `packages/app/src/testing/memory-uow.ts` -- candidate queries -- visibility enforced in the repo.
- [ ] `packages/app/src/imports/match-transfers.ts` -- kinds, batch matcher, resolution use cases -- the pipeline's stage 6.
- [ ] `packages/app/src/imports/import-statement.ts`, `packages/app/src/imports/set-aside.ts`, `packages/app/src/index.ts` -- wire detection and exports.
- [ ] `packages/app/src/imports/match-transfers.test.ts` -- one test per I/O row, plus partner-private invisibility and a SQLite-backed run of the repo queries.

**Acceptance Criteria:**
- Given two accounts with opposite amounts within ±3 days, when the second is imported, then both transactions share a `transfer_group` with `matched_by = auto` and the group is audited.
- Given an ambiguous match, when the import finishes, then nothing is linked and each affected new transaction has an open `import.transfer_ambiguous` item.
- Given a probable duplicate, when imported, then the transaction exists with an open `import.probable_duplicate` item, and resolving it (keep or remove) clears `needsReview`.
- Given the same file imported twice, then the second run creates no rows, links or review items.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Verdicts: 1 medium, 2 low (patch/reject), 4 medium/low deferred or rejected, rest false.

- `set-aside.ts` fixSetAsideRow matching/flagging -- verdict: medium -- route: patch -- no test drives the new calls; add a transfer-link and a probable-duplicate case through `fixSetAsideRow`.
- keep/remove tests -- verdict: medium -- route: patch -- acceptance says resolving clears `needsReview`; tests assert only open-item count.
- `fixSetAsideRow` passes empty claimed set (blind, edge, gap) -- verdict: low -- route: reject -- extra review flag only, and fix needs batch context the function lacks.
- Closed new-leg account and system viewer untested -- verdict: low -- route: reject -- `visibleAccounts` handles system viewer; skip is guarded in code.
- Currency not compared -- verdict: low -- route: defer -- v1 is single-currency AUD; adding currency to the candidate row widens the port.
- Stale `import.transfer_ambiguous` after later link or disambiguation -- verdict: medium -- route: defer -- not re-evaluated; user can dismiss; needs a re-evaluation design.
- Private-to-shared auto-link visible to partner (blind) -- verdict: false -- `createTransferGroup` already allows it and `members()` reports `hidden` rather than leaking.
- `dayKey` shadowing / key-format mismatch (blind) -- verdict: false -- local `dayKey` consts are block-scoped, formats are identical, biome and tsc are clean.
- fileDayKeys includes set-aside or same-file siblings (edge, intent) -- verdict: false -- `parsedRows` excludes set-aside rows; claiming by same-file siblings is the intended consecutive-coffee exemption.
- removeProbableDuplicate read-then-write, linked removal (blind, edge) -- verdict: false -- `deleteTransaction` rechecks and unlinks survivors; race is negligible.
- `linkAuto` throws on count != 2 (edge) -- verdict: false -- invariant violation, same as `createTransferGroup`.
- `isProbableDuplicate` equal externalIds (blind) -- verdict: false -- equal IDs are caught by external-id dedupe first.
- Per-row query volume, Temporal vs Date.UTC, openedOn (blind) -- verdict: low -- route: reject -- negligible, fix adds complexity.
- No API/UI entry point; `listNearDuplicates` without viewer (blind, intent, edge) -- verdict: false -- UI is entry 3.8; port matches `listForDedupe`.
- Plan "Never: set-aside flow" vs set-aside edit (blind) -- verdict: low -- route: reject -- fix edits the plan; Code Map explicitly includes `set-aside.ts`.

## Design Notes

Uniqueness is checked from both ends so the outcome does not depend on row order:

```
candidates(new) = unlinked, other account, amount = -new.amount, |Δdays| ≤ 3
link iff |candidates(new)| = 1 and |candidates(that one)| = 1
```

The ticket says nothing on confirming auto-links, and the spec's "newly matched" review wording is superseded by its "unique match is linked automatically"; users undo with `deleteTransferGroup`.

## Verification

**Commands:**
- `npx vitest run packages/domain packages/app/src/imports` -- expected: all pass.
- `pnpm typecheck` -- expected: no errors.
- `pnpm lint` -- expected: biome and boundary check clean.
