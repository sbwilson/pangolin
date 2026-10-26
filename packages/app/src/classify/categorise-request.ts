import { z } from "zod";
import { AppError } from "../errors.ts";
import type { StructuredPrompt } from "../ports/llm-provider.ts";
import type { FewShotExample } from "../ports/unit-of-work.ts";

export const CATEGORISE_PROMPT_VERSION = "2026-10-26.1";

export const categoriseSuggestionSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  payee_name: z.string().nullable().optional(),
  website_domain: z.string().nullable().optional(),
  category_id: z.string(),
  confidence: z.number().min(0).max(1),
  tax_category_id: z.string().nullable().optional(),
  activity_id: z.string().nullable().optional(),
});
export type CategoriseSuggestion = z.infer<typeof categoriseSuggestionSchema>;

export const categoriseOutputSchema = z.object({
  suggestions: z.array(categoriseSuggestionSchema),
});
export type CategoriseOutput = z.infer<typeof categoriseOutputSchema>;

export interface CategoriseRequestItem {
  readonly index: number;
  readonly description: string;
  readonly amountCents: number;
  readonly postedOn: string;
  readonly isPrivate?: boolean | undefined;
}

export interface CategoriseCategoryOption {
  readonly id: string;
  readonly name: string;
  readonly groupName?: string | undefined;
}

export interface BuildCategorisationRequestInput {
  readonly items: readonly CategoriseRequestItem[];
  readonly categories: readonly CategoriseCategoryOption[];
  readonly fewShotExamples?: readonly FewShotExample[] | undefined;
  readonly isLocal: boolean;
  readonly model?: string | undefined;
}

/**
 * Shared request builder for LLM transaction categorisation (AD-6).
 *
 * Enforces AD-6 privacy sanitiser:
 * - Refuses requests for private accounts on non-local / cloud providers with `PermissionDenied`.
 * - Cloud providers receive strictly sanitized payloads: only description, amount, date, and category list.
 * - At most 10 few-shot examples from public accounts are included.
 */
export function buildCategorisationRequest(
  input: BuildCategorisationRequestInput,
): StructuredPrompt<CategoriseOutput> {
  // AD-6: Cloud privacy sanitiser: refuse private accounts if provider is not local
  if (!input.isLocal) {
    const hasPrivate = input.items.some((item) => (item.isPrivate ?? true));
    if (hasPrivate) {
      throw new AppError(
        "PermissionDenied",
        "Cannot send private account transactions to a cloud LLM provider",
      );
    }
  }

  const categoryLines = input.categories
    .map((c) => `- ${c.id}: ${c.name}${c.groupName ? ` (${c.groupName})` : ""}`)
    .join("\n");

  const fewShotSlice = (input.fewShotExamples ?? []).slice(0, 10);
  const fewShotSection =
    fewShotSlice.length > 0
      ? `Past categorised examples:\n${fewShotSlice
          .map(
            (e) =>
              `- Description: ${e.description} | Amount: ${(e.amountCents / 100).toFixed(2)} AUD | Date: ${e.postedOn} -> Category: ${e.categoryId}${e.categoryName ? ` (${e.categoryName})` : ""}${input.isLocal && e.payeeName ? ` | Payee: ${e.payeeName}` : ""}`,
          )
          .join("\n")}\n\n`
      : "";

  const transactionLines = input.items
    .map(
      (item) =>
        `[${item.index}] Description: ${item.description} | Amount: ${(item.amountCents / 100).toFixed(2)} AUD | Date: ${item.postedOn}`,
    )
    .join("\n");

  const systemPrompt =
    "You are a financial transaction categorisation assistant. Categorise each transaction into one of the allowed categories. Return JSON matching the schema with payee_name (clean merchant name), website_domain (e.g. woolworths.com.au), category_id, confidence (0.0 to 1.0), and optional tax_category_id or activity_id.";

  const prompt = `Available categories:
${categoryLines}

${fewShotSection}Categorise the following transactions:
${transactionLines}`;

  return {
    schemaName: "categorise",
    schemaDescription: "Transaction categorisation suggestions",
    schema: categoriseOutputSchema,
    systemPrompt,
    prompt,
    ...(input.model !== undefined ? { model: input.model } : {}),
  };
}
