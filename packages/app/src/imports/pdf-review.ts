// The PDF statement review (story 8, AD-11, AD-17): the `import.pdf_failed` kind, inline
// corrections to a failed statement batch's staged rows, and a deterministic Re-check that needs
// no second LLM pass (the header is saved on the batch). Nothing here imports `pdf-import.ts`.
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { AttachmentContext, UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import type { ImportBatchRow, ReadRepos } from "../ports/unit-of-work.ts";
import { defineReviewKind, resolveReviewItem } from "../system/review-items.ts";
import { write } from "../write.ts";
import {
  type StatementVerificationResult,
  type VerifiableStatementRow,
  verifyStatementBalances,
} from "./pdf-verify.ts";

/** A PDF statement batch failed its deterministic checks. Account scope; entity `import_batch:<id>`. */
export const IMPORT_PDF_FAILED_REVIEW = defineReviewKind({
  kind: "import.pdf_failed",
  module: "imports",
  scope: "account",
});

export const pdfFailedEntityRef = (batchId: string): string => `import_batch:${batchId}`;
export const pdfFailedDedupeKey = (batchId: string): string => `import.pdf_failed:${batchId}`;

/** Dedupe key for the `classify.unclassified` item raised for transaction `txnId`. */
export const classifyUnclassifiedDedupeKey = (txnId: string): string =>
  `classify.unclassified:${txnId}`;

/** Dedupe key for the `import.set_aside` item raised for import batch `batchId`. */
export const setAsideDedupeKey = (batchId: string): string => `import.set_aside:${batchId}`;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

/** The corrected values of one extracted statement row, kept as JSON in `import_row.proposal`. */
export const pdfRowProposalSchema = z.object({
  postedOn: isoDate,
  amountCents: z.number().int(),
  description: z.string().trim().min(1).max(500),
  runningBalanceCents: z.number().int().nullish(),
});
export type PdfRowProposal = z.infer<typeof pdfRowProposalSchema>;

function proposalJson(proposal: PdfRowProposal): string {
  return JSON.stringify({
    postedOn: proposal.postedOn,
    amountCents: proposal.amountCents,
    description: proposal.description,
    ...(proposal.runningBalanceCents === null || proposal.runningBalanceCents === undefined
      ? {}
      : { runningBalanceCents: proposal.runningBalanceCents }),
  });
}

/** The batch's extraction header, saved so Re-check needs no second LLM pass; null when absent. */
export const pdfStatementMetaSchema = z.object({
  startDate: isoDate.nullish(),
  endDate: isoDate.nullish(),
  accountNumberLast4: z.string().nullish(),
});
export type PdfStatementMeta = z.infer<typeof pdfStatementMetaSchema>;

export function pdfStatementMetaJson(meta: PdfStatementMeta): string {
  return JSON.stringify({
    ...(meta.startDate === null || meta.startDate === undefined
      ? {}
      : { startDate: meta.startDate }),
    ...(meta.endDate === null || meta.endDate === undefined ? {} : { endDate: meta.endDate }),
    ...(meta.accountNumberLast4 === null || meta.accountNumberLast4 === undefined
      ? {}
      : { accountNumberLast4: meta.accountNumberLast4 }),
  });
}

function parseStatementMeta(batch: ImportBatchRow): PdfStatementMeta {
  if (batch.statementMeta == null) return {};
  try {
    const parsed = pdfStatementMetaSchema.safeParse(JSON.parse(batch.statementMeta));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * The values a staged PDF row asserts: its saved proposal, or — leniently — the raw line
 * (`"2024-09-05, DESCRIPTION, -2000"`) the extractor wrote. Null when neither can be read.
 * Exported so the review card shows the same values Re-check would use.
 */
export function pdfRowValues(row: {
  readonly proposal?: string | null;
  readonly rawLine: string;
}): PdfRowProposal | null {
  if (row.proposal) {
    try {
      const parsed = pdfRowProposalSchema.safeParse(JSON.parse(row.proposal));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through to the raw line
    }
  }
  const firstComma = row.rawLine.indexOf(",");
  const lastComma = row.rawLine.lastIndexOf(",");
  if (firstComma <= 0 || lastComma <= firstComma) return null;
  const postedOn = row.rawLine.slice(0, firstComma).trim();
  const amountCents = Number(row.rawLine.slice(lastComma + 1).trim());
  const description = row.rawLine.slice(firstComma + 1, lastComma).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postedOn) || !Number.isInteger(amountCents) || description === "")
    return null;
  return { postedOn, amountCents, description };
}

/** The live staged rows of a failed PDF batch, oldest first; `NotFound` for any other batch. */
function failedPdfBatch(ctx: UseCaseContext, repos: ReadRepos, batchId: string): ImportBatchRow {
  const batch = repos.importBatches.find(ctx.viewer, batchId);
  if (batch === undefined) throw new AppError("NotFound", "Import batch not found");
  return batch;
}

/** A failed statement batch as the card reads it: the staged rows beside their reasons. */
export interface PdfReviewRow {
  readonly id: Id<"ImportRow">;
  readonly rowNumber: number;
  readonly rawLine: string;
  readonly reason: string | null;
  readonly pdfPage: number | null;
  readonly proposal: string | null;
}

export const listPdfRowsInput = z.object({ batchId: idInput }).strict();
export type ListPdfRowsInput = z.input<typeof listPdfRowsInput>;

/**
 * The staged rows of a failed `statement_pdf` batch, for the review card. `NotFound` when the
 * batch is gone or its account is not visible (AD-3).
 */
export function listPdfRowsForBatch(
  ctx: UseCaseContext,
  input: ListPdfRowsInput | string,
): PdfReviewRow[] {
  const parsed = parseInput(
    listPdfRowsInput,
    typeof input === "string" ? { batchId: input } : input,
  );
  return ctx.uow.read((repos) => {
    const batch = failedPdfBatch(ctx, repos, parsed.batchId);
    if (batch.source !== "statement_pdf" || batch.status !== "failed" || batch.undoneAt !== null)
      return [];
    return repos.importRows
      .listForBatch(ctx.viewer, batch.id)
      .filter((row) => row.status === "staged")
      .map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber,
        rawLine: row.rawLine,
        reason: row.reason,
        pdfPage: row.pdfPage,
        proposal: row.proposal ?? null,
      }));
  });
}

