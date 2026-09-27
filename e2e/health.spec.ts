import { expect, test } from "@playwright/test";

test("the PWA shows the server as healthy at schema version 2", async ({ page, request }) => {
  const res = await request.get("/api/system/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", schemaVersion: 2, writable: true });

  await page.goto("/");
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(page.getByText("Schema version 2", { exact: true })).toBeVisible();
});
