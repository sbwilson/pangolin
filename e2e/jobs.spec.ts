import { loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

test("the job status needs a session", async ({ request }) => {
  const res = await request.get("/api/system/jobs");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({
    error: { code: "Unauthenticated", message: "Sign in first" },
  });
});

test("once signed in, the PWA shows that no jobs need attention", async ({ page }) => {
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText("No jobs need attention", { exact: true })).toBeVisible();
  const jobs = await page.evaluate(async () => {
    const res = await fetch("/api/system/jobs");
    return { status: res.status, body: await res.json() };
  });
  expect(jobs).toEqual({ status: 200, body: { dead: [] } });
});
