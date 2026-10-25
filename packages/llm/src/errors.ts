import type { z } from "zod";

/**
 * Base error for all LLM provider failures.
 */
export class LlmError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmError";
  }
}

/**
 * Thrown when the LLM provider responds with HTTP 429 Too Many Requests.
 */
export class LlmRateLimitError extends LlmError {
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, retryAfterSeconds?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Thrown when the LLM request aborts due to client- or request-level timeout.
 */
export class LlmTimeoutError extends LlmError {
  readonly timeoutMs: number | undefined;

  constructor(message: string, timeoutMs?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when the model refuses to complete the request (safety, refusal flag, or finish_reason = refusal).
 */
export class LlmRefusalError extends LlmError {
  readonly refusalReason: string | undefined;

  constructor(message: string, refusalReason?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmRefusalError";
    this.refusalReason = refusalReason;
  }
}

/**
 * Thrown when the response text could not be parsed as valid JSON.
 */
export class LlmMalformedJsonError extends LlmError {
  readonly rawText: string | undefined;

  constructor(message: string, rawText?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmMalformedJsonError";
    this.rawText = rawText;
  }
}

/**
 * Thrown when the JSON response does not conform to the expected Zod schema.
 */
export class LlmValidationError extends LlmError {
  readonly issues: readonly z.ZodIssue[];

  constructor(message: string, issues: readonly z.ZodIssue[], options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmValidationError";
    this.issues = issues;
  }
}

/**
 * Thrown on non-200 / non-429 HTTP status responses from the LLM provider.
 */
export class LlmHttpError extends LlmError {
  readonly status: number;
  readonly body: string | undefined;

  constructor(status: number, message: string, body?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmHttpError";
    this.status = status;
    this.body = body;
  }
}
