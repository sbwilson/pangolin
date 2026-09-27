// The Content-Security-Policy (story 1.5, spine: Web security). Every HTML response carries it
// with a fresh nonce; the page shell gets that nonce in place of its `__CSP_NONCE__` placeholder,
// which Vite puts on the elements it emits (`html.cspNonce`). There are no inline scripts and no
// `style=` attributes, so nothing needs `unsafe-inline`.
import { randomBytes } from "node:crypto";
import type { Handler, MiddlewareHandler } from "hono";

export const CSP_NONCE_PLACEHOLDER = "__CSP_NONCE__";

/** A new nonce: 16 random bytes, base64. */
export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

/** The policy for one response. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Serves the page shell with a per-request nonce, never cached (a cached copy would carry a
 * stale nonce).
 */
export function serveIndex(indexHtml: string): Handler {
  return (c) => {
    const nonce = newNonce();
    c.header("Content-Security-Policy", contentSecurityPolicy(nonce));
    c.header("Cache-Control", "no-store");
    return c.html(indexHtml.replaceAll(CSP_NONCE_PLACEHOLDER, nonce));
  };
}

/** Backstop: any other HTML response gets the policy too (with a nonce nothing uses). */
export const cspOnHtml: MiddlewareHandler = async (c, next) => {
  await next();
  const type = c.res.headers.get("Content-Type") ?? "";
  if (type.startsWith("text/html") && !c.res.headers.has("Content-Security-Policy")) {
    c.res.headers.set("Content-Security-Policy", contentSecurityPolicy(newNonce()));
  }
};
