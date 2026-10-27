---
title: 'PDF statement extraction engine with pdf.js and deterministic balance verification'
type: 'feature'
ticket: 7
created: '2026-10-27'
status: 'built'
baseline_revision: 'c1847759eb51f4be7abcc4cb4cd1cb9bfdc39698'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/import-pipeline.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/categorisation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Bank statements in PDF format cannot currently be ingested by the import pipeline, lacking a text-layer extraction engine with page-by-page LLM extraction, AD-6 privacy guardrails, vision fallback rejection, and deterministic balance verification to protect against model hallucinations.

**Approach:** Implement PDF text extraction using `pdfjs-dist`, page-by-page structured extraction using `LlmProvider` with schema validation, AD-6 privacy checks (local by default, cloud only with explicit `cloud_pdf` opt-in), vision fallback rejection for scanned PDFs lacking text layers when models lack vision, and deterministic balance verification (opening + sum of amounts = closing to the cent, running balance matches, dates within statement period, and account last-4 check) that stages passing statements and blocks batches with exact balance gaps on discrepancies.

## Boundaries & Constraints

**Always:**
- PDF text extraction uses `pdfjs-dist` (targeting Node 22+ with `pdfjs-dist/legacy/build/pdf.mjs`).
- If a PDF lacks any extractable text layer (scanned statement), check the model's vision capability: if the model lacks vision capability, reject immediately with `AppError("Validation", 'Scanned PDF statements without a text layer require a vision-capable model. The configured model "<model>" does not support vision.')`.
- `pdf_extract` runs only on a local provider unless the provider has an explicit `cloud_pdf` opt-in (`cloudPdf === true`); attempts to run on cloud without opt-in throw `AppError("PermissionDenied", "Cloud provider not permitted for PDF extraction without cloud_pdf opt-in")`.
- Extraction prompt schema validates page-by-page header data (`accountNumberLast4`, `startDate`, `endDate`, `openingBalanceCents`, `closingBalanceCents`) and transaction rows (`postedOn`, `description`, `amountCents`, `runningBalanceCents`, `pageNumber`).
- Plain code executes four deterministic checks before trusting any LLM output:
  1. Opening balance + sum of amounts = closing balance to the cent.
  2. Each printed running balance matches the cumulative balance.
  3. All transaction dates fall within the statement period `[startDate, endDate]`.
  4. The statement account last 4 matches the selected account's expected identifier when available.
- Passing verification stages rows into `import_row` (with `pdf_page`) and creates an `import_batch` with `status: "ready"` (or `"staged"`), `source: "statement_pdf"`, `reconcileStatus: "ok"`, and `reconcileGapCents: 0`.
- Failing verification (e.g. an induced 1-cent discrepancy) blocks the batch: records the batch with `status: "failed"`, `reconcileStatus: "gap"`, `reconcileGapCents: <gap>`, stages rows in `import_row` with failure reasons, and throws `AppError("Validation", ...)` reporting the exact gap.
- Live request preview in Settings for `purpose: "pdf_extract"` uses the real request builder (`buildPdfExtractRequest`) per AD-6.
- Provide a synthetic PDF statement generator (`generateMockPdfStatement`) producing valid PDF buffers with text layers and verifiable totals for automated test suites.

**Never:**
- Never commit ledger transactions or trust balances based on LLM claims without deterministic balance reconciliation.
- Never send PDF statement data to a cloud LLM provider without explicit `cloud_pdf: true` opt-in (statements contain names, addresses, and account numbers).
- Never implement upload UI popovers or side-by-side visual correction image displays in this story (deferred to story 5.8).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid synthetic PDF statement | PDF buffer with matching opening ($1000.00), rows (+50.00, -20.00), closing ($1030.00) | Verification succeeds (`ok: true`, gap: 0); batch staged with `reconcile_status = "ok"`, rows staged with `pdf_page` | No error |
| 1-cent balance discrepancy | PDF where opening + sum of amounts differs from closing by 1 cent | Verification fails; batch blocked with `status = "failed"`, `reconcile_status = "gap"`, `reconcile_gap_cents = 1`; throws `Validation` with exact gap | Throws `AppError("Validation")` |
| Running balance mismatch | PDF row printed running balance does not match cumulative sum | Verification fails; identifies exact row number and mismatch amounts | Throws `AppError("Validation")` |
| Transaction date out of period | Transaction dated `2024-10-15` on a statement with period `[2024-09-01, 2024-09-30]` | Verification fails; identifies date outside period error | Throws `AppError("Validation")` |
| Account number mismatch | Statement account last 4 is `9876` but selected account expects `1234` | Verification fails; identifies account mismatch | Throws `AppError("Validation")` |
| Scanned PDF (no text layer) with non-vision model | PDF with no text stream, provider model is `llama3` or `gpt-3.5` | Rejection before LLM call with vision requirement message | Throws `AppError("Validation", "Scanned PDF statements without a text layer require a vision-capable model...")` |
| Cloud provider without `cloud_pdf` opt-in | Provider has `is_local = false` and `cloud_pdf = false` | Refused before sending any text; throws `PermissionDenied` | Throws `AppError("PermissionDenied")` |
| Settings live preview for `pdf_extract` | Settings page requests preview for `purpose: "pdf_extract"` | Returns prompt text and schema generated by `buildPdfExtractRequest` | Throws `Unauthenticated` if no viewer |

