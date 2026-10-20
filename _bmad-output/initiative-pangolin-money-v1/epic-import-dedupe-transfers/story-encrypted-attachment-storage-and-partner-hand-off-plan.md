---
title: 'Encrypted attachment storage and partner hand-off'
type: 'feature'
ticket: 6
created: '2026-10-21'
baseline_revision: 'f6933d15463ac3fb74bd1568c6233ea22e09df70'
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

**Problem:** A person cannot import a statement for their partner: there is no encrypted file storage (AD-21) and no hand-off record (AD-5), so a file for the partner would either sit on disk in plain form or force the sender to learn which of the partner's private accounts it lands in.

**Approach:** Add an `AttachmentStore` port with an AES-GCM file adapter, an `attachment` table and an `import_handoff` table (migration 0017), and use cases to hand a file off, list its status for the sender, accept it into one of the recipient's accounts through `importStatement`, and dismiss it.

## Boundaries & Constraints

**Always:**
- Encrypt every attachment with a key derived from the auth secret by label (`HMAC(authSecret, "attachments")`, as `recoveryCodeHasher` does); store the ciphertext at `data/attachments/<HMAC(key, content)>`, deduplicated by that name, with a fresh random IV and the auth tag in the file.
- Write the file before the transaction that links it commits; fetch only by the `import_handoff` ID, never by hash.
- `import_handoff` is person-scoped (AD-3): the sender sees only `{ id, recipient, filename, status }` where status is `pending | imported | dismissed`; never `batch_id`, the chosen account, or any batch field. `batch_id` is set on accept and read only by the recipient.
- The recipient is a different active person; the hand-off review item (`imports.handoff`, `person` scope, entity `import_handoff:<id>`) is visible only to her.
- Accept runs `importStatement` as the recipient on an account she can see, then marks the hand-off `imported`; dismiss marks it `dismissed`, resolves the item and deletes the file when no other row links it.
- A non-recipient addressing a hand-off, or a recipient addressing it after it is `imported` or `dismissed`, gets `NotFound`/`Conflict` with no detail naming an account or batch.

**Never:**
- No HTTP routes, UI, batch undo (entry 7), PDF statements, receipts or logos, `transaction_attachment`, or backup changes.
- No plaintext statement content in the database, logs or audit rows.
- No reading the key from anywhere but the auth secret file; no custom crypto beyond `node:crypto` AES-256-GCM.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hand off | Person A uploads CSV for partner B | File encrypted on disk; hand-off `pending`; item raised for B only | `Validation` if recipient is self or inactive |
| Sender status | A lists hand-offs | Only id, recipient, filename, status | No account or batch fields |
| Accept | B picks her private account | `importStatement` runs as B; hand-off `imported`; item resolved | `NotFound` if account not visible to B |
| Sender unchanged | B accepted into private account | A's account, transaction and batch reads byte-identical to before | n/a |
| Dismiss | B dismisses | Status `dismissed`; item resolved; file deleted if unlinked | `Conflict` if already finalised |
| Wrong viewer | C or A calls accept/dismiss | Nothing written | `NotFound` |
| Same content twice | Two hand-offs of identical bytes | One file on disk, two link rows | Deleting one keeps the file |
| Tamper | Ciphertext byte altered | Decryption fails | Throws; no import |

</frozen-after-approval>

## Code Map

