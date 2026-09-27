import { AppError, ERROR_CODES, type ErrorCode } from "@pangolin/app";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createErrorHandler, httpStatus } from "./errors.ts";

const EXPECTED: Record<ErrorCode, number> = {
  NotFound: 404,
  Validation: 400,
  Conflict: 409,
  Unauthenticated: 401,
  ReauthRequired: 403,
  RateLimited: 429,
};

function appThrowing(thrown: () => unknown, logged: unknown[] = []) {
  const app = new Hono();
  app.onError(createErrorHandler((err) => logged.push(err)));
  app.get("/x", () => {
    throw thrown();
  });
  return app;
}

describe("httpStatus", () => {
  it("maps every code, and Internal to 500", () => {
    for (const code of ERROR_CODES) expect(httpStatus(code)).toBe(EXPECTED[code]);
    expect(httpStatus("Internal")).toBe(500);
  });
});

describe("error handler", () => {
  it.each(ERROR_CODES)(
    "answers an AppError %s with its status and the error shape",
    async (code) => {
      const logged: unknown[] = [];
      const res = await appThrowing(() => new AppError(code, `a ${code}`), logged).request("/x");
      expect(res.status).toBe(EXPECTED[code]);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: { code, message: `a ${code}` } });
      expect(logged).toEqual([]);
    },
  );

  it("answers Conflict with 409 and keeps details", async () => {
    const res = await appThrowing(
      () => new AppError("Conflict", "Name already used", { field: "name" }),
    ).request("/x");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "Conflict", message: "Name already used", details: { field: "name" } },
    });
  });

  it("answers a ZodError with 400 Validation and its issues", async () => {
    const res = await appThrowing(() => {
      const result = z.object({ n: z.number() }).safeParse({ n: "x" });
      return result.error;
    }).request("/x");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe("Validation");
    expect(body.error.details).toEqual([expect.objectContaining({ path: ["n"] })]);
  });

  it("keeps Hono's HTTPException response and does not log it as internal", async () => {
    const logged: unknown[] = [];
    const res = await appThrowing(() => new HTTPException(413), logged).request("/x");
    expect(res.status).toBe(413);
    expect(logged).toEqual([]);
  });

  it("answers an unknown throw with 500 Internal, logs it and leaks nothing", async () => {
    const logged: unknown[] = [];
    const err = new Error("db path /x");
    const res = await appThrowing(() => err, logged).request("/x");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "Internal", message: "Internal error" } });
    expect(text).not.toContain("db path");
    expect(text).not.toContain("/x");
    expect(logged).toEqual([err]);
  });
});

describe("default internal-error logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one JSON line to stderr with level, name and message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new Hono();
    app.onError(createErrorHandler());
    app.get("/x", () => {
      throw new TypeError("db path /x");
    });
    const res = await app.request("/x");
    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({
      level: "error",
      msg: "unhandled",
      error: "TypeError: db path /x",
    });
  });
});
