import { expect, test } from "@playwright/test";

test("the PWA shows the server as healthy at schema version 3", async ({ page, request }) => {
  const res = await request.get("/api/system/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", schemaVersion: 3, writable: true });

  await page.goto("/");
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(page.getByText("Schema version 3", { exact: true })).toBeVisible();
});

test("the PWA shows that no jobs need attention", async ({ page, request }) => {
  const res = await request.get("/api/system/jobs");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ dead: [] });

  await page.goto("/");
  await expect(page.getByText("No jobs need attention", { exact: true })).toBeVisible();
});
