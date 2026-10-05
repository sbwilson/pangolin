---
title: 'True audit history and hidden-row projection'
type: 'bugfix'
ticket: 14
created: '2026-10-05'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
baseline_revision: 'e8a92b8c562731038aefc5a4eaac82b613908376'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/epic-ledger-accounts-privacy-retrospective.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ledger audit snapshots are built from the actor's projected row, so a partner's write on a hidden transaction permanently records its name and payee as null (retro I1); the audit scrubber fails open on bad JSON (I2); a hidden row still returns its fingerprint and external ID, and a v1 fingerprint is an unsalted hash of the hidden description (P2); and deletePayee's docstring contradicts its behaviour (I5).

**Approach:** Audit from a new viewer-checked stored-row read; keep audit keys present but nulled for the partner and have redact replace only present keys, failing closed; null fingerprint and externalId in the hidden projection and the audit scrub; fix the docstring and log the 2.5 decision.

## Boundaries & Constraints

**Always:** Repo reads take the viewer first and have a memory mirror plus a parity step (AD-3). New SQL lives only in privacy.ts, ledger-repos.ts or db/unit-of-work.ts (read rule). No `await` inside `write` (AD-2). The hider still sees everything they hid (AD-4). Stored audit JSON is the true state; hiding is applied only at read time.

**Decisions (2026-10-05, Simon):** Keep the full plan despite ~1,900 tokens (the fixes share one projection and audit path). I4 dropped: a soft-deleted payee keeps showing its name and logo on its transactions, as decided in 2.5 — accepted behaviour, no payeeOk change.

**Never:** Change payeeOk or deleted-payee display (I4 accepted). Change the hidden-name rule's `is_private` condition (entry 15). Touch transfer-group partner-delete or hide-by-non-owner (entry 16), the manifest (17), or the read-rule scope (18). Add the new read to the read-only `Repos` Pick or the privacy harness Pick.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Partner edits hidden row | A hid shared txn; B updates notes / splits / tags / transfer link / deletes | Stored audit before/after carry real descriptionRaw and payeeId; B's listAudit shows placeholder | none |
| Hider reads audit | same, as A | A sees real values | none |
| Malformed audit JSON | memory row or direct redact input not JSON | Placeholder/NULL, never the raw text | fail closed |
| Hidden imported row | v1-fingerprint txn hidden by A, read by B | fingerprint and externalId null for B; A sees them | none |
| Partner edits hidden imported row | B patches date/amount | refused as imported (decided from the stored row) | Conflict (existing API behaviour; amended by Simon 2026-10-05) |

</frozen-after-approval>

## Code Map

