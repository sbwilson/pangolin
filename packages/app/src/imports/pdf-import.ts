import { createHash } from "node:crypto";
import type { Id } from "@pangolin/shared";
import { isVisionCapableModel } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { AttachmentContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import type { LlmProvider } from "../ports/llm-provider.ts";
import { providerSetting } from "../ports/llm-provider.ts";
import type {
  AttachmentRow,
  ImportBatchRow,
  ImportBatchStatus,
  ImportRowRow,
  LlmProviderRow,
  ReconcileStatus,
  TxRepos,
} from "../ports/unit-of-work.ts";
import { raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import { write } from "../write.ts";
import {
  buildPdfExtractRequest,
  type PdfExtractPage,
  type PdfExtractRow,
} from "./pdf-extract-request.ts";
import {
  IMPORT_PDF_FAILED_REVIEW,
  pdfFailedDedupeKey,
  pdfFailedEntityRef,
  pdfStatementMetaJson,
} from "./pdf-review.ts";
import { type StatementVerificationResult, verifyStatementBalances } from "./pdf-verify.ts";

export interface ExtractedPdfPageItem {
  readonly pageNumber: number;
  readonly text: string;
}

export interface PdfTextExtractionPayload {
  readonly pages: readonly ExtractedPdfPageItem[];
  readonly hasTextLayer: boolean;
  readonly pageCount: number;
}

export type PdfTextExtractor = (
  data: Uint8Array | Buffer | ArrayBuffer,
) => Promise<PdfTextExtractionPayload>;

export type VisionModelClassifier = (model: string) => boolean;

export const extractAndImportPdfStatementInput = z.object({
  accountId: idInput,
  pdfData: z
    .custom<Uint8Array | Buffer | string>(
      (val) => val instanceof Uint8Array || Buffer.isBuffer(val) || typeof val === "string",
      { message: "Expected PDF data as Buffer, Uint8Array, or base64/binary string" },
    )
    .optional(),
  content: z
    .custom<Uint8Array | Buffer | string>(
      (val) => val instanceof Uint8Array || Buffer.isBuffer(val) || typeof val === "string",
      { message: "Expected PDF data as Buffer, Uint8Array, or base64/binary string" },
    )
    .optional(),
  expectedAccountLast4: z.string().optional().nullable(),
});

export type ExtractAndImportPdfStatementInput = z.input<typeof extractAndImportPdfStatementInput>;

export interface PdfImportContext extends AttachmentContext {
  readonly provider?: LlmProvider | undefined;
  readonly providerIsLocal?: boolean | undefined;
  readonly providerCloudPdf?: boolean | undefined;
  readonly providerModel?: string | undefined;
  readonly resolveProvider?: ((row: LlmProviderRow) => LlmProvider) | undefined;
  readonly authSecret?: string | undefined;
  readonly decryptApiKey?: ((ciphertext: string, secret: string) => string) | undefined;
  readonly createProvider?: ((row: LlmProviderRow, apiKey?: string) => LlmProvider) | undefined;
  readonly extractPdfTextPages?: PdfTextExtractor | undefined;
  readonly isVisionCapableModel?: VisionModelClassifier | undefined;
}

export interface ExtractAndImportPdfStatementOptions {
  readonly extractPdfTextPages?: PdfTextExtractor | undefined;
  readonly isVisionCapableModel?: VisionModelClassifier | undefined;
  readonly provider?: LlmProvider | undefined;
}

export interface ExtractAndImportPdfStatementResult {
  readonly batchId: Id<"ImportBatch">;
  readonly status: ImportBatchStatus;
  readonly rowCount: number;
  readonly newCount: number;
  readonly dupCount: number;
  readonly reconcileStatus: ReconcileStatus;
  readonly reconcileGapCents: number;
  readonly openingBalanceCents?: number | null | undefined;
  readonly closingBalanceCents?: number | null | undefined;
  readonly verification?: StatementVerificationResult | undefined;
}

/** The deduped `attachment` row for `name`, created on first sight (the createHandoff pattern). */
function ensureAttachmentRow(
  tx: TxRepos,
  ctx: PdfImportContext,
  name: string,
  bytes: number,
  at: string,
): Id<"Attachment"> {
  const existing = tx.attachments.findByName(name);
  if (existing !== undefined) return existing.id;
  const row: AttachmentRow = {
    id: ctx.newId<"Attachment">(),
    name,
    mime: "application/pdf",
    bytes,
    createdAt: at,
  };
  tx.attachments.insert(row);
  return row.id;
}

/** After a failed write: delete the file again unless another row links the same content. */
function removeUnlinkedAttachment(ctx: AttachmentContext, name: string): void {
  try {
    const orphan = write(ctx, (tx) => tx.attachments.findByName(name) === undefined);
    if (orphan) ctx.attachments.remove(name);
  } catch {
    // Best effort: the original error is the one to report.
  }
}

function rowProposalJson(row: PdfExtractRow): string {
  return JSON.stringify({
    postedOn: row.postedOn,
    amountCents: row.amountCents,
    description: row.description,
    ...(row.runningBalanceCents === null || row.runningBalanceCents === undefined
      ? {}
      : { runningBalanceCents: row.runningBalanceCents }),
  });
}

/**
 * Extracts bank statement text, invokes page-by-page LLM extraction, performs deterministic
 * balance verification to protect against hallucinations, stages passing batches in import_batch / import_row,
 * and blocks batches with exact balance gaps on discrepancies (AD-1, AD-2, AD-6, AD-19).
 */
export async function extractAndImportPdfStatement(
  ctx: PdfImportContext,
  input: ExtractAndImportPdfStatementInput,
  options?: ExtractAndImportPdfStatementOptions,
): Promise<ExtractAndImportPdfStatementResult> {
  const parsed = parseInput(extractAndImportPdfStatementInput, input);

  const rawData = parsed.pdfData ?? parsed.content;
  if (!rawData) {
    throw new AppError("Validation", "PDF statement data cannot be empty");
  }

  const uint8: Uint8Array =
    rawData instanceof Uint8Array
      ? rawData
      : Buffer.isBuffer(rawData)
        ? new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength)
        : typeof rawData === "string"
          ? new Uint8Array(Buffer.from(rawData, "base64"))
          : new Uint8Array(rawData);

  const fileSha256 = createHash("sha256").update(uint8).digest("hex");

  // 1. Read account, LLM provider configuration, and check existing batch upfront (AD-2, AD-20)
  const { account, providerRow, existingBatch } = ctx.uow.read((repos) => {
    const a = repos.accounts.findVisible(ctx.viewer, parsed.accountId);
    if (!a) {
      throw new AppError("NotFound", "Account not found");
    }
    const p = repos.llmProviders.findForPurpose("pdf_extract");
    const b = repos.importBatches.findByAccountAndFileSha(ctx.viewer, a.id, fileSha256);
    return { account: a, providerRow: p, existingBatch: b };
  });

  // Upfront duplicate check: return immediately if an existing non-failed batch exists
  if (existingBatch && existingBatch.undoneAt === null && existingBatch.status !== "failed") {
    return {
      batchId: existingBatch.id,
      status: existingBatch.status,
      rowCount: existingBatch.rowCount,
      newCount: 0,
      dupCount: existingBatch.rowCount,
      reconcileStatus: existingBatch.reconcileStatus ?? "ok",
      reconcileGapCents: existingBatch.reconcileGapCents ?? 0,
      openingBalanceCents: existingBatch.openingBalanceCents,
      closingBalanceCents: existingBatch.closingBalanceCents,
    };
  }

  // 2. Resolve LLM provider and AD-6 privacy guardrails
  let provider: LlmProvider;
  let isLocal: boolean;
  let cloudPdf: boolean;
  let model: string | undefined;

  const passedProvider = options?.provider ?? ctx.provider;
  if (passedProvider) {
    provider = passedProvider;
    isLocal = providerSetting(ctx.providerIsLocal, providerRow?.isLocal, false);
    cloudPdf = providerSetting(ctx.providerCloudPdf, providerRow?.cloudPdf, false);
    model = providerSetting(ctx.providerModel, providerRow?.model, undefined);
  } else if (providerRow) {
    isLocal = providerRow.isLocal;
    cloudPdf = providerRow.cloudPdf;
    model = providerRow.model;
    if (ctx.resolveProvider) {
      provider = ctx.resolveProvider(providerRow);
    } else if (ctx.createProvider) {
      let apiKey: string | undefined;
      if (providerRow.apiKeyCiphertext) {
        if (!ctx.decryptApiKey || !ctx.authSecret) {
          throw new AppError("Validation", "Cannot decrypt API key");
        }
        try {
          apiKey = ctx.decryptApiKey(providerRow.apiKeyCiphertext, ctx.authSecret);
        } catch (err) {
          throw new AppError("Validation", "Cannot decrypt API key", { cause: err });
        }
      }
      provider = ctx.createProvider(providerRow, apiKey);
    } else {
      throw new AppError("Validation", "Provider adapter factory not configured");
    }
  } else {
    throw new AppError("Validation", "No LLM provider configured for PDF extraction");
  }

  // AD-6: Cloud provider requires explicit cloud_pdf opt-in
  if (!isLocal && !cloudPdf) {
    throw new AppError(
      "PermissionDenied",
      "Cloud provider not permitted for PDF extraction without cloud_pdf opt-in",
    );
  }

  // 3. Extract text layer from PDF
  const textExtractor = options?.extractPdfTextPages ?? ctx.extractPdfTextPages;
  if (!textExtractor) {
    throw new AppError("Validation", "PDF text extractor not configured");
  }

  let extraction: PdfTextExtractionPayload;
  try {
    // pdf.js transfers the bytes it is handed to its worker, detaching the caller's buffer;
    // the encrypted store below needs the file, so the extractor gets a copy.
    extraction = await textExtractor(uint8.slice(0));
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError("Validation", `Unreadable PDF: ${message}`, { cause: err });
  }

  // Vision fallback rejection for scanned PDFs lacking a text layer
  if (!extraction.hasTextLayer) {
    const configuredModel = model ?? "unknown";
    const visionClassifier =
      options?.isVisionCapableModel ?? ctx.isVisionCapableModel ?? isVisionCapableModel;
    const isVision = visionClassifier(configuredModel);

    if (!isVision) {
      throw new AppError(
        "Validation",
        `Scanned PDF statements without a text layer require a vision-capable model. The configured model "${configuredModel}" does not support vision.`,
      );
    }

    throw new AppError(
      "Validation",
      "Vision statement extraction is not yet supported in this version",
    );
  }

  // 4. Page-by-page LLM extraction into structured schema
  let statementOpeningBalanceCents: number | null = null;
  let statementClosingBalanceCents: number | null = null;
  let statementStartDate: string | null = null;
  let statementEndDate: string | null = null;
  let statementAccountLast4: string | null = null;
  const allExtractedRows: (PdfExtractRow & { pageNumber: number })[] = [];

  for (const page of extraction.pages) {
    const prompt = buildPdfExtractRequest({
      pageNumber: page.pageNumber,
      pageText: page.text,
      isLocal,
      cloudPdf,
      model,
    });

    const response = await provider.generateStructured(prompt);
    const data: PdfExtractPage = response.data;

    if (
      statementOpeningBalanceCents === null &&
      data.openingBalanceCents !== null &&
      data.openingBalanceCents !== undefined
    ) {
      statementOpeningBalanceCents = data.openingBalanceCents;
    }
    if (data.closingBalanceCents !== null && data.closingBalanceCents !== undefined) {
      statementClosingBalanceCents = data.closingBalanceCents;
    }
    if (statementStartDate === null && data.startDate) {
      statementStartDate = data.startDate;
    }
    if (data.endDate) {
      statementEndDate = data.endDate;
    }
    if (statementAccountLast4 === null && data.accountNumberLast4) {
      statementAccountLast4 = data.accountNumberLast4;
    }

    for (const row of data.rows) {
      allExtractedRows.push({
        ...row,
        pageNumber: page.pageNumber,
      });
    }
  }

  // Check closed account lock (closedOn)
  const closedOn = ctx.viewer.kind === "system" ? null : account.closedOn;
  if (closedOn !== null) {
    const hasLocked = allExtractedRows.some((r) => r.postedOn > closedOn);
    if (hasLocked) {
      throw new AppError(
        "Validation",
        `Cannot import transactions dated after account closed on ${closedOn}`,
      );
    }
  }

  // 5. Deterministic balance verification checks
  const expectedAccountLast4 = parsed.expectedAccountLast4 ?? null;

  const verification = verifyStatementBalances({
    openingBalanceCents: statementOpeningBalanceCents,
    closingBalanceCents: statementClosingBalanceCents,
    accountNumberLast4: statementAccountLast4,
    expectedAccountLast4,
    startDate: statementStartDate,
    endDate: statementEndDate,
    rows: allExtractedRows.map((r, idx) => ({
      rowNumber: idx + 1,
      postedOn: r.postedOn,
      amountCents: r.amountCents,
      runningBalanceCents: r.runningBalanceCents,
    })),
  });

  const firstRow = allExtractedRows[0];
  const minPostedOn = firstRow
    ? allExtractedRows.reduce((min, r) => (r.postedOn < min ? r.postedOn : min), firstRow.postedOn)
    : null;
  const maxPostedOn = firstRow
    ? allExtractedRows.reduce((max, r) => (r.postedOn > max ? r.postedOn : max), firstRow.postedOn)
    : null;

  // 6. Store the encrypted statement file (AD-21) before staging, then stage (AD-1, AD-2).
  const attachmentName = ctx.attachments.put(uint8);
  const statementMeta = pdfStatementMetaJson({
    startDate: statementStartDate,
    endDate: statementEndDate,
    accountNumberLast4: statementAccountLast4,
  });

  if (!verification.ok) {
    // Failing verification blocks the batch with status = "failed" and reconcileStatus = "gap"
    let racedNonFailedBatch: ImportBatchRow | null = null;
    try {
      racedNonFailedBatch = write(ctx, (tx, audit) => {
        const at = formatInstant(ctx.clock.now());

        // If an existing failed batch exists, replace it to avoid unique constraint collisions
        const existing = tx.importBatches.findByAccountAndFileSha(
          ctx.viewer,
          account.id,
          fileSha256,
        );
        if (existing && existing.undoneAt === null) {
          if (existing.status !== "failed") {
            return existing;
          }
          tx.importBatches.markUndone(existing.id, at);
          // The replaced attempt's review item closes with it (AD-17).
          resolveReviewItem(tx, audit, ctx, {
            dedupeKey: pdfFailedDedupeKey(existing.id),
            resolution: "replaced by a new upload",
          });
          audit({
            entity: "import_batch",
            entityId: existing.id,
            accountId: existing.accountId,
            action: "update",
            before: existing,
            after: { ...existing, undoneAt: at, updatedAt: at },
          });
        }

        const batchId = ctx.newId<"ImportBatch">();
        const attachmentId = ensureAttachmentRow(tx, ctx, attachmentName, uint8.byteLength, at);

        const batchRow: ImportBatchRow = {
          id: batchId,
          accountId: account.id,
          source: "statement_pdf",
          fileSha256,
          rowCount: allExtractedRows.length,
          newCount: 0,
          dupCount: 0,
          status: "failed",
          importedByPersonId: ctx.viewer.kind === "person" ? ctx.viewer.personId : null,
          undoneAt: null,
          reconcileStatus: "gap",
          reconcileGapCents: verification.gapCents,
          openingBalanceCents: statementOpeningBalanceCents,
          closingBalanceCents: statementClosingBalanceCents,
          firstPostedOn: minPostedOn,
          lastPostedOn: maxPostedOn,
          attachmentId,
          statementMeta,
          createdAt: at,
          updatedAt: at,
        };
        tx.importBatches.insert(batchRow);

        const stagedRows: ImportRowRow[] = allExtractedRows.map((r, idx) => {
          const rowNum = idx + 1;
          return {
            id: ctx.newId<"ImportRow">(),
            batchId,
            rowNumber: rowNum,
            rawLine: `${r.postedOn}, ${r.description}, ${r.amountCents}`,
            status: "staged",
            reason: verification.error,
            proposal: rowProposalJson(r),
            pdfPage: r.pageNumber,
            createdAt: at,
            updatedAt: at,
          };
        });
        tx.importRows.insertMany(stagedRows);

        audit({
          entity: "import_batch",
          entityId: batchId,
          action: "create",
          before: null,
          after: batchRow,
        });
        raiseReviewItem(tx, audit, ctx, {
          kind: IMPORT_PDF_FAILED_REVIEW,
          entityRef: pdfFailedEntityRef(batchId),
          dedupeKey: pdfFailedDedupeKey(batchId),
          accountId: account.id,
        });

        return null;
      });
    } catch (error) {
      removeUnlinkedAttachment(ctx, attachmentName);
      throw error;
    }

    if (racedNonFailedBatch) {
      removeUnlinkedAttachment(ctx, attachmentName);
      return {
        batchId: racedNonFailedBatch.id,
        status: racedNonFailedBatch.status,
        rowCount: racedNonFailedBatch.rowCount,
        newCount: 0,
        dupCount: racedNonFailedBatch.rowCount,
        reconcileStatus: racedNonFailedBatch.reconcileStatus ?? "ok",
        reconcileGapCents: racedNonFailedBatch.reconcileGapCents ?? 0,
        openingBalanceCents: racedNonFailedBatch.openingBalanceCents,
        closingBalanceCents: racedNonFailedBatch.closingBalanceCents,
      };
    }

    throw new AppError("Validation", verification.error);
  }

  // Passing verification stages the batch with status = "ready", reconcileStatus = "ok"
  try {
    return write(ctx, (tx, audit) => {
      const at = formatInstant(ctx.clock.now());
      const existing = tx.importBatches.findByAccountAndFileSha(ctx.viewer, account.id, fileSha256);
      if (existing && existing.undoneAt === null) {
        if (existing.status !== "failed") {
          return {
            batchId: existing.id,
            status: existing.status,
            rowCount: existing.rowCount,
            newCount: 0,
            dupCount: existing.rowCount,
            reconcileStatus: existing.reconcileStatus ?? "ok",
            reconcileGapCents: existing.reconcileGapCents ?? 0,
            openingBalanceCents: existing.openingBalanceCents,
            closingBalanceCents: existing.closingBalanceCents,
            verification,
          };
        }
        // If previous attempt had failed, replace it
        tx.importBatches.markUndone(existing.id, at);
        resolveReviewItem(tx, audit, ctx, {
          dedupeKey: pdfFailedDedupeKey(existing.id),
          resolution: "replaced by a new upload",
        });
        audit({
          entity: "import_batch",
          entityId: existing.id,
          accountId: existing.accountId,
          action: "update",
          before: existing,
          after: { ...existing, undoneAt: at, updatedAt: at },
        });
      }

      const batchId = ctx.newId<"ImportBatch">();
      const attachmentId = ensureAttachmentRow(tx, ctx, attachmentName, uint8.byteLength, at);

      const batchRow: ImportBatchRow = {
        id: batchId,
        accountId: account.id,
        source: "statement_pdf",
        fileSha256,
        rowCount: allExtractedRows.length,
        newCount: allExtractedRows.length,
        dupCount: 0,
        status: "ready",
        importedByPersonId: ctx.viewer.kind === "person" ? ctx.viewer.personId : null,
        undoneAt: null,
        reconcileStatus: "ok",
        reconcileGapCents: 0,
        openingBalanceCents: verification.openingBalanceCents,
        closingBalanceCents: verification.closingBalanceCents,
        firstPostedOn: minPostedOn,
        lastPostedOn: maxPostedOn,
        attachmentId,
        statementMeta,
        createdAt: at,
        updatedAt: at,
      };
      tx.importBatches.insert(batchRow);

      const stagedRows: ImportRowRow[] = allExtractedRows.map((r, idx) => ({
        id: ctx.newId<"ImportRow">(),
        batchId,
        rowNumber: idx + 1,
        rawLine: `${r.postedOn}, ${r.description}, ${r.amountCents}`,
        status: "staged",
        reason: null,
        proposal: null,
        pdfPage: r.pageNumber,
        createdAt: at,
        updatedAt: at,
      }));
      tx.importRows.insertMany(stagedRows);

      audit({
        entity: "import_batch",
        entityId: batchId,
        action: "create",
        before: null,
        after: batchRow,
      });

      return {
        batchId,
        status: "ready",
        rowCount: allExtractedRows.length,
        newCount: allExtractedRows.length,
        dupCount: 0,
        reconcileStatus: "ok",
        reconcileGapCents: 0,
        openingBalanceCents: verification.openingBalanceCents,
        closingBalanceCents: verification.closingBalanceCents,
        verification,
      };
    });
  } catch (error) {
    removeUnlinkedAttachment(ctx, attachmentName);
    throw error;
  }
}
