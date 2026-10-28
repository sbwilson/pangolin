---
title: 'PDF statement upload, encrypted attachment storage, and visual review UI'
type: 'feature'
ticket: 8
created: '2026-10-28'
status: 'built'
baseline_revision: '240d5fbfa350bff98dcd967b1e90340d87b93354'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: [quick]
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/import-pipeline.md'
warnings: ['oversized']
deferred: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 5.7 PDF engine has no HTTP entry: the Import popover rejects `.pdf`, the statement file is never persisted (AD-21), and a verification-failed batch is invisible — no review item, and no way to see extracted rows beside the page image to correct them.

**Approach:** Accept PDF in the Import popover; a base64 upload hits a new `POST /api/import/pdf` wired to `extractAndImportPdfStatement` with the pdfjs extractor and the configured `pdf_extract` provider. The use case encrypts the PDF via `AttachmentStore` into an attachment row linked to the batch (new nullable `import_batch` columns). A failed batch raises a new account-scoped `import.pdf_failed` review item; `/review` shows a side-by-side card — inline-correctable rows beside a client-rendered page image — and Re-check re-runs the deterministic checks (no LLM), flipping the batch to `ready` and resolving the item when they pass.

## Boundaries & Constraints

**Always:**
- `ctx.attachments.put(bytes)` before the batch write, `removeIfUnlinked` on failure; reuse the deduped `attachment` row by `name` (createHandoff pattern, `imports/handoff.ts:99–117,155–162`). Link via new nullable `import_batch.attachment_id`; PDFs are read only through the batch row, viewer-scoped (AD-21, AD-3) — never by raw HMAC name.
- Failure path additionally persists the extraction header (`startDate`, `endDate`, `accountNumberLast4`) in new `import_batch.statement_meta` JSON, each extracted row's fields in `import_row.proposal` JSON, and raises `import.pdf_failed` (dedupeKey `import.pdf_failed:<batchId>`, entityRef `import_batch:<batchId>`); replacing an undone prior failed batch resolves its old item first.
- Corrections update `import_row.proposal` only for `staged` rows of a `failed`/`statement_pdf` batch. Re-check calls `verifyStatementBalances` against corrected rows + saved header: pass → batch `ready`/`ok`/gap 0, row reasons cleared, item resolved; fail → return the exact error, batch stays failed.
- Page images render with pdfjs-dist in the browser: same-origin bundled worker (`?url` asset), `getDocument({data, useSystemFonts: true, isEvalSupported: false})` from fetched bytes — no blob:/data: URLs (CSP is `'self'` everywhere; `e2e/helpers/csp.ts` fails tests on any violation).
- E2E follows `e2e/import.spec.ts`; statement fixture PDFs are committed under `packages/importers/fixtures/` (e2e has no workspace imports).

