import type { LlmProvider, StructuredPrompt, StructuredResponse } from "@pangolin/app";
import { LlmMalformedJsonError, LlmRefusalError, LlmValidationError } from "./errors.ts";
import { buildEndpointUrl, postJson, throwHttpError } from "./http-helpers.ts";
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

    const response = await postJson({
      fetchFn,
      url,
      headers,
      body: JSON.stringify(requestBody),
      timeoutMs,
      timeoutMessage: `Request to OpenAI endpoint timed out after ${timeoutMs}ms`,
      signal: prompt.signal,
    });
    const responseText = response.text;

    if (!response.ok) {
      throwHttpError(response);
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
