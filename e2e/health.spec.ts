import { readdirSync } from "node:fs";
import { expect, test } from "./helpers/csp.ts";

// One migration per schema version, so the next migration needs no edit here.
const schemaVersion = readdirSync(new URL("../packages/db/migrations", import.meta.url)).filter(
  (name) => name.endsWith(".sql"),
).length;

test("the PWA shows the server as healthy at the current schema version", async ({
  page,
  request,
}) => {
  const res = await request.get("/api/system/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", schemaVersion, writable: true });

  await page.goto("/");
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(page.getByText(`Schema version ${schemaVersion}`, { exact: true })).toBeVisible();
});

test("the CSP guard fails a test whose page violates the policy", async ({
  page,
  cspViolations,
}) => {
  // The guard's own check: this test must fail, in the guard, after the page injects a style.
  test.fail();
  await page.goto("/");
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "body { color: red; }";
    document.head.append(style);
  });
  await expect.poll(() => cspViolations.length).toBeGreaterThan(0);
});