/** The stored statement file itself: the decrypted bytes, always `application/pdf`. */
export interface PdfStatementFile {
  readonly contentType: "application/pdf";
  readonly bytes: Uint8Array;
}

/**
 * `imports.getPdfStatementFile`: the batch's stored PDF. PDFs are read only through their batch
 * row, viewer-scoped (AD-3, AD-21) — never by raw store name. `NotFound` when the viewer cannot
 * see the batch or it has no file; a tampered store read surfaces as its own error.
 */
export function readPdfStatementFile(
  ctx: AttachmentContext,
  input: ListPdfRowsInput | string,
): PdfStatementFile {
  const parsed = parseInput(
    listPdfRowsInput,
    typeof input === "string" ? { batchId: input } : input,
  );
  const name = ctx.uow.read((repos) => {
    const batch = repos.importBatches.find(ctx.viewer, parsed.batchId);
    if (batch === undefined || batch.attachmentId == null) return null;
    return repos.attachments.find(batch.attachmentId)?.name ?? null;
  });
  if (name === null) throw new AppError("NotFound", "Statement file not found");
  return { contentType: "application/pdf", bytes: ctx.attachments.get(name) };
}

export const correctPdfRowInput = z
  .object({
    rowId: idInput,
    postedOn: isoDate.optional(),
    amountCents: z.number().int().optional(),
    description: z.string().trim().min(1).max(500).optional(),
    runningBalanceCents: z.number().int().nullish(),
  })
  .strict()
  .refine(
    (data) =>
      data.postedOn !== undefined ||
      data.amountCents !== undefined ||
      data.description !== undefined ||
      data.runningBalanceCents !== undefined,
    { message: "At least one field is required" },
  );
export type CorrectPdfRowInput = z.input<typeof correctPdfRowInput>;

export interface CorrectPdfRowResult {
  readonly rowId: Id<"ImportRow">;
  readonly proposal: PdfRowProposal;
}

/**
 * `imports.correctPdfRow`: records a correction on one staged row of a failed `statement_pdf`
 * batch. Only the proposal changes — the row stays staged with its reason until Re-check passes.
 * Anything else is `Validation`; a row or batch the viewer cannot see is `NotFound`.
 */
export function correctPdfRow(ctx: UseCaseContext, input: CorrectPdfRowInput): CorrectPdfRowResult {
  const parsed = parseInput(correctPdfRowInput, input);
  return write(ctx, (tx, audit) => {
    const row = tx.importRows.find(ctx.viewer, parsed.rowId);
    if (row === undefined) throw new AppError("NotFound", "Import row not found");
    const batch = tx.importBatches.find(ctx.viewer, row.batchId);
    if (batch === undefined) throw new AppError("NotFound", "Import batch not found");
    if (
      row.status !== "staged" ||
      batch.status !== "failed" ||
      batch.source !== "statement_pdf" ||
      batch.undoneAt !== null
    ) {
      throw new AppError(
        "Validation",
        "Only a staged row of a failed PDF statement batch can be corrected",
      );
    }
    const base = pdfRowValues(row);
    if (base === null) {
      throw new AppError("Validation", `Row ${row.rowNumber} could not be read`);
    }
    const proposal: PdfRowProposal = {
      postedOn: parsed.postedOn ?? base.postedOn,
      amountCents: parsed.amountCents ?? base.amountCents,
      description: parsed.description ?? base.description,
      runningBalanceCents:
        parsed.runningBalanceCents === undefined
          ? (base.runningBalanceCents ?? null)
          : parsed.runningBalanceCents,
    };
    const json = proposalJson(proposal);
    const at = formatInstant(ctx.clock.now());
    tx.importRows.updateProposal(row.id, json, at);
    audit({
      entity: "import_row",
      entityId: row.id,
      accountId: batch.accountId,
      action: "update",
      before: row,
      after: { ...row, proposal: json, updatedAt: at },
    });
    return { rowId: row.id, proposal };
  });
}

