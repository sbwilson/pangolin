/**
 * HTTP plumbing shared by the OpenAI-compatible and Anthropic adapters:
 * endpoint URLs, timeout/abort-aware JSON POSTs, and error-body parsing.
 */
import { LlmHttpError, LlmRateLimitError, LlmTimeoutError } from "./errors.ts";

export interface HttpPostOptions {
  readonly fetchFn: typeof globalThis.fetch;
  readonly url: string;
  readonly headers: Record<string, string>;
  /** Pre-serialized request body. */
  readonly body: string;
  /** Abort the request after this many milliseconds; 0/undefined means no timeout. */
  readonly timeoutMs?: number | undefined;
  /** Message for the LlmTimeoutError raised when the timeout fires. */
  readonly timeoutMessage: string;
  /** Optional caller-provided cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly ok: boolean;
  readonly text: string;
}

/** Combine a base URL and an endpoint path without doubling a `/v1` segment. */
export function buildEndpointUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}${path.replace(/^\/v1/, "")}`;
  }
  return `${trimmed}${path}`;
}

/** Parse a `Retry-After` header value (delta-seconds or HTTP-date) into seconds. */
export function parseRetryAfter(headerValue: string | null): number | undefined {
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

/** Pull a human-readable message out of a JSON error body, falling back to the raw text. */
export function extractErrorMessage(bodyText: string, fallback: string): string {
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

/**
 * POST a JSON body with timeout and caller-signal support.
 * Throws {@link LlmTimeoutError} when the timeout fires; rethrows other
 * transport errors unchanged.
 */
export async function postJson(options: HttpPostOptions): Promise<HttpResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;

  if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
    timer = setTimeout(() => {
      didTimeout = true;
      controller.abort(new Error(`LLM request timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
  }

  const onCallerAbort = () => {
    controller.abort(options.signal?.reason);
  };

  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal.addEventListener("abort", onCallerAbort);
    }
  }

  try {
    const response = await options.fetchFn(options.url, {
      method: "POST",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    return {
      status: response.status,
      headers: response.headers,
      ok: response.ok,
      text: await response.text(),
    };
  } catch (error: unknown) {
    if (didTimeout) {
      throw new LlmTimeoutError(options.timeoutMessage, options.timeoutMs, { cause: error });
    }
    throw error;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (options.signal !== undefined) {
      options.signal.removeEventListener("abort", onCallerAbort);
    }
  }
}

/**
 * Map a non-OK HTTP response to the matching {@link LlmRateLimitError} (429)
 * or {@link LlmHttpError}. Declared `never` so callers can use it as the
 * error branch of a check.
 */
export function throwHttpError(response: HttpResponse): never {
  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    const message = extractErrorMessage(response.text, "Rate limit exceeded");
    throw new LlmRateLimitError(message, retryAfter);
  }
  const message = extractErrorMessage(response.text, `HTTP error ${response.status}`);
  throw new LlmHttpError(response.status, message, response.text);
}
