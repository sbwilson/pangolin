import { type ErrorCode, errorBody } from "@pangolin/app";
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const STATUS: Readonly<Record<ErrorCode | "Internal", ContentfulStatusCode>> = {
  NotFound: 404,
  Validation: 400,
  Conflict: 409,
  Unauthenticated: 401,
  // Authenticated, but the action needs a fresh sign-in; its own code tells it apart from 401.
  ReauthRequired: 403,
  RateLimited: 429,
  Internal: 500,
};

/** The HTTP status for an error code. */
export function httpStatus(code: ErrorCode | "Internal"): ContentfulStatusCode {
  return STATUS[code];
}

/** Renders any thrown value as the spine's JSON error shape with its mapped status. */
export function errorResponse(c: Context, err: unknown): Response {
  const body = errorBody(err);
  return c.json(body, httpStatus(body.error.code));
}

/** Called with anything that renders as `Internal`, so it can be logged server-side. */
export type InternalErrorLogger = (err: unknown) => void;

const logToStderr: InternalErrorLogger = (err) => {
  const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(
    JSON.stringify({ time: new Date().toISOString(), level: "error", msg: "unhandled", error }),
  );
};

/**
 * Hono `onError` handler. Hono's own `HTTPException` (malformed JSON, body limit, validators)
 * keeps its response; `AppError` and `ZodError` map to their code's status; anything else is
 * logged and answered with 500 `Internal`, never its message.
 */
export function createErrorHandler(log: InternalErrorLogger = logToStderr): ErrorHandler {
  return (err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    const response = errorResponse(c, err);
    if (response.status === 500) log(err);
    return response;
  };
}
