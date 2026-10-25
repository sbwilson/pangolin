import type { LlmProvider, StructuredPrompt, StructuredResponse } from "@pangolin/app";
import { type MockServer, startMockLlm } from "@pangolin/mock-llm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnthropicAdapter } from "../anthropic.ts";
import { OpenAiAdapter } from "../openai.ts";
import { CATEGORY_CHOICES, type EvalItem, SYNTHETIC_DATASET } from "./dataset.ts";
import { runEval } from "./harness.ts";
import { calculateAccuracy, calculateBrierScore, calculateLatencyStats } from "./metrics.ts";

describe("Evaluation metrics", () => {
  it("calculates accuracy correctly", () => {
    expect(calculateAccuracy([])).toBe(0);
    expect(calculateAccuracy([{ isCorrect: true }, { isCorrect: false }])).toBe(0.5);
    expect(calculateAccuracy([{ isCorrect: true }, { isCorrect: true }])).toBe(1);
    expect(calculateAccuracy([{ isCorrect: false }])).toBe(0);
  });

  it("calculates Brier calibration score", () => {
    expect(calculateBrierScore([])).toBe(0);

    // Perfect confidence and accuracy: confidence 1.0 and correct -> (1-1)^2 = 0
    expect(
      calculateBrierScore([
        { confidence: 1.0, isCorrect: true },
        { confidence: 1.0, isCorrect: true },
      ]),
    ).toBe(0);

    // Completely wrong with maximum confidence: confidence 1.0 and incorrect -> (1-0)^2 = 1.0
    expect(
      calculateBrierScore([
        { confidence: 1.0, isCorrect: false },
        { confidence: 1.0, isCorrect: false },
      ]),
    ).toBe(1.0);

    // Intermediate calibration: confidence 0.8, one correct (diff 0.2 -> 0.04), one incorrect (diff 0.8 -> 0.64)
    // Mean = (0.04 + 0.64) / 2 = 0.34
    expect(
      calculateBrierScore([
        { confidence: 0.8, isCorrect: true },
        { confidence: 0.8, isCorrect: false },
      ]),
    ).toBeCloseTo(0.34);
  });

  it("ignores failed predictions with errors in Brier score calculation", () => {
    // 1 correct with 1.0 confidence, 1 failed with error: only the successful prediction is scored
    expect(
      calculateBrierScore([
        { confidence: 1.0, isCorrect: true },
        { confidence: 0, isCorrect: false, error: "timeout" },
      ]),
    ).toBe(0);
  });

  it("calculates latency distribution statistics", () => {
    expect(calculateLatencyStats([])).toEqual({ mean: 0, min: 0, max: 0, p95: 0 });

    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const stats = calculateLatencyStats(latencies);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(100);
    expect(stats.mean).toBe(55);
    // Nearest-rank p95 for 10 elements: ceil(0.95 * 10) - 1 = index 9 (value 100)
    expect(stats.p95).toBe(100);
  });
});

describe("Synthetic dataset", () => {
  it("contains at least 20 labelled transactions", () => {
    expect(SYNTHETIC_DATASET.length).toBeGreaterThanOrEqual(20);
    for (const item of SYNTHETIC_DATASET) {
      expect(item.id).toBeDefined();
      expect(item.description).toBeDefined();
      expect(typeof item.amountCents).toBe("number");
      expect(item.expectedCategoryId).toBeDefined();
      // Ensure category exists in CATEGORY_CHOICES
      expect(CATEGORY_CHOICES.some((c) => c.id === item.expectedCategoryId)).toBe(true);
    }
  });
});

