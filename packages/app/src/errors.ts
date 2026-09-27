// The error contract (spine: Errors convention). Use cases throw `AppError` with a stable
// `code`; the HTTP entry maps the code to a status and renders `errorBody`.
import { ZodError, type z } from "zod";

export const ERROR_CODES = [
  "NotFound",
  "Validation",
  "Conflict",
  "Unauthenticated",
  "ReauthRequired",
  "RateLimited",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** A failure the caller may see. `message` must never name another person's private rows. */
export class AppError extends Error {
  readonly code: ErrorCode;
  // `declare`, so an error without details has no `details` key at all.
  declare readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** The JSON body of every error response. `Internal` is for anything that is not an `AppError`. */
export interface ErrorBody {
  readonly error: {
    readonly code: ErrorCode | "Internal";
    readonly message: string;
    readonly details?: unknown;
  };
}

/** Wraps a `ZodError` as a `Validation` error carrying its issues as `details`. */
export function validationError(error: ZodError, message = "Invalid input"): AppError {
  return new AppError("Validation", message, error.issues);
}

/**
 * The error shape for any thrown value. An `AppError` keeps its code, message and details; a
 * `ZodError` becomes `Validation` with its issues; anything else is `Internal` with a fixed
 * message, so no internals (paths, SQL, stack) leak.
 */
export function errorBody(err: unknown): ErrorBody {
  const appError = err instanceof ZodError ? validationError(err) : err;
  if (appError instanceof AppError) {
    const { code, message, details } = appError;
    return { error: details === undefined ? { code, message } : { code, message, details } };
  }
  return { error: { code: "Internal", message: "Internal error" } };
}

/** Parses use-case input, throwing `AppError("Validation")` with the Zod issues on failure. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
