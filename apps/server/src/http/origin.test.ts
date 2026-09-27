import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { originCheck } from "./origin.ts";

function app() {
  let ran = 0;
  const hono = new Hono();
  hono.use("/api/*", originCheck("http://localhost:3000"));
  hono.all("/api/x", (c) => {
    ran++;
    return c.text("ran");
  });
  return { hono, ran: () => ran };
}

describe("originCheck", () => {
  it("lets GET and HEAD through without an Origin", async () => {
    const { hono, ran } = app();
    expect((await hono.request("/api/x")).status).toBe(200);
    expect((await hono.request("/api/x", { method: "HEAD" })).status).toBe(200);
    expect(ran()).toBe(2);
  });

  it("lets a write from our own origin through", async () => {
    const { hono } = app();
    const res = await hono.request("/api/x", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(await res.text()).toBe("ran");
  });

  it.each([
    ["a foreign origin", { Origin: "https://evil.example" }],
    ["a different port", { Origin: "http://localhost:3001" }],
    ["a different scheme", { Origin: "https://localhost:3000" }],
    ["the literal null origin", { Origin: "null" }],
    ["no Origin", {}],
  ])("refuses a write from %s with 403 in the error shape, running nothing", async (_, headers) => {
    const { hono, ran } = app();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await hono.request("/api/x", { method, headers });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "Forbidden", message: "Cross-origin request refused" },
      });
    }
    expect(ran()).toBe(0);
  });
});