export const recheckPdfStatementInput = z.object({ batchId: idInput }).strict();
export type RecheckPdfStatementInput = z.input<typeof recheckPdfStatementInput>;

export interface RecheckPdfStatementResult {
  readonly batchId: Id<"ImportBatch">;
  /** False with the exact remaining error when the deterministic checks still fail. */
  readonly ok: boolean;
  readonly error: string | null;
  readonly verification: StatementVerificationResult;
}

/**
 * `imports.recheckPdfStatement`: re-runs the deterministic checks of story 5.7 (no LLM) against
 * the corrected rows (proposals, falling back to the raw lines) and the saved header. A passing
 * batch becomes `ready`/`ok` with its row reasons cleared and its review item resolved; a failing
 * one is returned with its exact error and changes nothing. A batch the viewer cannot see is
 * `NotFound`; any other batch is `Validation`.
 */
export function recheckPdfStatement(
  ctx: UseCaseContext,
  input: RecheckPdfStatementInput,
): RecheckPdfStatementResult {
  const parsed = parseInput(recheckPdfStatementInput, input);
  const { batch, rows, verification } = ctx.uow.read((repos) => {
    const batch = failedPdfBatch(ctx, repos, parsed.batchId);
    if (batch.source !== "statement_pdf" || batch.undoneAt !== null) {
      throw new AppError("Validation", "Only a PDF statement batch can be re-checked");
    }
    if (batch.status !== "failed") {
      throw new AppError("Validation", "This batch has already been verified");
    }
    const rows = repos.importRows
      .listForBatch(ctx.viewer, batch.id)
      .filter((row) => row.status === "staged");
    const header = parseStatementMeta(batch);
    const values: (PdfRowProposal & { rowNumber: number })[] = [];
    for (const row of rows) {
      const value = pdfRowValues(row);
      if (value === null) {
        return {
          batch,
          rows,
          verification: {
            ok: false as const,
            gapCents: 0,
            reasonCode: "missing_balances" as const,
            error: `Row ${row.rowNumber} could not be read; correct it first`,
          },
        };
      }
      values.push({ ...value, rowNumber: row.rowNumber });
    }
    const verifiable: VerifiableStatementRow[] = values.map((v) => ({
      rowNumber: v.rowNumber,
      postedOn: v.postedOn,
      amountCents: v.amountCents,
      runningBalanceCents: v.runningBalanceCents ?? null,
    }));
    const verification = verifyStatementBalances({
      openingBalanceCents: batch.openingBalanceCents,
      closingBalanceCents: batch.closingBalanceCents,
      accountNumberLast4: header.accountNumberLast4 ?? null,
      expectedAccountLast4: null,
      startDate: header.startDate ?? null,
      endDate: header.endDate ?? null,
      rows: verifiable,
    });
    return { batch, rows, verification };
  });

  if (!verification.ok) {
    return { batchId: batch.id, ok: false, error: verification.error, verification };
  }

  write(ctx, (tx, audit) => {
    const at = formatInstant(ctx.clock.now());
    const posted = rows.map((row) => {
      const value = pdfRowValues(row);
      return value === null ? null : value.postedOn;
    });
    const knownDates = posted.filter((d): d is string => d !== null);
    const dates =
      knownDates.length === 0
        ? {}
        : {
            firstPostedOn: knownDates.reduce((min, d) => (d < min ? d : min)),
            lastPostedOn: knownDates.reduce((max, d) => (d > max ? d : max)),
          };
    tx.importBatches.updateCountsAndStatus(
      batch.id,
      {
        newCount: batch.rowCount,
        status: "ready",
        reconcileStatus: "ok",
        reconcileGapCents: 0,
        openingBalanceCents: verification.openingBalanceCents,
        closingBalanceCents: verification.closingBalanceCents,
        ...dates,
      },
      at,
    );
    audit({
      entity: "import_batch",
      entityId: batch.id,
      accountId: batch.accountId,
      action: "update",
      before: batch,
      after: {
        ...batch,
        newCount: batch.rowCount,
        status: "ready",
        reconcileStatus: "ok",
        reconcileGapCents: 0,
        openingBalanceCents: verification.openingBalanceCents,
        closingBalanceCents: verification.closingBalanceCents,
        ...dates,
        updatedAt: at,
      },
    });
    for (const row of rows) {
      if (row.reason === null) continue;
      tx.importRows.updateStatus(row.id, "staged", at, null);
      audit({
        entity: "import_row",
        entityId: row.id,
        accountId: batch.accountId,
        action: "update",
        before: row,
        after: { ...row, reason: null, updatedAt: at },
      });
    }
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: pdfFailedDedupeKey(batch.id),
      resolution: "verified on re-check",
    });
  });

  return { batchId: batch.id, ok: true, error: null, verification };
}
