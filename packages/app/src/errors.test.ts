import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, ERROR_CODES, errorBody, parseInput } from "./errors.ts";

describe("AppError", () => {
  it("has exactly the six spine codes", () => {
    expect(ERROR_CODES).toEqual([
      "NotFound",
      "Validation",
      "Conflict",
      "Unauthenticated",
      "ReauthRequired",
      "RateLimited",
    ]);
  });

  it("carries code, message and optional details", () => {
    const err = new AppError("Conflict", "Name taken", { field: "name" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AppError");
    expect([err.code, err.message, err.details]).toEqual([
      "Conflict",
      "Name taken",
      { field: "name" },
    ]);
    expect("details" in new AppError("NotFound", "Gone")).toBe(false);
  });
});

describe("errorBody", () => {
  it.each(ERROR_CODES)("renders %s with its message", (code) => {
    expect(errorBody(new AppError(code, "msg"))).toEqual({ error: { code, message: "msg" } });
  });

  it("includes details only when present", () => {
    expect(errorBody(new AppError("Validation", "Bad", [{ path: ["x"] }]))).toEqual({
      error: { code: "Validation", message: "Bad", details: [{ path: ["x"] }] },
    });
  });

  it("maps a ZodError to Validation with its issues as details", () => {
    const result = z.object({ n: z.number() }).strict().safeParse({ n: "x", extra: 1 });
    if (result.success) throw new Error("expected a parse failure");
    const body = errorBody(result.error);
    expect(body.error.code).toBe("Validation");
    expect(body.error.message).toBe("Invalid input");
    expect(body.error.details).toEqual(result.error.issues);
  });

  it.each([
    new Error("SQLITE_ERROR at /data/pangolin.sqlite"),
    new TypeError("x is undefined"),
    "a string",
    undefined,
    { code: "NotFound", message: "looks like an AppError but is not" },
  ])("renders anything else as Internal without leaking it (%#)", (thrown) => {
    expect(errorBody(thrown)).toEqual({ error: { code: "Internal", message: "Internal error" } });
  });
});

describe("parseInput", () => {
  const schema = z.object({ n: z.coerce.number() }).strict();

  it("returns the parsed output", () => {
    expect(parseInput(schema, { n: "2" })).toEqual({ n: 2 });
  });

  it("throws AppError Validation with the issues", () => {
    let caught: unknown;
    try {
      parseInput(schema, { n: 1, other: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    const err = caught as AppError;
    expect(err.code).toBe("Validation");
    expect(err.details).toEqual([expect.objectContaining({ code: "unrecognized_keys" })]);
  });
});