- `packages/app/src/ports/attachment-store.ts` -- new `AttachmentStore` port (`put(content) → name`, `get(name)`, `remove(name)`), beside `ports/tokens.ts`.
- `apps/server/src/attachments/file-store.ts` -- AES-256-GCM adapter over `node:fs`/`node:crypto`; key from `apps/server/src/auth/secret.ts` pattern; dir from `PANGOLIN_DATA_DIR` (`apps/server/src/config.ts`, `backup/paths.ts` already expects `data/attachments`).
- `packages/app/src/testing/attachment-store.ts` -- in-memory fake, beside `testing/tokens.ts`.
- `packages/db/src/schema/attachment.ts`, `import-handoff.ts`, `schema/index.ts`, `migrations/0017_attachment_and_handoff.sql` (+ drizzle meta snapshot) -- STRICT tables; model on `schema/import-batch.ts`.
- `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/*-repos.ts`, `packages/db/src/unit-of-work.ts`, `packages/app/src/testing/memory-uow.ts` -- `AttachmentRepo`, `ImportHandoffRepo` (Viewer-first reads; add to `ReadRepos` as needed; parity test as in `repo-parity.test.ts`).
- `packages/app/src/context.ts` -- carry the store on `UseCaseContext`.
- `packages/app/src/imports/handoff.ts` -- `createHandoff`, `listMyHandoffs`, `acceptHandoff`, `dismissHandoff`; review kind via `defineReviewKind` / `raiseReviewItem` / `resolveReviewItem` (`system/review-items.ts`); reuse `importStatement`.
- `packages/app/src/accounts/leave-household.ts` -- drop the leaver's hand-offs and orphaned files (it already calls `reviewItems.deleteForPerson`).
- `packages/app/src/index.ts` -- exports.
- Don't change: `importStatement` internals, `redact.ts`, `privacy.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] Migration 0017 + schemas + snapshot -- `attachment` (id, `name` unique, mime, bytes, createdAt) and `import_handoff` (id, attachment_id, sender/recipient person ids, filename, format, csv_mapping JSON, status CHECK, batch_id nullable) -- persistence.
- [ ] Port, file adapter, fake -- encrypted store with tamper detection -- AD-21.
- [ ] Repos in db and memory UoW with parity tests -- Viewer-first, person-scoped.
- [ ] `imports/handoff.ts` + `leave-household.ts` + exports -- the four use cases and cleanup.
- [ ] Tests -- one per matrix row; adapter test reads the file and asserts no plaintext; sender-snapshot test compares `JSON.stringify` of sender reads (accounts, transactions, batches, review items) before and after accept.

**Acceptance Criteria:**
- Given a hand-off, when the file on disk is read raw, then it does not contain the statement text and decrypts only through the store.
- Given the recipient accepts, when the sender reads anything, then every response equals its earlier value except the hand-off status.
- Given the same file handed off twice, when one is dismissed, then the other still imports.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `leave-household.ts` sender leaves -- verdict: medium -- route: patch -- recipient's `imports.handoff` item survives the dropped row; accept gives NotFound.
- `leave-household.ts` optional store (blind, gap) -- verdict: medium -- route: patch -- rows go, files stay; server leave route supplies no store. Fail loudly when files must be removed and no store is given.
- post-commit `remove` throws (blind, edge) -- verdict: low -- route: patch -- a committed dismiss or leave reports failure; guard with try/catch.
- `file-store.ts` put on damaged existing file, `.partial` leak (blind, edge) -- verdict: medium -- route: patch -- every later hand-off of that content fails; clean partial on write error.
- failed create with already-linked content (gap) -- verdict: medium -- route: patch -- untested branch of `removeIfUnlinked`.
- imported statement kept on disk (blind, edge, gap) -- verdict: medium -- route: defer -- retention is undecided and entry 7 (batch undo) may need the file.
- accept only tested on memory UoW (gap) -- verdict: low -- route: defer -- repo parity covers SQLite.
- batch FK vs future batch delete (edge) -- verdict: maybe-false -- route: defer -- belongs to entry 7.
- orphan file sweep, secret rotation check (blind, edge) -- verdict: medium -- route: defer -- AD-21 sweep and health check are separate work.
- unvalidated format/csvMapping at accept (blind, edge) -- verdict: false -- only `createHandoff` writes them after validation and `importStatement` re-validates strictly.
- shared account reveals destination (edge) -- verdict: false -- sender cannot see the hand-off's batch; a shared account is visible to both regardless.
- key reuse, volume caps, MIME fallback, plain Error on missing file, fake store hashing, race in removeIfUnlinked, stale plan text, serverless wiring (blind, edge, intent) -- verdict: low -- route: reject -- negligible, out of scope by the plan's Never list, or fix edits the plan.

## Design Notes

The sender-facing view is a separate projection (`HandoffStatus`) with no `batchId` property, so a leak needs a type change, not a forgotten field. Accept order: read and decrypt, run `importStatement`, then update the row, all in one write; a thrown import leaves the hand-off `pending`. Rotating the auth secret would orphan attachments; accepted for v1 and noted in the adapter.

## Verification

**Commands:**
- `npx vitest run packages/db packages/app apps/server` -- expected: all pass.
- `pnpm typecheck` -- expected: no errors.
- `pnpm lint` -- expected: clean, boundary check 0 violations.
- `pnpm check:strict` -- expected: new tables pass STRICT checks.
