---
title: 'Import respects the closed-account lock; private transfer candidates stay private'
type: 'bugfix'
ticket: ''
created: '2026-10-22'
baseline_revision: '4246e744398810e9dfcec744061bbaf22863681e'
status: done
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/epic-import-dedupe-transfers/epic-import-dedupe-transfers-retrospective.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two defects from the epic 3 retrospective. (F3) `importStatement` commits rows dated after a closed account's `closedOn`, although the epic's own handoff (2026-10-06) says an import must not; such rows then cannot be fixed or undone, because `fixSetAsideRow` and `undoImportBatch` enforce the lock. (F4) Transfer matching considers the importer's private accounts as candidates; when it finds an ambiguity for a transaction on a shared account it raises an account-scoped review item the partner can see, and the transaction's derived needs-review flag follows it, which tells the partner that a private opposite-amount transaction exists.

**Approach:** (F3) Rows dated after `closedOn` are set aside with a reason, like unreadable rows, so the person fixes them or discards them in Needs review, where the existing lock applies. (F4) When the ambiguity involves a candidate in a private account and the new transaction is on a shared account, raise the item for the importer alone, outside the transaction's needs-review flag, instead of an account-scoped one.

## Boundaries & Constraints

**Always:**
- F3: for a person viewer, a parsed row with `postedOn > account.closedOn` (closed date set) is staged as `set_aside` with reason `Dated after this account closed on <closedOn>` and is not committed, deduped or counted as new; rows on or before `closedOn` import as usual. The system viewer is exempt, as in `requireOpenOn`. The batch's first and last posted dates, reconcile (a file with set-aside rows records `unavailable`) and the derived opening snapshot use only the rows that are committed, and the snapshot never falls after `closedOn`.
- F4: an ambiguity is "private-involved" when the new transaction's account is shared and any candidate considered (the new leg's pool, or the counterpart pool of the single candidate) is in a private account. A private-involved ambiguity raises a new person-scoped review kind `import.transfer_ambiguous_private` (`personId` = the importer, entity `transfer_candidate:<transaction id>`, dedupe key `import.transfer_ambiguous_private:<transaction id>`), so no one else sees it and `transaction.needs_review` is unchanged. Every other ambiguity keeps the account-scoped `import.transfer_ambiguous` item.
- The importer's Needs review shows the new kind with the existing Transfer card and its actions (link a candidate, "not a transfer"); resolving either resolves the item, and a hidden or missing candidate is never named to another viewer.
- A partner's list, counts (including `countSharedVisibleOpen`) and transaction needs-review flag are byte-identical with and without the private candidate (a paired-world privacy test).

**Never:**
- No change to which transfers auto-link, to the closed-account rules for manual entry, or to the set-aside fix path; no new HTTP routes; no UI beyond mapping the new kind onto the existing card and label.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Import into a closed account | Account closed on 2026-06-30; file has rows on 06-29 and 07-02 | 06-29 commits; 07-02 is set aside with the reason; set-aside item raised | n/a |
| Fix a locked row | Fix the 07-02 row | `Conflict` from the lock (existing); person moves the date or reopens the account | existing |
| All rows locked | Every row after `closedOn` | Nothing commits; no opening snapshot | n/a |
| System viewer | Import as system | Not locked | n/a |
| Ambiguity, shared leg, private candidate | Two opposite-amount candidates, one in A's private account | Person-scoped item for the importer only; no account-scoped item; shared transaction not flagged | n/a |
| Ambiguity, all candidates shared | Two shared candidates | Account-scoped item as before | n/a |
| Ambiguity, private leg | New leg on A's private account | Account-scoped item (owner only anyway) | n/a |
| Partner views | Partner lists review, counts, transaction | Identical to a world without the private candidate | n/a |

</frozen-after-approval>

## Code Map

