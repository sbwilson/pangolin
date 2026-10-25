import { type MockServer, startMockLlm } from "@pangolin/mock-llm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicAdapter } from "./anthropic.ts";
import {
  LlmMalformedJsonError,
  LlmRateLimitError,
  LlmRefusalError,
  LlmTimeoutError,
  LlmValidationError,
} from "./errors.ts";
import { OpenAiAdapter } from "./openai.ts";
import { zodToJsonSchema } from "./schema-converter.ts";

const categoriseSchema = z.object({
  suggestions: z.array(
    z.object({
      index: z.number(),
      payee_name: z.string(),
      website_domain: z.string().optional(),
      category_id: z.string(),
      confidence: z.number(),
    }),
  ),
});

const invalidSchema = z.object({
  nonExistentField: z.string(),
});

describe("zodToJsonSchema", () => {
  it("converts a Zod schema to a clean JSON Schema object without $schema", () => {
    const jsonSchema = zodToJsonSchema(categoriseSchema);

    expect(jsonSchema).not.toHaveProperty("$schema");
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.additionalProperties).toBe(false);
    expect(jsonSchema.properties).toBeDefined();
    expect(jsonSchema.required).toEqual(["suggestions"]);
  });
});

describe("LLM Provider Contract Tests", () => {
  let server: MockServer;

  beforeAll(async () => {
    server = await startMockLlm({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  describe.each([
    {
      name: "OpenAiAdapter",
      factory: (options?: { timeoutMs?: number; model?: string; strictJsonSchema?: boolean }) =>
        new OpenAiAdapter({
          baseUrl: server.url,
          model: options?.model ?? "mock-ok",
          timeoutMs: options?.timeoutMs,
          strictJsonSchema: options?.strictJsonSchema,
        }),
    },
    {
      name: "AnthropicAdapter",
      factory: (options?: { timeoutMs?: number; model?: string }) =>
        new AnthropicAdapter({
          baseUrl: server.url,
          model: options?.model ?? "mock-ok",
          timeoutMs: options?.timeoutMs,
        }),
    },
  ])("$name", ({ factory }) => {
    it("returns validated typed output and usage for mock-ok", async () => {
      const adapter = factory({ model: "mock-ok" });
      const response = await adapter.generateStructured({
        schemaName: "categorise",
        schemaDescription: "Categorises bank transactions",
        schema: categoriseSchema,
        prompt: "Categorise Woolworths transaction",
      });

      expect(response.data.suggestions).toHaveLength(1);
      expect(response.data.suggestions[0]?.payee_name).toBe("Woolworths");
      expect(response.data.suggestions[0]?.website_domain).toBe("woolworths.com.au");
      expect(response.data.suggestions[0]?.category_id).toBe("groceries");
      expect(response.data.suggestions[0]?.confidence).toBe(0.92);
      expect(response.usage.promptTokens).toBe(412);
      expect(response.usage.completionTokens).toBe(38);
      expect(response.usage.totalTokens).toBe(450);
      expect(response.model).toBe("mock-ok");
    });

    it("throws LlmRateLimitError with retryAfterSeconds for mock-rate-limit", async () => {
      const adapter = factory({ model: "mock-rate-limit" });

      await expect(
        adapter.generateStructured({
          schemaName: "categorise",
          schema: categoriseSchema,
          prompt: "Categorise transaction",
        }),
      ).rejects.toThrow(LlmRateLimitError);

      try {
        await adapter.generateStructured({
          schemaName: "categorise",
          schema: categoriseSchema,
          prompt: "Categorise transaction",
        });
        expect.unreachable("should have thrown LlmRateLimitError");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(LlmRateLimitError);
        const rateLimitError = error as LlmRateLimitError;
        expect(rateLimitError.retryAfterSeconds).toBe(2);
      }
    });

    it("throws LlmRefusalError with refusalReason for mock-refusal", async () => {
      const adapter = factory({ model: "mock-refusal" });

      await expect(
        adapter.generateStructured({
          schemaName: "categorise",
          schema: categoriseSchema,
          prompt: "Categorise transaction",
        }),
      ).rejects.toThrow(LlmRefusalError);

      try {
        await adapter.generateStructured({
          schemaName: "categorise",
          schema: categoriseSchema,
          prompt: "Categorise transaction",
        });
        expect.unreachable("should have thrown LlmRefusalError");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(LlmRefusalError);
        const refusalError = error as LlmRefusalError;
        expect(refusalError.message.length).toBeGreaterThan(0);
        expect(refusalError.refusalReason).toBe(refusalError.message);
      }
    });

    it("throws LlmMalformedJsonError for mock-malformed-json", async () => {
      const adapter = factory({ model: "mock-malformed-json" });

      await expect(
        adapter.generateStructured({
          schemaName: "categorise",
          schema: categoriseSchema,
          prompt: "Categorise transaction",
        }),
      ).rejects.toThrow(LlmMalformedJsonError);
    });

    it("throws LlmTimeoutError for mock-timeout when timeout is reached", async () => {
      const adapter = factory({ model: "mock-timeout", timeoutMs: 50 });

      await expect(
        adapter.generateStructured({
          schemaName: "categorise",
          schema: categoriseSchema,
          prompt: "Categorise transaction",
        }),
      ).rejects.toThrow(LlmTimeoutError);
    });

    it("throws when caller-initiated prompt.signal is aborted", async () => {
      const adapter = factory({ model: "mock-timeout" });
      const controller = new AbortController();

      const promise = adapter.generateStructured({
        schemaName: "categorise",
        schema: categoriseSchema,
        prompt: "Categorise transaction",
        signal: controller.signal,
      });

      controller.abort(new Error("Caller cancelled"));

      await expect(promise).rejects.toThrow();
    });

    it("throws LlmValidationError when response fails Zod schema", async () => {
      const adapter = factory({ model: "mock-ok" });

      try {
        await adapter.generateStructured({
          schemaName: "categorise",
          schema: invalidSchema,
          prompt: "Categorise transaction",
        });
        expect.unreachable("should have thrown LlmValidationError");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(LlmValidationError);
        const validationError = error as LlmValidationError;
        expect(validationError.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe("OpenAiAdapter fallback mode", () => {
    it("handles strictJsonSchema: false by appending schema instructions", async () => {
      const adapter = new OpenAiAdapter({
        baseUrl: server.url,
        model: "mock-ok",
        strictJsonSchema: false,
      });

      const response = await adapter.generateStructured({
        schemaName: "categorise",
        schema: categoriseSchema,
        prompt: "Categorise Woolworths transaction",
      });

      expect(response.data.suggestions).toHaveLength(1);
      expect(response.data.suggestions[0]?.payee_name).toBe("Woolworths");
    });
  });
});
