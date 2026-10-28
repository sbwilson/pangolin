import { describe, expect, it } from "vitest";
import { normaliseDomain, payeeLogoUrl } from "./domain.ts";

describe("normaliseDomain", () => {
  it("lowercases and strips scheme, www, path, query, fragment, port", () => {
    expect(normaliseDomain("Shop.Example.COM")).toBe("shop.example.com");
    expect(normaliseDomain("https://www.example.com")).toBe("example.com");
    expect(normaliseDomain("http://Example.com/")).toBe("example.com");
    expect(normaliseDomain("example.com/path/to/page")).toBe("example.com");
    expect(normaliseDomain("example.com/?q=1#frag")).toBe("example.com");
    expect(normaliseDomain("https://example.com:8443/stuff")).toBe("example.com");
    expect(normaliseDomain("  https://www.Coffee.shop/menu  ")).toBe("coffee.shop");
  });

  it("strips userinfo and trailing dot", () => {
    expect(normaliseDomain("http://user:pass@example.com")).toBe("example.com");
    expect(normaliseDomain("example.com.")).toBe("example.com");
  });

  it("keeps subdomains other than www", () => {
    expect(normaliseDomain("cdn.example.com")).toBe("cdn.example.com");
    expect(normaliseDomain("https://shop.example.co.uk")).toBe("shop.example.co.uk");
  });

  it("rejects IP literals", () => {
    expect(normaliseDomain("192.168.1.1")).toBeNull();
    expect(normaliseDomain("http://10.0.0.5:8080/path")).toBeNull();
    expect(normaliseDomain("[::1]")).toBeNull();
    expect(normaliseDomain("999.1.1.1")).toBeNull(); // not a valid octet, and not DNS-shaped either
  });

  it("rejects single-label hosts and private names", () => {
    expect(normaliseDomain("coffee")).toBeNull();
    expect(normaliseDomain("localhost")).toBeNull();
    expect(normaliseDomain("server.local")).toBeNull();
    expect(normaliseDomain("app.internal")).toBeNull();
    expect(normaliseDomain("printer.lan")).toBeNull();
  });

  it("rejects reserved / documentation TLDs", () => {
    expect(normaliseDomain("example.com")).toBe("example.com"); // .com is fine — only exact reserved TLDs are rejected
    expect(normaliseDomain("exa-m-ple.test")).toBeNull();
    expect(normaliseDomain("anything.invalid")).toBeNull();
    expect(normaliseDomain("site.example")).toBeNull();
    expect(normaliseDomain("hidden.onion")).toBeNull();
  });

  it("rejects malformed labels and empty input", () => {
    expect(normaliseDomain("")).toBeNull();
    expect(normaliseDomain("   ")).toBeNull();
    expect(normaliseDomain("https://")).toBeNull();
    expect(normaliseDomain("-bad.example.com")).toBeNull();
    expect(normaliseDomain("bad-.example.com")).toBeNull();
    expect(normaliseDomain("under_score.com")).toBeNull();
    expect(normaliseDomain("a..b.com")).toBeNull();
    expect(normaliseDomain(null)).toBeNull();
    expect(normaliseDomain(undefined)).toBeNull();
  });
});

describe("payeeLogoUrl", () => {
  it("builds the same-host logo URL for a payee", () => {
    expect(payeeLogoUrl("payee_1")).toBe("/api/payees/payee_1/logo");
  });

  it("URL-encodes the payee id", () => {
    expect(payeeLogoUrl("a b/c")).toBe("/api/payees/a%20b%2Fc/logo");
  });
});
