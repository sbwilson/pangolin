import type { z } from "zod";

/**
 * Token usage reported by the provider.
 */
export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/**
 * A request for structured output matching a Zod schema.
 */
export interface StructuredPrompt<T> {
  /** Name of the schema, e.g. "categorise", passed to JSON schema or tool calling. */
  readonly schemaName: string;
  /** Optional human-readable description of the schema. */
  readonly schemaDescription?: string | undefined;
  /** Zod schema defining the expected output structure. */
  readonly schema: z.ZodType<T>;
  /** Optional system prompt. */
  readonly systemPrompt?: string | undefined;
  /** User prompt or task instruction. */
  readonly prompt: string;
  /** Optional model override for this request. */
  readonly model?: string | undefined;
  /** Optional timeout in milliseconds for this request. */
  readonly timeoutMs?: number | undefined;
  /** Optional temperature setting (0.0 to 2.0). */
  readonly temperature?: number | undefined;
  /** Optional max output tokens. */
  readonly maxTokens?: number | undefined;
  /** Optional abort signal to cancel the request. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Validated structured response from the LLM provider.
 */
export interface StructuredResponse<T> {
  /** Validated typed output object matching the requested schema. */
  readonly data: T;
  /** Raw JSON text returned by the model. */
  readonly raw: string;
  /** Token usage statistics. */
  readonly usage: LlmUsage;
  /** Model name that served the response. */
  readonly model: string;
}

/**
 * LLM provider port (AD-2, AD-6).
 *
 * Outbound async port called before write transactions open. Implementations live in
 * `packages/llm`.
 */
export interface LlmProvider {
  generateStructured<T>(prompt: StructuredPrompt<T>): Promise<StructuredResponse<T>>;
}