**Never:**
- Never commit ledger transactions from a PDF batch — a verified batch ends at `ready` (the spec's one-click-review commit is owned by no story; do not build it).
- No multipart uploads (JSON bodies only); no CSP relaxations; no third-party requests.
- Do not change CSV/OFX/QIF or the set-aside flow, vision extraction, logo serving, or the attachment orphan sweep.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid PDF upload | provider returns balanced extraction | batch `ready`, rows staged, attachment row + `import_batch.attachment_id` link, popover shows verified/staged counts | No error |
| 1-cent-gap PDF upload | extraction fails verification | 400 `Validation` with exact gap; batch `failed`/`gap`; rows staged with reason+pdfPage+proposal; `import.pdf_failed` item raised; popover shows error + Needs review link | `Validation` |
| No provider configured | upload attempt | 400 before extraction | `Validation` |
| Oversize base64 | decoded > 10 MiB | refused before LLM call | bodyLimit 413 / `Validation` |
| GET batch file, visible viewer | failed or ready batch | decrypted `application/pdf` bytes | — |
| GET batch file, viewer can't see account | other household/private | no bytes | `NotFound` |
| Correct row + Re-check passes | corrected amounts reconcile | batch `ready`/`ok`, reasons null, item resolved | — |
| Re-check still fails | corrected rows still off | exact new error; item open; batch stays `failed` | returned, not thrown |
| Re-upload same failed file | old failed batch exists | old batch undone + old item resolved; new failed batch + new item; same attachment file reused | `Validation` rethrown |
| `.xlsx` upload | popover | rejected with "Try CSV, OFX, QIF or PDF." | client-side |

</frozen-after-approval>

## Code Map

- `packages/app/src/imports/pdf-import.ts` — engine to wire: input accepts base64 `content`; ctx (L60–71) already matches `withLlm`; failure path L321–410 (writes failed batch + staged rows, then throws), success L412–501 (status `ready`). Add `attachments` (extends `AttachmentContext`), put/link, `statement_meta`, per-row `proposal`, raise/resolve review item.
- `packages/app/src/imports/handoff.ts` — write-order + dedupe + cleanup precedent (put L99, `findByName` L107–117, `removeIfUnlinked` L155–162); `MAX_HANDOFF_BYTES` L33.
- `packages/app/src/ports/attachment-store.ts` / `testing/attachment-store.ts` — sync `put/get/remove` port + fake.
- `packages/app/src/ports/unit-of-work.ts` — `ImportBatchRow` (L1559+, add `attachmentId`/`statementMeta`), `AttachmentRepo` (L1690–1699), `ImportRowRow.pdfPage`/`updateProposal`.
- `packages/db/src/repositories/import-repos.ts` — `createImportBatchRepo` L16: persist new columns. `handoff-repos.ts` `createAttachmentRepo` L15–49: extend `deleteIfUnlinked` NOT EXISTS with `import_batch.attachment_id`.
- `packages/db/src/schema/import-batch.ts` + new `packages/db/migrations/0024_pdf_batch_attachment.sql` — two nullable ADD COLUMNs (attachment_id REFERENCES attachment(id), statement_meta TEXT); STRICT-table ALTER with NULL defaults.
- `packages/app/src/testing/memory-uow.ts` (L578–601 attachments) + `repo-parity.test.ts` — mirror new fields/behaviors.
- `packages/app/src/system/review-items.ts` — `defineReviewKind`/`raiseReviewItem`/`resolveReviewItem(tx, audit, ctx, {dedupeKey, resolution})`; set-aside resolve-when-clear pattern in `imports/set-aside.ts:309–317`.
- `packages/app/src/system/review-view.ts` — `detailOf` L164–240 + `listReviewCards` L247–271: add pdf detail/loader (batch loader pattern = `IMPORT_SET_ASIDE_REVIEW` case). `review-actions.ts` — item→use-case wrappers (e.g. `acceptHandoffItem` ~L290).
- `packages/app/src/imports/pdf-verify.ts` / `pdf-extract-request.ts` — `verifyStatementBalances` (re-check reuses; no LLM); `pdfExtractPageSchema` field names (camelCase: openingBalanceCents, rows[].postedOn/amountCents/runningBalanceCents) for mock fixtures + proposal schema.
- `apps/server/src/http/app.ts` — `POST /api/import` L913, `importBodyLimit` L972–980, `assertStatementSize` L983–987, `withAttachments` L297, `withLlm` L301–321 (supplies createProvider/decryptApiKey/authSecret), review-action routes ~L881–903, llm provider/purpose routes L934–960. New routes register inside `createApi` only.
- `packages/importers/src/pdf/text-extractor.ts` — `extractPdfTextPages` injected via route options; boundary allows apps/server→packages/importers (`scripts/check-boundaries.ts:45`); move it devDep→dep in `apps/server/package.json`.
- `apps/web/src/lib/import-format.ts` L27–47 — `.pdf` rejection to replace; `ImportPopover.tsx` `run()` L117–145 (text read L40–48 → base64 for pdf; `needsBank` already false for pdf), status L233–248; `ImportSummary.tsx`; `api.ts` `importFile` L906 + `ReviewAction` union L414.
- `apps/web/src/components/review/` — `ReviewCardView.tsx` L15–48 dispatch, `ReviewCardFrame.tsx` KIND_LABEL L12–28, `SetAsideCard.tsx` (labels/`role=alert`/INPUT class — the inline-edit idiom). UI: Tailwind 4 + hand-rolled primitives; no dialog/split library needed.
- `apps/server/src/http/csp.ts` — `default/img/script/connect-src 'self'`.
- `e2e/import.spec.ts` + `e2e/helpers/` — sign-in/createAccount/setInputFiles/review-link patterns; fixture files read by path (e2e has only Playwright deps).
- `tools/mock-llm/src/server.ts` — replays `<fixtures>/openai/<model>.json` verbatim by request `model`; `cli.ts --port --host --fixtures`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/migrations/0024_pdf_batch_attachment.sql` + `packages/db/src/schema/import-batch.ts` + `repositories/import-repos.ts` + `migrate.test.ts` — add/persist `attachment_id`, `statement_meta`.
- [x] `packages/app/src/ports/unit-of-work.ts` + `packages/app/src/testing/memory-uow.ts` + `repo-parity.test.ts` — mirror `ImportBatchRow` fields; extend `deleteIfUnlinked` (attachment stays while any batch links it).
- [x] `packages/app/src/imports/pdf-review.ts` (new) — `IMPORT_PDF_FAILED_REVIEW` (`import.pdf_failed`, imports/account); row proposal schema (postedOn, amountCents, description, runningBalanceCents?); `correctPdfRow` (staged rows of failed statement_pdf batch only); `recheckPdfStatement` (header from batch + statement_meta; row values from proposal, falling back to lenient rawLine parse; on pass `updateCountsAndStatus` ready/ok/0 + clear reasons + `resolveReviewItem`; on fail return the exact failure). Import nothing from pdf-import (no cycle).
- [x] `packages/app/src/imports/pdf-import.ts` — extend ctx with `attachments`; both terminal paths: `put` before write, dedupe attachment row by name, set `attachmentId`; failure path: `statement_meta` JSON, per-row `proposal` JSON, raise item (resolve prior item when replacing an undone failed batch); wrap write failures with `removeIfUnlinked`.
- [x] `packages/app/src/imports/pdf-import.test.ts` (update) + `pdf-review.test.ts` (new) — unit-test every I/O-matrix edge case with fakeAttachmentStore (link, dedupe, raise/resolve, correct, re-check pass/fail, cleanup on failed write).
- [x] `packages/app/src/system/review-view.ts` + `review-view.test.ts` — `pdf_batch` detail {batchId, accountName, gapCents, error, rows[{id,rowNumber,pdfPage,rawLine,reason,corrected}]}; invisible accounts never listed.
- [x] `packages/app/src/system/review-actions.ts` — `correctPdfRowItem`/`recheckPdfItem` wrappers (item entityRef → batch). `packages/app/src/index.ts` — export new kinds/use cases.
- [x] `apps/server/package.json` + `apps/server/src/http/app.ts` + `http/app.test.ts` + `privacy.test.ts` — `POST /api/import/pdf` (writable; importBodyLimit; decoded-size assert ≤10 MiB; ctx = withLlm + attachments + injected `extractPdfTextPages`); `GET /api/import/pdf/:batchId/file` (viewer-scoped via `importBatches.find`, `application/pdf`); two review-action routes; serving + visibility matrix tests.
- [x] `apps/web/package.json` (+`pdfjs-dist` ^6.4.299) + `lib/import-format.ts`(+test) + `ImportPopover.tsx`(+test) + `ImportSummary.tsx` + `api.ts` — accept `.pdf` (UX copy "Try CSV, OFX, QIF or PDF."); pdf reads arrayBuffer→base64 → `importPdfFile`; success copy states verified-and-staged (never "imported"); failure shows the exact reason + Needs review link.
- [x] `apps/web/src/components/review/PdfStatementCard.tsx` + `PdfPageCanvas.tsx` (new) + `ReviewCardView.tsx` + `ReviewCardFrame.tsx` — side-by-side grid: left = extracted rows, each inline-editable (label htmlFor, INPUT class, `role=alert` errors) with Save (`correct-pdf-row`); right = pdfjs canvas page image of the selected row's `pdfPage` (worker via same-origin `?url` asset; bytes fetched from the batch file route; `role="img" aria-label` "Statement page N"; page nav), Re-check button (`recheck-pdf`) surfacing the returned error or letting the card disappear on invalidation.
- [x] `tools/mock-llm/fixtures/openai/mock-pdf-ok.json` + `mock-pdf-gap.json` — chat.completion bodies whose `choices[0].message.content` is schema-shaped extraction (ok: balanced; gap: one amount 1¢ off with printed running balances so correcting that amount re-chains both checks).
- [x] `packages/importers/fixtures/statement-ok.pdf` + `statement-gap.pdf` — committed single-page text-layer PDFs generated once via `generateMockPdfStatement`.
- [x] `compose.yaml` — `mock-llm` service (node:26-trixie-slim, mount `./tools/mock-llm:ro`, `node /app/src/cli.ts --port 4111 --host 0.0.0.0`, profile `llm`).
- [x] `.github/workflows/ci.yml` — start the `llm` profile with the stack; e2e env `E2E_LLM_BASE_URL=http://mock-llm:4111` and `E2E_ATTACHMENTS_COMMAND` (docker compose exec listing `/data/attachments` names + first magic bytes).
- [x] `e2e/pdf-import.spec.ts` — sign in → create account → POST provider (kind openai, baseUrl `E2E_LLM_BASE_URL ?? http://127.0.0.1:4111`, model `mock-pdf-ok`, `cloudPdf: true` — compose DNS names are not LAN literals, so AD-6 needs the explicit opt-in) → assign purpose `pdf_extract` → upload `statement-ok.pdf` via popover → verified status → attachments command shows a 64-hex file whose bytes are not `%PDF` → GET file route returns `%PDF` → switch provider model to `mock-pdf-gap`, upload gap fixture → popover error + `/review` shows the card with rows beside a canvas page image → correct the bad amount → Re-check → card gone, review count drops.

**Acceptance Criteria:**
- Given a configured mock provider, when a valid PDF is uploaded through the Import popover, then the batch is `ready` with rows staged, and an encrypted attachment (AES-GCM, 64-hex HMAC name, no `%PDF` magic at rest) is linked to the batch and decrypts through the batch-scoped GET route.
- Given an upload whose verification fails, then a `import.pdf_failed` card appears at `/review` showing extracted rows beside the rendered page image; a correction persists, and Re-check either flips the batch to `ready` and resolves the item or reports the exact remaining gap.
- Given a viewer who cannot see the account, the file route 404s and the card is not listed (AD-3/AD-21).
- `pnpm lint`, `pnpm typecheck`, and the vitest suites stay green; the existing `/review` axe project and CSP guard pass with the new card.

## Implementation Notes

## Plan Change Log

- 2026-10-28 — pdfjs-dist 6.4.299 dropped `isEvalSupported` (v6 has no eval path at all), so the
  browser call is `getDocument({data, useSystemFonts: true})`; the plan's CSP-safety intent holds.
  `PdfPageCanvas` is lazy-imported so pdf.js stays out of the main chunk and inside the service
  worker's 2 MiB precache budget.
- 2026-10-28 — integration rehearsal (real pdf.js extractor + live mock-llm) found that pdf.js
  transfers the bytes it is handed to its worker, detaching the caller's buffer before
  `attachments.put` ran. `extractAndImportPdfStatement` now passes `uint8.slice(0)` to the
  extractor; regression test added in `pdf-import.test.ts`.

## Review Triage Log

| # | Location | Claim | Verdict | Evidence / route |
|---|----------|-------|---------|------------------|
| 1 | `packages/app/src/accounts/leave-household.ts:70–81,270` | `deleteForAccount` hard-deletes batches while `import_handoff.batch_id` (plain FK, no cascade) still references them → leave aborts | high | Verified: accepted hand-off (`handoff.ts:226` sets `batchId`; schema `import-handoff.ts:30` FK) into a leaver's private account, then `leaveHousehold` deletes batches (line 270) before `dropHandoffsOf` (line 81) → immediate FK violation aborts the leave. New failure mode: pre-diff batches were never deleted. → patch |
| 2 | `apps/server/src/http/app.ts` `POST /api/import/pdf` | ≤10 MiB decoded check measures only `input.content`; use case takes `pdfData ?? content` (`pdf-import.ts:160`) → `{"pdfData": …}` bypasses it | medium | Verified: route decodes only `content`; a pdfData-only body passes the check and runs up to `importBodyLimit` (30 MiB JSON), contradicting the frozen matrix row. → patch |
| 3 | `apps/web/src/components/import/ImportPopover.tsx` run() catch | `pdf: true` attached to every PDF error, so "Needs review" links show on no-provider/oversize/transport errors that raise no review item | low | Claim true, but rejected: a spurious link to the still-useful `/review` inbox is unlikely met in everyday use (provider is configured before the feature works; oversize is blocked client-side), and the fix adds a distinguishing branch the client cannot ground without message-sniffing or a response-surface change. |
| 4 | `packages/app/src/system/review-actions.ts` `correctPdfRowItem` | Forwards client `rowId` without checking it belongs to the item's `entityRef` batch (plan: "item entityRef → batch") | low | Verified in code: only `openItem` kind-check; `correctPdfRow` validates the row's own batch, so a card can drive a row of another failed PDF batch (viewer-scoped, no leak). Deviation from the plan's wrapper contract. → patch |
| 5 | `packages/app/src/imports/pdf-review.ts` recheck pass branch | Audit `after` omits the recomputed `firstPostedOn`/`lastPostedOn` that `updateCountsAndStatus` persists | low | Verified: `after` spread keeps pre-correction dates while lines 352–357 write min/max; diverges when a row's date correction moves the span. → patch |
| 6 | `packages/app/src/ports/unit-of-work.ts` `deleteIfUnlinked` doc | Doc still says "when no hand-off links it" after semantics extended to import-batch links | low | Verified at :1710–1713 vs `handoff-repos.ts:44` and `memory-uow.ts:611`. → patch |

## Design Notes

Re-check ends at `ready`, not committed: the spec puts a one-click review between passing and committing, which no ticket owns — `ready` is the exact state the 5.7 success path already defines, so corrected batches wait there honestly. `statement_meta` exists because period/last-4 are needed by re-check but opening/closing already live on the batch; one nullable JSON column avoids re-LLM-ing the header. Client-side pdf.js rather than server rasterization: no rasterizer exists in the stack and CSP permits same-origin canvas rendering with a bundled worker.

## Verification

**Commands:**
- `pnpm lint` — biome + `check-boundaries.ts` clean (server→importers allowed).
- `pnpm typecheck` — all workspaces.
- `pnpm vitest run packages/app packages/db apps/server` — pdf-import/pdf-review/review-view/migrate/parity/app/privacy suites green.
- `docker compose --profile llm up -d && pnpm e2e e2e/pdf-import.spec.ts` (stack per CI job; needs `E2E_LLM_BASE_URL`, `E2E_SETUP_LINK_COMMAND`, `E2E_ATTACHMENTS_COMMAND`) — passes with zero CSP violations.
- `pnpm e2e e2e/axe.spec.ts` — `/review` axe green with the new card visible.
