import type { LlmProvider } from "@pangolin/app";
import { z } from "zod";
import { CATEGORY_CHOICES, type EvalItem, SYNTHETIC_DATASET } from "./dataset.ts";
import {
  calculateAccuracy,
  calculateBrierScore,
  calculateLatencyStats,
  type LatencyStats,
} from "./metrics.ts";

export const evalCategoriseSchema = z.object({
  suggestions: z.array(
    z.object({
      index: z.number().optional(),
      payee_name: z.string().optional(),
      website_domain: z.string().optional(),
      category_id: z.string(),
      confidence: z.number(),
    }),
  ),
});

export type EvalCategoriseOutput = z.infer<typeof evalCategoriseSchema>;

export interface EvalItemResult {
  readonly item: EvalItem;
  readonly predictedCategoryId: string | null;
  readonly confidence: number;
  readonly isCorrect: boolean;
  readonly latencyMs: number;
  readonly error?: string | undefined;
}

export interface EvalReport {
  readonly total: number;
  readonly correct: number;
  readonly errors: number;
  readonly accuracy: number;
  readonly brierScore: number;
  readonly latency: LatencyStats;
  readonly results: ReadonlyArray<EvalItemResult>;
}

export interface EvalOptions {
  readonly dataset?: ReadonlyArray<EvalItem> | undefined;
  readonly model?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

function buildPrompt(item: EvalItem): string {
  const categoryList = CATEGORY_CHOICES.map((c) => `- ${c.id}: ${c.name} (${c.group})`).join("\n");

  return `Categorise the following transaction into one of the allowed categories.
Description: ${item.description}
Amount: ${(item.amountCents / 100).toFixed(2)} AUD
Date: ${item.date}

Available categories:
${categoryList}`;
}

/**
 * Runs the evaluation harness against the given LLM provider using the synthetic dataset.
 * Catches per-item errors without aborting the overall evaluation.
 */
export async function runEval(provider: LlmProvider, options?: EvalOptions): Promise<EvalReport> {
  const dataset = options?.dataset ?? SYNTHETIC_DATASET;
  const results: EvalItemResult[] = [];
  const latencies: number[] = [];

  for (const item of dataset) {
    const start = performance.now();
    try {
      const response = await provider.generateStructured({
        schemaName: "categorise",
        schemaDescription: "Categorises bank transactions",
        schema: evalCategoriseSchema,
        prompt: buildPrompt(item),
        model: options?.model,
        timeoutMs: options?.timeoutMs,
      });

      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      latencies.push(latencyMs);

      const suggestion = response.data.suggestions[0];
      const predictedCategoryId = suggestion?.category_id ?? null;
      const confidence = suggestion?.confidence ?? 0;
      const isCorrect = predictedCategoryId === item.expectedCategoryId;

      results.push({
        item,
        predictedCategoryId,
        confidence,
        isCorrect,
        latencyMs,
      });
    } catch (err) {
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({
        item,
        predictedCategoryId: null,
        confidence: 0,
        isCorrect: false,
        latencyMs,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const accuracy = calculateAccuracy(results);
  const brierScore = calculateBrierScore(results);
  const latency = calculateLatencyStats(latencies);
  const correct = results.filter((r) => r.isCorrect).length;
  const errors = results.filter((r) => r.error !== undefined).length;

  return {
    total: results.length,
    correct,
    errors,
    accuracy,
    brierScore,
    latency,
    results,
  };
}

export { runEval as evaluateProvider };
