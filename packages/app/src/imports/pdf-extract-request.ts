import { Temporal } from "@pangolin/shared/temporal";
import { z } from "zod";
import { AppError } from "../errors.ts";
import type { StructuredPrompt } from "../ports/llm-provider.ts";

export const PDF_EXTRACT_PROMPT_VERSION = "2026-10-27.1";

export const pdfExtractRowSchema = z.object({
  postedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date")
    .refine((d) => {
      try {
        Temporal.PlainDate.from(d);
        return true;
      } catch {
        return false;
      }
    }, "Invalid calendar date"),
  description: z.string().trim().min(1).max(500),
  amountCents: z.number().int(),
  runningBalanceCents: z.number().int().nullish(),
  pageNumber: z.number().int().positive().optional(),
});
export type PdfExtractRow = z.infer<typeof pdfExtractRowSchema>;

export const pdfExtractPageSchema = z.object({
  accountNumberLast4: z.string().trim().nullish(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date")
    .refine((d) => {
      try {
        Temporal.PlainDate.from(d);
        return true;
      } catch {
        return false;
      }
    }, "Invalid calendar date")
    .nullish(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date")
    .refine((d) => {
      try {
        Temporal.PlainDate.from(d);
        return true;
      } catch {
        return false;
      }
    }, "Invalid calendar date")
    .nullish(),
  openingBalanceCents: z.number().int().nullish(),
  closingBalanceCents: z.number().int().nullish(),
  rows: z.array(pdfExtractRowSchema),
});
export type PdfExtractPage = z.infer<typeof pdfExtractPageSchema>;

export interface BuildPdfExtractRequestInput {
  readonly pageNumber: number;
  readonly pageText: string;
  readonly isLocal: boolean;
  readonly cloudPdf?: boolean | undefined;
  readonly model?: string | undefined;
}

/**
 * Shared request builder for PDF statement extraction (AD-6).
 *
 * Enforces AD-6 privacy sanitiser:
 * - Local by default. Non-local / cloud providers require explicit `cloud_pdf` opt-in.
 */
export function buildPdfExtractRequest(
  input: BuildPdfExtractRequestInput,
): StructuredPrompt<PdfExtractPage> {
  if (!input.isLocal && !input.cloudPdf) {
    throw new AppError(
      "PermissionDenied",
      "Cloud provider not permitted for PDF extraction without cloud_pdf opt-in",
    );
  }

  const systemPrompt =
    "You are a precise financial document extraction engine. Extract structured statement header data and transaction rows from the provided bank statement page text. Return JSON matching the schema.";

  const prompt = `Extract all statement information and transaction rows from page ${input.pageNumber}:

--- STATEMENT PAGE ${input.pageNumber} TEXT ---
${input.pageText}
--- END STATEMENT PAGE TEXT ---

Extraction guidelines:
- If present on this page, extract the last 4 digits of the account number, statement start and end dates (YYYY-MM-DD), opening balance in integer cents, and closing balance in integer cents.
- Extract every transaction row printed on this page into the rows list.
- For each row, extract postedOn date (YYYY-MM-DD), clean transaction description, amount in integer cents (positive for deposits/credits, negative for debits/payments/fees), running balance if printed (in integer cents), and set pageNumber to ${input.pageNumber}.
- Never invent or hallucinate transactions not present in the text.`;

  return {
    schemaName: "pdf_extract",
    schemaDescription: "PDF bank statement page structured extraction",
    schema: pdfExtractPageSchema,
    systemPrompt,
    prompt,
    ...(input.model !== undefined ? { model: input.model } : {}),
  };
}