- `packages/app/src/imports/import-statement.ts` -- after parsing, before staging: split `parsedRows` into locked and open by `account.closedOn`; locked rows join `setAsideRows` with the reason; first/last dates and reconcile read the open rows.
- `packages/app/src/imports/match-transfers.ts` -- `matchTransfersForBatch`: decide private-involved from `tx.accounts` (`findVisible`, `isPrivate`) for the leg's account and the candidates' accounts; raise `IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW` (new `defineReviewKind`, scope `person`) or the existing kind; `dismissTransferAmbiguity` and the key helpers cover both kinds.
- `packages/app/src/system/review-view.ts`, `review-actions.ts`, `packages/app/src/index.ts` -- list the new kind beside `IMPORT_TRANSFER_AMBIGUOUS_REVIEW` (view detail resolves the transaction from `transfer_candidate:<id>`; actions accept either kind).
- `apps/web/src/components/review/ReviewCardView.tsx`, `ReviewCardFrame.tsx` -- map `import.transfer_ambiguous_private` to the Transfer card and the label "Possible transfer".
- Tests: `import-statement.test.ts` (closed-lock rows, all locked, system viewer, snapshot not after `closedOn`), `match-transfers.test.ts` (new kind raised, existing kind kept, link and dismiss resolve it), `review-view.test.ts`, `apps/server/src/privacy/privacy.test.ts` (paired-world: partner's reads and count identical), `ReviewPage.test.tsx` (card renders for the new kind).
- Reuse, don't change: `ledger/closed-lock.ts` (`requireOpenOn`), `system/review-items.ts`, `ledger/needs-review.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] F3 partition in `importStatement` with tests, including the opening snapshot and an all-locked file.
- [ ] F4 new kind, matcher branch, view/actions/web mapping, with tests.
- [ ] Paired-world privacy test for F4.

**Acceptance Criteria:**
- Given a closed account, when a file with later rows is imported, then those rows are set aside with the reason, nothing after `closedOn` is committed, and the rest imports.
- Given a private candidate for a shared leg, when the match is ambiguous, then only the importer gets an item, and the partner's list, count and flags are unchanged.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `dismissTransferAmbiguity` resolves the private item by dedupe key after only checking the transaction is visible, so a partner calling it directly on the shared transaction could resolve the importer's item and tell, by success versus NotFound, that it exists (edge, blind, gap) -- verdict: medium -- route: patch -- require the private item to be visible to the viewer before resolving it (same NotFound as no item); partner-side test.
- The counterpart-pool half of `privateInvolved` has no test: replacing `considered` with `pool` passes everything and reopens the leak (gap) -- verdict: medium -- route: patch -- add the case (shared candidate within the window of both the new leg and a private row, the private row outside the new leg's window).
- A system-viewer import with a private candidate gets the account-scoped item (blind, edge) -- verdict: low -- route: accept -- imports reach `importStatement` only through person routes; the system path exists for seeds and tests; recorded here.
- Partner's delete leaves the importer's private item open (edge) -- verdict: false -- `resolveOpenForEntity` has no viewer, so `softDeleteTransactionRow` resolves it whoever deletes.
- A locked set-aside row saved from the UI re-commits (blind) -- verdict: false -- `fixSetAsideRow` calls `requireOpenOn`, so it is refused until the account is reopened.
- A manual link of the shared transaction does not resolve the private item; stale item after the candidate changes (edge) -- verdict: low -- route: reject -- same as the account-scoped kind today, the link action handles a stale candidate.
- Closed-lock comparison duplicates `requireOpenOn`, re-import of the same file after reopening, set-aside ordering, privacy-test id renaming and unused return value, one test packing three behaviours, no hint why an item is private (blind, edge) -- verdict: low/false -- route: reject -- `allStagedRows` is sorted by row number, the rest is polish.
- `needReviewCount` for the importer's popover omits the person-scoped item (verification-gap) -- verdict: low -- route: defer -- deliberate (it must not touch `transaction:` refs); the importer still sees it in Needs review; logged.

## Verification

**Commands:**
- `npx vitest run` -- expected: all pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm check:strict` -- expected: clean.
