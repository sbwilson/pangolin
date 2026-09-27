// The Origin check (story 1.5): a write to `/api/*` must come from our own origin. Browsers
// always send `Origin` on a cross-origin request and on every same-origin non-GET fetch, so a
// missing or foreign one is refused before anything runs.
import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Middleware for `/api/*`: any method but GET and HEAD needs `Origin` equal to `origin`
 * (`PANGOLIN_PUBLIC_URL`'s origin), or gets 403 in the error shape. Its code, `Forbidden`, is
 * transport-level like `Internal`: no use case throws it, so it is not an `AppError` code.
 */
export function originCheck(origin: string): MiddlewareHandler {
  const expected = new URL(origin).origin;
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header("Origin") !== expected) {
      return c.json({ error: { code: "Forbidden", message: "Cross-origin request refused" } }, 403);
    }
    return next();
  };
}
