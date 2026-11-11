import { describe, expect, it } from "vitest";
import { buildEndpointUrl, extractErrorMessage, parseRetryAfter } from "./http-helpers.ts";

describe("http-helpers", () => {
  describe("buildEndpointUrl", () => {
    it("appends path when baseUrl has no /v1 suffix", () => {
      expect(buildEndpointUrl("http://localhost:11434", "/v1/chat/completions")).toBe(
        "http://localhost:11434/v1/chat/completions",
      );
    });

    it("does not duplicate /v1 when baseUrl already ends with /v1", () => {
      expect(buildEndpointUrl("http://localhost:11434/v1", "/v1/chat/completions")).toBe(
        "http://localhost:11434/v1/chat/completions",
      );
      expect(buildEndpointUrl("http://localhost:11434/v1/", "/v1/chat/completions")).toBe(
        "http://localhost:11434/v1/chat/completions",
      );
    });

    it("strips accidentally pasted full route suffixes like /chat/completions or /v1/chat/completions", () => {
      expect(
        buildEndpointUrl("http://strix.net5.co:18080/v1/chat/completions", "/v1/chat/completions"),
      ).toBe("http://strix.net5.co:18080/v1/chat/completions");

      expect(
        buildEndpointUrl("http://strix.net5.co:18080/chat/completions", "/v1/chat/completions"),
      ).toBe("http://strix.net5.co:18080/v1/chat/completions");

      expect(
        buildEndpointUrl("http://strix.net5.co:18080/chat/completions/", "/v1/chat/completions"),
      ).toBe("http://strix.net5.co:18080/v1/chat/completions");
    });

    it("strips /messages or /v1/messages for anthropic endpoints", () => {
      expect(buildEndpointUrl("https://api.anthropic.com/v1/messages", "/v1/messages")).toBe(
        "https://api.anthropic.com/v1/messages",
      );

      expect(buildEndpointUrl("https://api.anthropic.com/messages", "/v1/messages")).toBe(
        "https://api.anthropic.com/v1/messages",
      );
    });

    it("handles whitespace in baseUrl", () => {
      expect(
        buildEndpointUrl(
          "  http://strix.net5.co:18080/v1/chat/completions  ",
          "/v1/chat/completions",
        ),
      ).toBe("http://strix.net5.co:18080/v1/chat/completions");
    });
  });

  describe("parseRetryAfter", () => {
    it("parses seconds", () => {
      expect(parseRetryAfter("30")).toBe(30);
      expect(parseRetryAfter("1.5")).toBe(1.5);
    });

    it("returns undefined for invalid or null", () => {
      expect(parseRetryAfter(null)).toBeUndefined();
      expect(parseRetryAfter("")).toBeUndefined();
      expect(parseRetryAfter("not-a-date")).toBeUndefined();
    });
  });

  describe("extractErrorMessage", () => {
    it("extracts error object message", () => {
      expect(
        extractErrorMessage(JSON.stringify({ error: { message: "Bad request" } }), "fallback"),
      ).toBe("Bad request");
    });

    it("extracts error string", () => {
      expect(
        extractErrorMessage(JSON.stringify({ error: "no route for this path" }), "fallback"),
      ).toBe("no route for this path");
    });

    it("extracts message string", () => {
      expect(extractErrorMessage(JSON.stringify({ message: "Custom message" }), "fallback")).toBe(
        "Custom message",
      );
    });

    it("falls back to raw text if short enough", () => {
      expect(extractErrorMessage("no route for this path", "fallback")).toBe(
        "no route for this path",
      );
    });
  });
});