describe("Eval harness execution", () => {
  it("evaluates a mock provider with custom accuracy and confidence", async () => {
    // Mock provider that correctly predicts 'groceries' with 0.9 confidence and 'fuel' with 0.7
    const mockProvider: LlmProvider = {
      generateStructured: async <T>(
        prompt: StructuredPrompt<T>,
      ): Promise<StructuredResponse<T>> => {
        let categoryId = "groceries";
        let confidence = 0.9;
        if (prompt.prompt.includes("AMPOL")) {
          categoryId = "fuel";
          confidence = 0.85;
        } else if (prompt.prompt.includes("ORIGIN")) {
          categoryId = "utilities-other"; // incorrect guess
          confidence = 0.6;
        }
        const data = {
          suggestions: [
            {
              index: 0,
              payee_name: "Mock Payee",
              category_id: categoryId,
              confidence,
            },
          ],
        } as unknown as T;

        return {
          data,
          raw: JSON.stringify(data),
          usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
          model: "mock-provider",
        };
      },
    };

    const subset: EvalItem[] = [
      SYNTHETIC_DATASET[0] as EvalItem, // Woolworths -> expected: groceries
      SYNTHETIC_DATASET[3] as EvalItem, // Origin -> expected: electricity (mock returns utilities-other)
      SYNTHETIC_DATASET[8] as EvalItem, // Ampol -> expected: fuel (mock returns fuel)
    ];

    const report = await runEval(mockProvider, { dataset: subset });
    expect(report.total).toBe(3);
    expect(report.correct).toBe(2);
    expect(report.accuracy).toBeCloseTo(2 / 3);
    expect(report.brierScore).toBeGreaterThan(0);
    expect(report.brierScore).toBeLessThan(1);
    expect(report.latency.mean).toBeGreaterThanOrEqual(0);
    expect(report.errors).toBe(0);
  });

  it("catches provider errors per item without aborting the run", async () => {
    let callCount = 0;
    const failingProvider: LlmProvider = {
      generateStructured: async <T>(): Promise<StructuredResponse<T>> => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Rate limit exceeded (mock 429)");
        }
        const data = {
          suggestions: [
            {
              index: 0,
              category_id: "groceries",
              confidence: 0.95,
            },
          ],
        } as unknown as T;

        return {
          data,
          raw: JSON.stringify(data),
          usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
          model: "fail-mock",
        };
      },
    };

    const dataset = SYNTHETIC_DATASET.slice(0, 3);
    const report = await runEval(failingProvider, { dataset });

    expect(report.total).toBe(3);
    expect(report.errors).toBe(1);
    expect(report.results[1]?.error).toContain("Rate limit exceeded");
    expect(report.results[1]?.isCorrect).toBe(false);
  });
});

describe("Eval harness against mock-llm server", () => {
  let server: MockServer;

  beforeAll(async () => {
    server = await startMockLlm({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it("runs the full 20-item synthetic dataset against OpenAiAdapter on mock-llm", async () => {
    const adapter = new OpenAiAdapter({
      baseUrl: server.url,
      model: "mock-ok",
    });

    const report = await runEval(adapter);

    expect(report.total).toBe(20);
    expect(report.errors).toBe(0);
    expect(typeof report.accuracy).toBe("number");
    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.accuracy).toBeLessThanOrEqual(1);
    expect(typeof report.brierScore).toBe("number");
    expect(report.brierScore).toBeGreaterThanOrEqual(0);
    expect(report.brierScore).toBeLessThanOrEqual(1);

    expect(report.latency.mean).toBeGreaterThan(0);
    expect(report.latency.min).toBeGreaterThan(0);
    expect(report.latency.max).toBeGreaterThanOrEqual(report.latency.min);
    expect(report.latency.p95).toBeGreaterThanOrEqual(report.latency.min);

    // In mock-ok fixture, category_id returned is always 'groceries'
    // Woolworths, Coles, Aldi are expected 'groceries' (first 3 items in dataset)
    expect(report.correct).toBe(3);
    expect(report.accuracy).toBe(3 / 20);
  });

  it("runs the eval harness against AnthropicAdapter on mock-llm", async () => {
    const adapter = new AnthropicAdapter({
      baseUrl: server.url,
      model: "mock-ok",
    });

    const report = await runEval(adapter, { dataset: SYNTHETIC_DATASET.slice(0, 5) });

    expect(report.total).toBe(5);
    expect(report.errors).toBe(0);
    expect(report.correct).toBe(3); // items 0, 1, 2 are groceries
    expect(report.accuracy).toBe(3 / 5);
  });
});
