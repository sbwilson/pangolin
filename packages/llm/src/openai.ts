import type { LlmProvider, StructuredPrompt, StructuredResponse } from "@pangolin/app";
import {
  LlmHttpError,
  LlmMalformedJsonError,
  LlmRateLimitError,
  LlmRefusalError,
  LlmTimeoutError,
  LlmValidationError,
} from "./errors.ts";
import { zodToJsonSchema } from "./schema-converter.ts";

export interface OpenAiConfig {
  /** Base URL for the OpenAI-compatible API (e.g. `http://127.0.0.1:4010` or `https://api.openai.com/v1`). */
  readonly baseUrl: string;
  /** Optional API key for authorization. */
  readonly apiKey?: string | undefined;
  /** Default model name, e.g. `gpt-4o-mini`, `llama3.2`, etc. */
  readonly model: string;
  /** Default request timeout in milliseconds. */
  readonly timeoutMs?: number | undefined;
  /** Default temperature (0.0 to 2.0). */
  readonly temperature?: number | undefined;
  /** Default max completion tokens. */
  readonly maxTokens?: number | undefined;
  /** Whether to use strict `response_format.json_schema`. Defaults to true. */
  readonly strictJsonSchema?: boolean | undefined;
  /** Custom fetch implementation (optional, defaults to globalThis.fetch). */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

interface OpenAiChatCompletionResponse {
  readonly id?: string;
  readonly model?: string;
  readonly choices?: Array<{
    readonly message?: {
      readonly content?: string | null;
      readonly refusal?: string | null;
    };
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

function buildEndpointUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}${path.replace(/^\/v1/, "")}`;
  }
  return `${trimmed}${path}`;
}

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (headerValue === null) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed === "") return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number.parseFloat(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds;
    }
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const diffSec = Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
    return diffSec;
  }
  return undefined;
}

function extractErrorMessage(bodyText: string, fallback: string): string {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed?.error === "object" && typeof parsed.error?.message === "string") {
      return parsed.error.message;
    }
    if (typeof parsed?.error === "string") {
      return parsed.error;
    }
    if (typeof parsed?.message === "string") {
      return parsed.message;
    }
  } catch {
    // ignore
  }
  return bodyText.length > 0 && bodyText.length < 256 ? bodyText : fallback;
}

export class OpenAiAdapter implements LlmProvider {
  private readonly config: OpenAiConfig;

  constructor(config: OpenAiConfig) {
    this.config = config;
  }

  async generateStructured<T>(prompt: StructuredPrompt<T>): Promise<StructuredResponse<T>> {
    const fetchFn = this.config.fetch ?? globalThis.fetch;
    const url = buildEndpointUrl(this.config.baseUrl, "/v1/chat/completions");
    const model = prompt.model ?? this.config.model;
    const timeoutMs = prompt.timeoutMs ?? this.config.timeoutMs;

    const jsonSchema = zodToJsonSchema(prompt.schema);
    const strictMode = this.config.strictJsonSchema ?? true;

    let userContent = prompt.prompt;
    if (!strictMode) {
      userContent = `${prompt.prompt}\n\nYou must respond with valid JSON adhering to the following JSON Schema for '${prompt.schemaName}':\n${JSON.stringify(jsonSchema, null, 2)}`;
    }

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (prompt.systemPrompt !== undefined && prompt.systemPrompt !== "") {
      messages.push({ role: "system", content: prompt.systemPrompt });
    }
    messages.push({ role: "user", content: userContent });

    const responseFormat = strictMode
      ? {
          type: "json_schema" as const,
          json_schema: {
            name: prompt.schemaName,
            ...(prompt.schemaDescription !== undefined
              ? { description: prompt.schemaDescription }
              : {}),
            strict: true,
            schema: jsonSchema,
          },
        }
      : {
          type: "json_object" as const,
        };

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      response_format: responseFormat,
    };

    const temperature = prompt.temperature ?? this.config.temperature;
    if (temperature !== undefined) {
      requestBody.temperature = temperature;
    }

    const maxTokens = prompt.maxTokens ?? this.config.maxTokens;
    if (maxTokens !== undefined) {
      requestBody.max_tokens = maxTokens;
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.config.apiKey !== undefined && this.config.apiKey !== "") {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    let didTimeout = false;

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        didTimeout = true;
        controller.abort(new Error(`LLM request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    const onCallerAbort = () => {
      controller.abort(prompt.signal?.reason);
    };

    if (prompt.signal !== undefined) {
      if (prompt.signal.aborted) {
        controller.abort(prompt.signal.reason);
      } else {
        prompt.signal.addEventListener("abort", onCallerAbort);
      }
    }

    let responseStatus: number;
    let responseHeaders: Headers;
    let responseOk: boolean;
    let responseText: string;

    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      responseStatus = response.status;
      responseHeaders = response.headers;
      responseOk = response.ok;
      responseText = await response.text();
    } catch (error: unknown) {
      if (didTimeout || (controller.signal.aborted && didTimeout)) {
        throw new LlmTimeoutError(
          `Request to OpenAI endpoint timed out after ${timeoutMs}ms`,
          timeoutMs,
          { cause: error },
        );
      }
      throw error;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (prompt.signal !== undefined) {
        prompt.signal.removeEventListener("abort", onCallerAbort);
      }
    }

    if (responseStatus === 429) {
      const retryAfter = parseRetryAfter(responseHeaders.get("retry-after"));
      const message = extractErrorMessage(responseText, "Rate limit exceeded");
      throw new LlmRateLimitError(message, retryAfter);
    }

    if (!responseOk) {
      const message = extractErrorMessage(responseText, `HTTP error ${responseStatus}`);
      throw new LlmHttpError(responseStatus, message, responseText);
    }

    let parsedResponse: OpenAiChatCompletionResponse;
    try {
      parsedResponse = JSON.parse(responseText) as OpenAiChatCompletionResponse;
    } catch (error: unknown) {
      throw new LlmMalformedJsonError("Failed to parse response body as JSON", responseText, {
        cause: error,
      });
    }

    const choice = parsedResponse.choices?.[0];
    if (choice === undefined) {
      throw new LlmMalformedJsonError("No choices returned in OpenAI response", responseText);
    }

    if (choice.message?.refusal !== null && choice.message?.refusal !== undefined) {
      throw new LlmRefusalError(choice.message.refusal, choice.message.refusal);
    }

    if (choice.finish_reason === "refusal") {
      const refusalMsg = choice.message?.refusal ?? "Model refused the request";
      throw new LlmRefusalError(refusalMsg, refusalMsg);
    }

    if (choice.finish_reason === "length") {
      throw new LlmMalformedJsonError(
        "Response was truncated because max output tokens was reached (finish_reason: length)",
        responseText,
      );
    }

    const content = choice.message?.content;
    if (typeof content !== "string") {
      throw new LlmMalformedJsonError(
        "Missing or non-string content in OpenAI choice",
        responseText,
      );
    }

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(content);
    } catch (error: unknown) {
      throw new LlmMalformedJsonError("Failed to parse JSON structured output", content, {
        cause: error,
      });
    }

    const validated = prompt.schema.safeParse(parsedContent);
    if (!validated.success) {
      throw new LlmValidationError(
        "Response content failed schema validation",
        validated.error.issues,
      );
    }

    const promptTokens = parsedResponse.usage?.prompt_tokens ?? 0;
    const completionTokens = parsedResponse.usage?.completion_tokens ?? 0;
    const totalTokens = parsedResponse.usage?.total_tokens ?? promptTokens + completionTokens;

    return {
      data: validated.data,
      raw: content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      model: parsedResponse.model ?? model,
    };
  }
}
