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

// CI runs the suite with backups configured (E2E_BACKUPS), before the first backup.
test("the status page shows the backup line from /api/system/backup", async ({ page }) => {
  test.skip(!process.env.E2E_BACKUPS, "backups are configured only in CI (E2E_BACKUPS)");
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText("No backup yet", { exact: true })).toBeVisible();
  const backup = await page.evaluate(async () => (await fetch("/api/system/backup")).json());
  expect(backup).toEqual({ configured: true, last: null, stale: false, check: null, drill: null });
  await expect(page.getByText("No repository check yet", { exact: true })).toBeVisible();
  await expect(page.getByText("No restore drill yet", { exact: true })).toBeVisible();
});
