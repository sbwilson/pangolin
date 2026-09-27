// A per-client request limit for our own public sign-in routes (story 1.6: `/api/identity/recover`
// and `/api/identity/re-enrol`), matching better-auth's limit on its sign-in routes: the same
// `PANGOLIN_AUTH_RATE_LIMIT` per minute, keyed on the same client address (trusted proxies
// included). In memory, like better-auth's, so it resets on restart.
import { AppError } from "@pangolin/app";
import type { MiddlewareHandler } from "hono";
import { errorResponse } from "./errors.ts";

const WINDOW_MS = 60_000;

/**
 * Middleware allowing `max` requests per client per minute (a fixed window per client);
 * further requests get 429 `RateLimited` without running. `clientKey` gives the client's
 * address, or undefined (then all such requests share one bucket).
 */
export function rateLimit(
  max: number,
  clientKey: (c: Parameters<MiddlewareHandler>[0]) => string | undefined,
  now: () => number = Date.now,
): MiddlewareHandler {
  const windows = new Map<string, { start: number; count: number }>();
  return async (c, next) => {
    const at = now();
    for (const [key, window] of windows) {
      if (at - window.start >= WINDOW_MS) windows.delete(key);
    }
    const key = clientKey(c) ?? "unknown";
    const window = windows.get(key) ?? { start: at, count: 0 };
    window.count++;
    windows.set(key, window);
    if (window.count > max) {
      const retryAfterSeconds = Math.ceil((window.start + WINDOW_MS - at) / 1000);
      c.header("Retry-After", String(retryAfterSeconds));
      return errorResponse(
        c,
        new AppError("RateLimited", "Too many attempts. Try again in a minute.", {
          retryAfterSeconds,
        }),
      );
    }
    await next();
    return undefined;
  };
}
