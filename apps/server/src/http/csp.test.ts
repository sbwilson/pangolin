import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, cspOnHtml, newNonce, serveIndex } from "./csp.ts";

describe("contentSecurityPolicy", () => {
  it("is the strict policy with the nonce on style-src only", () => {
    expect(contentSecurityPolicy("abc")).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'nonce-abc'; img-src 'self'; " +
        "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; " +
        "frame-ancestors 'none'; form-action 'self'",
    );
    expect(contentSecurityPolicy("abc")).not.toMatch(/unsafe-(inline|eval)/);
  });

  it("makes a new 128-bit nonce each time", () => {
    const a = newNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});

describe("serveIndex and cspOnHtml", () => {
  it("replaces every placeholder with the header's nonce", async () => {
    const app = new Hono();
    app.get("/", serveIndex('<meta nonce="__CSP_NONCE__"><style nonce="__CSP_NONCE__"></style>'));
    const res = await app.request("/");
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
    expect(await res.text()).toBe(`<meta nonce="${nonce}"><style nonce="${nonce}"></style>`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("adds the policy to any other HTML response, and leaves JSON alone", async () => {
    const app = new Hono();
    app.use("*", cspOnHtml);
    app.get("/page", (c) => c.html("<p>hi</p>"));
    app.get("/data", (c) => c.json({}));
    expect((await app.request("/page")).headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect((await app.request("/data")).headers.get("content-security-policy")).toBeNull();
  });
});
