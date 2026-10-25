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

export interface AnthropicConfig {
  /** Base URL for the Anthropic-compatible API (e.g. `http://127.0.0.1:4010` or `https://api.anthropic.com/v1`). */
  readonly baseUrl: string;
  /** Optional API key for `x-api-key`. */
  readonly apiKey?: string | undefined;
  /** Default model name, e.g. `claude-3-5-sonnet-latest`, `mock-ok`, etc. */
  readonly model: string;
  /** Default request timeout in milliseconds. */
  readonly timeoutMs?: number | undefined;
  /** Default temperature (0.0 to 1.0). */
  readonly temperature?: number | undefined;
  /** Default max output tokens (defaults to 4096 if unset). */
  readonly maxTokens?: number | undefined;
  /** Anthropic API version string (defaults to `2023-06-01`). */
  readonly anthropicVersion?: string | undefined;
  /** Custom fetch implementation (optional, defaults to globalThis.fetch). */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

interface AnthropicMessageResponse {
  readonly id?: string;
  readonly model?: string;
  readonly stop_reason?: string | null;
  readonly content?: Array<{
    readonly type: string;
    readonly name?: string;
    readonly input?: unknown;
    readonly text?: string;
  }>;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
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

export class AnthropicAdapter implements LlmProvider {
  private readonly config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    this.config = config;
  }

  async generateStructured<T>(prompt: StructuredPrompt<T>): Promise<StructuredResponse<T>> {
    const fetchFn = this.config.fetch ?? globalThis.fetch;
    const url = buildEndpointUrl(this.config.baseUrl, "/v1/messages");
    const model = prompt.model ?? this.config.model;
    const timeoutMs = prompt.timeoutMs ?? this.config.timeoutMs;

    const jsonSchema = zodToJsonSchema(prompt.schema);

    const tools = [
      {
        name: prompt.schemaName,
        description: prompt.schemaDescription ?? `Output schema for ${prompt.schemaName}`,
        input_schema: jsonSchema,
      },
    ];

    const toolChoice = {
      type: "tool" as const,
      name: prompt.schemaName,
    };

    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: prompt.maxTokens ?? this.config.maxTokens ?? 4096,
      messages: [{ role: "user", content: prompt.prompt }],
      tools,
      tool_choice: toolChoice,
    };

    if (prompt.systemPrompt !== undefined && prompt.systemPrompt !== "") {
      requestBody.system = prompt.systemPrompt;
    }

    const temperature = prompt.temperature ?? this.config.temperature;
    if (temperature !== undefined) {
      requestBody.temperature = temperature;
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": this.config.anthropicVersion ?? "2023-06-01",
    };
    if (this.config.apiKey !== undefined && this.config.apiKey !== "") {
      headers["x-api-key"] = this.config.apiKey;
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
          `Request to Anthropic endpoint timed out after ${timeoutMs}ms`,
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

    let parsedResponse: AnthropicMessageResponse;
    try {
      parsedResponse = JSON.parse(responseText) as AnthropicMessageResponse;
    } catch (error: unknown) {
      throw new LlmMalformedJsonError("Failed to parse response body as JSON", responseText, {
        cause: error,
      });
    }

    if (parsedResponse.stop_reason === "refusal") {
      const textBlock = parsedResponse.content?.find(
        (c: { type: string; text?: string }) => c.type === "text",
      );
      const refusalMessage = textBlock?.text ?? "Model refused the request (stop_reason: refusal)";
      throw new LlmRefusalError(refusalMessage, refusalMessage);
    }

    if (parsedResponse.stop_reason === "max_tokens") {
      throw new LlmMalformedJsonError(
        "Response was truncated because max output tokens was reached (stop_reason: max_tokens)",
        responseText,
      );
    }

    const contentBlocks = Array.isArray(parsedResponse.content) ? parsedResponse.content : [];
    const toolUseBlock =
      contentBlocks.find(
        (c: { type: string; name?: string }) =>
          c.type === "tool_use" && c.name === prompt.schemaName,
      ) ??
      contentBlocks.find(
        (c: { type: string; name?: string }) =>
          c.type === "tool_use" && (c.name === undefined || c.name === prompt.schemaName),
      );

    let rawData: unknown;
    let rawString = "";

    if (toolUseBlock !== undefined) {
      rawData = toolUseBlock.input;
      if (typeof rawData === "string") {
        const inputStr = rawData;
        try {
          rawData = JSON.parse(inputStr);
          rawString = inputStr;
        } catch (error: unknown) {
          throw new LlmMalformedJsonError("Failed to parse tool_use input as JSON", inputStr, {
            cause: error,
          });
        }
      } else {
        rawString = JSON.stringify(rawData) ?? "";
      }
    } else {
      const textBlock = contentBlocks.find(
        (c: { type: string; text?: string }) => c.type === "text",
      );
      if (textBlock !== undefined && typeof textBlock.text === "string") {
        try {
          rawData = JSON.parse(textBlock.text);
          rawString = textBlock.text;
        } catch (error: unknown) {
          throw new LlmMalformedJsonError("Failed to parse text response as JSON", textBlock.text, {
            cause: error,
          });
        }
      } else {
        throw new LlmMalformedJsonError(
          "No tool_use or JSON text content in response",
          responseText,
        );
      }
    }

    const validated = prompt.schema.safeParse(rawData);
    if (!validated.success) {
      throw new LlmValidationError(
        "Response content failed schema validation",
        validated.error.issues,
      );
    }

    const promptTokens = parsedResponse.usage?.input_tokens ?? 0;
    const completionTokens = parsedResponse.usage?.output_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;

    return {
      data: validated.data,
      raw: rawString,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      model: parsedResponse.model ?? model,
    };
  }
}
