import { Temporal } from "@pangolin/shared/temporal";
import { z } from "zod";
import { AppError } from "../errors.ts";
import type { StructuredPrompt } from "../ports/llm-provider.ts";

export const ROW_INTERPRET_PROMPT_VERSION = "2026-10-27.1";

export const rowInterpretProposalSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  rowId: z.string().optional(),
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
  amountCents: z.number().int(),
  description: z.string().trim().min(1).max(500),
  confidence: z.number().min(0).max(1).nullish(),
  explanation: z.string().nullish(),
});
export type RowInterpretProposal = z.infer<typeof rowInterpretProposalSchema>;

export const rowInterpretOutputSchema = z.object({
  proposals: z.array(rowInterpretProposalSchema),
});
export type RowInterpretOutput = z.infer<typeof rowInterpretOutputSchema>;

export interface RowInterpretRequestItem {
  readonly index: number;
  readonly rowId?: string | undefined;
  readonly rawLine: string;
  readonly reason?: string | null | undefined;
  readonly isPrivate?: boolean | undefined;
}

export interface BuildRowInterpretRequestInput {
  readonly items: readonly RowInterpretRequestItem[];
  readonly isLocal: boolean;
  readonly cloudRows?: boolean | undefined;
  readonly model?: string | undefined;
}

/**
 * Shared request builder for set-aside row interpretation (AD-6).
 *
 * Enforces AD-6 privacy sanitiser:
 * - Local by default. Non-local / cloud providers require explicit `cloud_rows` opt-in.
 * - Cloud providers are strictly forbidden from receiving rows from private accounts.
 */
export function buildRowInterpretRequest(
  input: BuildRowInterpretRequestInput,
): StructuredPrompt<RowInterpretOutput> {
  // AD-6: Cloud privacy sanitiser: require cloud_rows opt-in and refuse private accounts
  if (!input.isLocal) {
    if (!input.cloudRows) {
      throw new AppError(
        "PermissionDenied",
        "Cloud provider not permitted for row interpretation without cloud_rows opt-in",
      );
    }
    const hasPrivate = input.items.some((item) => item.isPrivate ?? true);
    if (hasPrivate) {
      throw new AppError(
        "PermissionDenied",
        "Cannot send private account rows to a cloud LLM provider",
      );
    }
  }

  const rowLines = input.items
    .map(
      (item) =>
        `[${item.index}] Raw statement row: "${item.rawLine}"${item.reason ? ` (failure reason: ${item.reason})` : ""}`,
    )
    .join("\n");

  const systemPrompt =
    "You are a financial statement parser. Interpret unparsed or set-aside raw transaction rows from bank statements into structured transaction proposals. Return JSON matching the schema with proposals containing postedOn (YYYY-MM-DD), amountCents (integer cents; negative for expenses/outflows, positive for income/deposits), description (clean merchant or transaction name), and optional confidence (0.0 to 1.0) and explanation.";

  const prompt = `Interpret the following raw statement rows into structured transaction proposals:
${rowLines}

Guidelines:
- Return valid ISO date postedOn (YYYY-MM-DD). If an impossible date is encountered (e.g. 31/09/2026), correct it to the nearest valid date (e.g. 2026-09-30).
- Convert decimal amounts to integer cents (e.g. -36.00 to -3600 cents).
- Clean up card numbers, terminal IDs, and transaction noise from the description.
- Include the item index in each proposal.`;

  return {
    schemaName: "row_interpret",
    schemaDescription: "Set-aside transaction row interpretation proposals",
    schema: rowInterpretOutputSchema,
    systemPrompt,
    prompt,
    ...(input.model !== undefined ? { model: input.model } : {}),
  };
}