- `packages/app/src/ports/unit-of-work.ts:395-467` -- TransactionRepo; add `findStored(viewer, id): TransactionWithSplits | undefined` (`:367` type). VisibleTransaction `:376-393`: fingerprint becomes `string | null`, docs say nulled while hidden. TxRepos only (`:983`), not `Repos` Pick (`:1015`).
- `packages/db/src/ledger-repos.ts` -- `transactionColumns :54-75` + `liveVisibleTxn(viewer)` (privacy.ts:35) as in `update :261`; generalise `withSplits :210-228`; `viewColumns :78-89` add fingerprint/externalId from the projection.
- `packages/db/src/privacy.ts` -- `TxnProjection :46-64` and `visibleTxn` return `:120-131`: fingerprint/externalId CASE like descriptionRaw `:123`.
- `packages/db/src/unit-of-work.ts:112-139` -- audit `scrub :117-120`: keys set to null (json_set) for descriptionRaw, payeeId, fingerprint, externalId; `json_valid` guard → NULL when invalid.
- `packages/app/src/testing/memory-uow.ts` -- `transactionRepo :815-`, `view() :822-844` (projection), auditHiddenUntil `:1027-1055`, scrub `:1058-1066` (try/catch fail closed).
- `packages/app/src/ledger/transaction-view.ts:16-34` -- `auditSnapshot` takes the stored `TransactionWithSplits`.
- Use cases (stored read beside findVisible): update-transaction.ts `:44/:93/:100-101` (+ `:46` imported check from stored row), hide-name.ts `:79,:108,:122-140`, transfer-groups.ts `:35-36,:54,:62-63`, delete-transaction.ts `:25,:28,:35,:42` (read before softDelete), set-split-field.ts `:109,:163,:171-172`, set-splits.ts `:75,:173,:181-182`, split-tags.ts `:33,:52,:60-61`.
- `packages/app/src/redact.ts:30-53` -- scrubJson: replace descriptionRaw/payeeId only when present, fail closed (label/NULL) on parse failure or non-object.
- `packages/app/src/classify/payees.ts:143-146` -- docstring only.
- `story-classify-module-plan.md` -- `## Plan Change Log :78`: dated entry recording the 2.5 always-soft-delete decision (frozen line `:31`).
- Do not change: write.ts, `transferGroups.members` (entry 16), `deleteTransferGroup` audit.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/ledger-repos.ts`, `packages/app/src/testing/memory-uow.ts` -- add `findStored` with parity step in `repo-parity.test.ts` -- stored-row source for audit
- [x] `packages/app/src/ledger/transaction-view.ts` + 7 use cases -- snapshot from `findStored`; imported check from stored row -- I1
- [x] `packages/db/src/privacy.ts`, `ledger-repos.ts`, memory `view()` -- null fingerprint/externalId while hidden -- P2
- [x] `packages/db/src/unit-of-work.ts`, memory scrub, `packages/app/src/redact.ts` -- null-keep scrub incl. fingerprint/externalId, json_valid, fail-closed redact -- I1, I2, P2
- [x] `packages/app/src/classify/payees.ts`, `story-classify-module-plan.md` -- docstring; Plan Change Log entry -- I5
- [x] Tests: `hidden-names-transfers.test.ts` (B writes on A-hidden row: notes, splits, tags, transfer link, delete → stored audit real, B's listAudit placeholder; B cannot change date/amount of a hidden imported row), `packages/db/src/privacy.test.ts` (same on SQLite; v1 hidden row fingerprint/externalId null for B), `redact.test.ts` (malformed and non-object JSON fail closed; absent key not added), update `privacy.test.ts:223,:251` only if the placeholder path changes

**Acceptance Criteria:**
- Given A hid a shared transaction, when B makes any ledger write on it, then the stored audit before/after hold the real descriptionRaw and payeeId, and B's listAudit shows "Hidden until <date>" while A's shows the real values (SQLite and memory).
- Given a hidden v1-fingerprint transaction, when B lists or gets it, then fingerprint and externalId are null; A still sees them.
- Given scrubJson receives unparseable JSON, then it returns the placeholder, never the input.
- Given the server privacy suite, when it runs, then it passes unchanged or with snapshot updates explained in Implementation Notes.

## Design Notes

Partner-side audit scrub keeps keys and sets them to null (SQL `json_set(json, '$.descriptionRaw', NULL, ...)`), so redact can replace present keys with the label and never invent keys on rows that lacked them (deleteTransferGroup rows). Invalid JSON yields NULL in SQL and the label in redact — fail closed in both.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean (Biome, grit read rule, check-boundaries)
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, except known deploy/install.test.ts x2 and backup.test.ts timeout if still present
- `pnpm e2e` -- expected: green, run in CI order

## Implementation Notes

- `findStored(viewer, id)` reads `transactionColumns` under `liveVisibleTxn(viewer)` (live, visible, no projection) with splits; the memory mirror returns the stored row. It is on `TransactionRepo` only, not in `ReadRepos` or the privacy-harness Pick. A shared `storedTransaction` helper in `transaction-view.ts` throws if the row vanished mid-write. Every listed use case reads the stored row before its write and again after it, and `auditSnapshot` now takes a `TransactionWithSplits`.
- Audit scrub uses `json_replace`, not `json_set` as the Design Notes say. `json_set` would add the four keys to rows that lack them (deleteTransferGroup rows), which the Design Notes forbid. `json_replace` nulls only keys that are present. Invalid or NULL JSON returns NULL for every viewer, not only while hidden, so raw text never leaves. `auditHiddenUntil`'s per-row state also guards `json_valid`, so `json_extract` cannot throw. SQLite's CHECK already rejects invalid audit JSON, so this guard is defensive; the memory mirror has no such CHECK and is tested with malformed rows.
- `redact.scrubJson` (now exported) writes the label into `descriptionRaw` and `payeeId` only where they are present. A non-string, unparseable or non-object value becomes the label; `null` stays null. `payeeId` now reads as the label for the partner instead of being absent. Two existing tests asserted that it was absent: `packages/db/src/privacy.test.ts` ("redacts from an audit row's own before/after state") and `ledger.test.ts` (the same case on memory). They now expect the label.
- `ledger.test.ts` "guards a name hidden from the viewer" asserted that the stored audit lacked the real name, which is the I1 bug. It now asserts that the stored audit holds the real name and that B's `listAudit` does not.
- Matrix row "Partner edits hidden imported row" lists `Validation`, but the existing contract (docstring and tests) refuses an imported row's date/amount/description with `Conflict`. That is kept, and the decision now comes from the stored row, so an `externalId`-only row stays fixed even though its `externalId` is nulled for B.
- Review fix: now that snapshots hold the stored row, the audit scrub also nulls `$.payeeId` (kept, never added) when it names a payee the viewer may not see. The rule is `auditPayeeHidden` in privacy.ts, the same scope rule as `visibleTxn`'s payeeOk, with a memory mirror and a parity step. Split `tagIds` in a snapshot are the tags visible to the writer; a full tag record is deferred.
- The server privacy suite (`apps/server/src/privacy/privacy.test.ts`) passes unchanged.
- e2e ran in CI order (auth then chromium projects) against a locally built server on a fresh data dir, because there is no Docker on this machine: 25 passed, 1 skipped (the backup-line spec needs E2E_BACKUPS and a restic repo), and the CSP guard spec is an expected failure.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-05) — high 0 · medium 1 · low 4 · false 3 · maybe-false 0 (12 findings, 4 lenses)

| # | Lens | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind, edge, vgap(other) | B-authored audit rows now store A's person-scoped payeeId and B's listAudit returns it; the read scrub nulls payeeId only while a name is hidden, not for another person's scoped payee (projection's payeeOk rule) | medium | patch | Verified: findStored returns raw payee_id; unit-of-work.ts scrub and memory-uow scrub key only on `hidden`; repo-parity storedHiddenAsB shows non-null scoped payee. A-authored rows already exposed it (pre-existing), but B's writes are a new path. Fix: scrub also nulls $.payeeId when it names a payee not visible to the viewer, SQL + mirror, with a test. |
| 2 | edge (claim) | Projection and audit read disagree on payee visibility | medium | patch | Same root cause as #1; grouped. |
| 3 | blind | Invalid JSON returns NULL for the hider and system too | low | reject | Unreachable on SQLite (audit_log json_valid CHECKs, unit-of-work.test.ts:115); memory-only; fix adds branches. |
| 4 | blind, intent | SQL json_valid branches never exercised on SQLite | false | reject | Defence in depth by design (plan Design Notes); CHECK makes the state unreachable. |
| 5 | blind | `auditSnapshot` docstring claims the true state but tagIds come from the actor's scoped tagsOf | low | patch (docstring) + defer (full record) | Verified: tagsOf → listForSplits(viewer). Narrow the docstring now; recording every tag with read-time scope filtering deferred. |
| 6 | blind | Early unhide: B-authored snapshots keep the placeholder until the original date via auditHiddenUntil max | low | defer | Pre-existing auditHiddenUntil semantics (also applies to A-authored rows); a product decision, not caused by this change. |
| 7 | blind | deleteTransferGroup left on raw members rows | false | reject | Its rows are already the stored (true) values, so I1 does not apply; shape difference previously rejected (2.7 triage); its partner-side guard is entry 16. |
| 8 | blind, intent | Older audit rows not backfilled | low | reject | The real name was never stored, so nothing can be backfilled; prior rows read as the placeholder. |
| 9 | blind | Weak or one-sided test assertions (toBeGreaterThan, A-side checks only before or only after, slice(-6)) | low | patch | Direct test corrections. |
| 10 | intent | Valid non-object JSON (passes the CHECK) on a hidden row is tested only at redact unit level, not via SQLite listAudit | low | patch | Add one SQLite listAudit test. |
| 11 | blind | Extra findVisible + findStored reads per write | low | reject | Small-household data; fix adds a new repo shape (complexity). |
| 12 | blind | payees.ts docstring change unrelated to the story | false | reject | I5 is in this story's intent. |