</frozen-after-approval>

## Code Map

- `packages/importers/package.json` -- add `pdfjs-dist` dependency.
- `packages/importers/src/pdf/text-extractor.ts` -- PDF text extraction wrapper using `pdfjs-dist/legacy/build/pdf.mjs`, extracting text per page and detecting empty text layers.
- `packages/importers/src/pdf/model-vision.ts` -- utility `isVisionCapableModel(model: string): boolean` to classify vision-capable models (e.g. GPT-4o, Claude 3/3.5, Gemini, LLaVA, Pixtral).
- `packages/importers/src/generators/mock-statements.ts` -- add `generateMockPdfStatement(options)` generating a valid PDF binary buffer with text layer, header, opening/closing balance, running balances, and transactions.
- `packages/importers/src/index.ts` -- re-export `extractPdfTextPages`, `isVisionCapableModel`, and `generateMockPdfStatement`.
- `packages/app/src/ports/statement-parser.ts` -- extend `ParsedStatementRow` with optional `pdfPage?: number | null`.
- `packages/app/src/imports/pdf-extract-request.ts` -- define Zod schemas (`pdfExtractRowSchema`, `pdfExtractPageSchema`), `buildPdfExtractRequest`, and AD-6 privacy guard for `cloud_pdf`.
- `packages/app/src/imports/pdf-verify.ts` -- implement deterministic verification checks (`verifyStatementBalances`): opening + sum = closing to the cent, running balance matches, dates within period, account last-4 matches.
- `packages/app/src/imports/pdf-import.ts` -- implement `extractAndImportPdfStatement` use case orchestrating text extraction, vision rejection, page-by-page LLM extraction, deterministic verification, and DB batch staging/blocking.
- `packages/app/src/classify/llm-provider-use-cases.ts` -- extend `getLlmRequestPreview` to support `purpose: "pdf_extract"` via `buildPdfExtractRequest`.
- `packages/app/src/index.ts` -- export PDF extraction, verification, and import use cases and schemas.
- `packages/importers/src/pdf-extract.test.ts` -- unit tests for `pdfjs-dist` text extraction, synthetic PDF generation, and vision fallback rejection on scanned PDFs.
- `packages/app/src/imports/pdf-import.test.ts` -- integration tests for `extractAndImportPdfStatement` covering successful import, 1-cent discrepancy batch blocking with exact balance gap, running balance mismatch, date range mismatch, account mismatch, and cloud privacy opt-in refusal.
- `packages/app/src/classify/llm-provider-use-cases.test.ts` -- test Settings live request preview for `pdf_extract`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/importers/package.json` -- install `pdfjs-dist` dependency for text extraction.
- [x] `packages/importers/src/pdf/text-extractor.ts` & `packages/importers/src/pdf/model-vision.ts` -- implement page-by-page text extraction with `pdfjs-dist` and vision capability classifier.
- [x] `packages/importers/src/generators/mock-statements.ts` & `packages/importers/src/index.ts` -- add `generateMockPdfStatement` producing valid PDF buffers with text streams and export utilities.
- [x] `packages/importers/src/pdf-extract.test.ts` -- test text extraction from generated PDFs and vision fallback rejection for PDFs lacking text layers.
- [x] `packages/app/src/ports/statement-parser.ts` -- add optional `pdfPage?: number | null` to `ParsedStatementRow`.
- [x] `packages/app/src/imports/pdf-extract-request.ts` -- implement `buildPdfExtractRequest` with Zod extraction schemas and AD-6 `cloud_pdf` opt-in check.
- [x] `packages/app/src/imports/pdf-verify.ts` -- implement `verifyStatementBalances` performing all 4 deterministic checks (opening + sum = closing to the cent, running balance chaining, date range, account last 4).
- [x] `packages/app/src/imports/pdf-import.ts` -- implement `extractAndImportPdfStatement` use case staging passing batches and blocking discrepancies.
- [x] `packages/app/src/classify/llm-provider-use-cases.ts` & `packages/app/src/classify/llm-provider-use-cases.test.ts` -- wire `purpose: "pdf_extract"` preview in `getLlmRequestPreview` and add test coverage.
- [x] `packages/app/src/imports/pdf-import.test.ts` -- comprehensive integration test suite verifying matching balances import, 1-cent discrepancies block the batch with exact gap, running balance mismatches fail, date bounds fail, and cloud opt-ins are enforced.
- [x] `packages/app/src/index.ts` -- export new PDF extraction, verification, and import types and functions.

**Acceptance Criteria:**
- Given a synthetic PDF statement with known totals where opening balance + sum of amounts = closing balance, when extracted and imported, then the batch is staged with `status = "ready"` (or `"staged"`), `reconcile_status = "ok"`, `reconcile_gap_cents = 0`, and rows record their `pdf_page`.
- Given a synthetic PDF statement with an induced 1-cent discrepancy, when extracted and imported, then the batch is blocked with `status = "failed"`, `reconcile_status = "gap"`, `reconcile_gap_cents = 1`, and `AppError("Validation")` is thrown with the exact balance gap error.
- Given a PDF statement where a printed running balance differs from the cumulative sum, verification fails and identifies the exact row and discrepancy.
- Given a PDF statement containing a transaction date outside the statement period, verification fails with a date range violation error.
- Given a PDF lacking any text layer and a model without vision capabilities, the statement is rejected before model calling with a message specifying that scanned PDFs require a vision-capable model.
- Given a cloud LLM provider with `cloud_pdf = false` assigned to `pdf_extract`, any extraction attempt throws `AppError("PermissionDenied")`.
- Given `purpose = "pdf_extract"` in Settings preview, `getLlmRequestPreview` returns prompt and schema built from `buildPdfExtractRequest`.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Lenses run 2026-10-27 (resumed review; prior run's lens results lost): blind-hunter, edge-case-hunter, verification-gap, intent-alignment.

### Patched

- [high → patch] broken multi-page test (`pdf-import.test.ts:507`: body references `prompt` while param is `_prompt`; suite red with ReferenceError) [blind, edge ×2, VG-other] — confirmed by reading the line and by two lenses' vitest runs; only coverage of multi-page `pdfPage` staging.
- [medium → patch] failing-verification path undoes an existing batch checking only `undoneAt`, not `status` (`pdf-import.ts:322`) — verified asymmetry: pre-check (line 137) and success path (line 384) both exclude non-failed batches; a concurrent success could be silently undone by a later failed attempt.
- [medium → patch] `markUndone()` of a replaced prior batch emits no audit entry (both write paths, `pdf-import.ts:323,399`) — baseline convention audits undos (`undo-batch.ts:96-103` writes an `import_batch` update audit).
- [medium → patch] zero coverage for scanned-PDF + vision-capable-model rejection ("Vision statement extraction is not yet supported") and for `defaultIsVisionCapable`'s positive side [VG-1, intent] — pre-verified: lens deleted the throw, suite stayed green.
- [medium → patch] running-balance reverse-order rescue (`pdf-verify.ts:187-193`) never entered by any passing test [VG-2] — pre-verified: lens disabled the fallback, suite stayed green.
- [medium → patch] AD-6 provider-row resolution path (`pdf-import.ts:163-187`: `findForPurpose` row → `createProvider`/`decryptApiKey`, row-sourced `isLocal`/`cloudPdf`) never exercised; every test injects the provider [intent] — confirmed: zero references to `createProvider`/`decryptApiKey`/`llmProviders` in `pdf-import.test.ts`.
- [low → patch] raw `pdfjs` exceptions from corrupt/zero-byte/garbage input escape as non-`AppError` at the use-case boundary — `text-extractor.ts` has no try/catch around `getDocument`; wrapped the extractor call so failures surface as `AppError("Validation", "Unreadable PDF: …")`.
- [low → patch] LLM-supplied `row.pageNumber` trusted over the known page context (`pdf-import.ts:268` `row.pageNumber ?? page.pageNumber`) — schema allows any positive int, so a hallucinated page number mis-stamps `pdfPage`; the source page is known at extraction time.
- [low → patch] dead-code last-4 fallback (`pdf-import.ts:286-289`) double-casts `account as unknown as { accountNumberLast4 }` — `AccountRow` (unit-of-work.ts:280-298) has no such field, so the fallback is always `undefined`; removed, input is the only source.

### Rejected / false

- [false] "new-file hunks land under `Users/sim/dev/pangolin/...`" [blind, intent] — artifact of how the review diff was staged (absolute paths for untracked files); files exist at correct `packages/` paths, exports compile, vitest runs; diff regenerated with repo-relative paths.
- [false] `ImportRowRow.proposal` required→optional weakens the contract [blind, edge] — every writer supplies it (`import-statement.ts:259,272`; `pdf-import.ts:359,433`); readers use truthiness; memory-uow normalizes `proposal ?? null` (memory-uow.ts:512,525).
- [false] preview hardcodes `cloudPdf: true` / `isLocal` default so PermissionDenied "can never be demonstrated" [blind] — byte-identical to the existing `row_interpret` preview (`llm-provider-use-cases.ts:537-541` vs 497-500); preview is a prompt demo; enforcement lives in `buildPdfExtractRequest` and `pdf-import.ts:190-195`.
- [false] closed-account guard skipped for system viewers [blind] — identical to baseline convention (`import-statement.ts:212`).
- [false] reverse-chain rescue lets wrong printed balances pass [blind] — acceptance still gated by check 1 (opening + sum = closing); a wrong printed balance cannot align in reverse order without being self-consistent in some order.
- [low, rejected] document-level `hasTextLayer` sends empty pages of mixed scanned/text PDFs to the LLM [blind, edge] — hallucinated/missing rows are fail-safe blocked by the deterministic checks (the intent's stated protection); a per-page guard adds branches for an uncommon case, and scanned-page visual correction is 5.8 territory; outcome is a blocked batch, never silent corruption.
- [low, rejected] duplicated vision-model lists (`pdf-import.ts` default vs `importers/pdf/model-vision.ts`) [blind, intent] — layering forbids app→importers imports (importers depends on `@pangolin/app`); the lists are behaviorally equivalent today (app regex ⊆ `VISION_MODEL_PATTERNS`; both scanned branches throw anyway); `ctx.isVisionCapableModel` is the injection hook for wiring.
- [false/low subsumed] no magic-byte / strict-base64 / zero-byte validation [blind, edge ×2] — all such inputs fail inside `getDocument` and now surface as `AppError("Validation", "Unreadable PDF: …")` via the error-wrap patch; hashing garbage is harmless.
- [low, rejected] last-4 false rejection when expected value is shorter than 4 digits [edge] — verified at `pdf-verify.ts:67-70,94` the mismatch does fire for e.g. `"34"` vs `"1234"`, but only a caller passing a 2–3-digit expected value reaches it and none exists (the row fallback is always null); fix adds suffix-matching branch intent doesn't ask for.
- [low, rejected] zero-row statements with equal opening/closing staged `ready` [edge] — a 0-transaction statement reconciles legitimately; missing balances already return `missing_balances` (`pdf-verify.ts:76-88`).
- [low, rejected] mock generator mislabels sparse `pageNumber`s ("Page 1 of 2") [edge] — test-only helper; no test passes sparse page numbers.
- [false] baseline lacks `"pdf_extract"` in preview purpose enum / dangling imports [blind] — `llm-provider-use-cases.ts:492` branches on it and the suite typechecks and runs.
- [false] pipeline entry point never invokes `extractAndImportPdfStatement` (R1 reading) [intent] — the ticket tree assigns upload/entry integration to story 5.8 (tickets.toml id 8: "Integrates PDF statement upload into Import popover…"); 5.7's frozen boundary defers the UI; engine + export seam + Settings preview is the asked-for deliverable.
- [false] use case casts `response.data` without schema validation [intent] — real adapters safeParse against the prompt schema (`packages/llm/src/anthropic.ts:289`, `openai.ts`); mocks construct schema-shaped data by design; mirrors the existing `row_interpret` convention.
- [false] staging assertions run against memory-uow surrogate, not the real DB [intent] — repo-wide test convention across all prior stories of this epic.
- [low, rejected] "verification loosenings ratified by tests" (per-row gapCents, last-4 skip) [intent] — last-4 check only fires when an expected value is available, matching the intent's "when available" wording; per-row gap is detail in the failure error.
- [rejected] plan doc inconsistencies (`ticket: 7`, empty sections) [blind] — the fix is to edit this build's plan; `ticket: 7` frontmatter is by design (find's `id`).

### Deferred

- [maybe-false → defer] buffer aliasing: `text-extractor.ts:21-24` passes a `Uint8Array` view over the caller's buffer to `pdfjs` `getDocument`, which may transfer/detach it, invalidating a reused source buffer [blind] — would be medium if true; settled by demonstrating `pdfjs-dist` legacy build detaching (or corrupting) a caller buffer across repeated `extractPdfTextPages` calls.

## Design Notes

Deterministic balance verification is decoupled from LLM inference: the LLM extracts structured fields from text strings, but code independently calculates:
1. `openingBalanceCents + sum(amountCents) === closingBalanceCents`
2. For each row with printed `runningBalanceCents`: `openingBalanceCents + sum(amountCents up to row) === row.runningBalanceCents`
3. `row.postedOn >= startDate && row.postedOn <= endDate`
4. `statement.accountNumberLast4 === expectedAccountLast4`

When all checks pass, data integrity is guaranteed to the cent. If any check fails, the batch is blocked with `reconcile_status = "gap"` and `reconcile_gap_cents = gap`, preserving the extracted rows for visual review in story 5.8.
