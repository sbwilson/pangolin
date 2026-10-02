import { execSync } from "node:child_process";
import { loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

// CI starts the stack with an unconfirmed recovery bundle id (E2E_BUNDLE_ID, story 1.17).
const bundleId = process.env.E2E_BUNDLE_ID;
// Runs `pangolin confirm-bundle` in the stack (CI: `docker compose exec`); unset, the spec stops
// after the warning.
const confirmCommand = process.env.E2E_CONFIRM_BUNDLE_COMMAND;

test("the status page warns of an unconfirmed recovery bundle; /healthz stays ok", async ({
  page,
  request,
}) => {
  test.skip(bundleId === undefined, "a bundle id is set only in CI (E2E_BUNDLE_ID)");
  const healthz = await request.get("/healthz");
  expect(healthz.status()).toBe(200);
  expect(await healthz.json()).toMatchObject({
    ok: true,
    warnings: expect.arrayContaining(["recovery-bundle-unconfirmed"]),
  });

  await signInWithPassword(page, loadAccount());
  const alert = page.getByRole("alert").filter({ hasText: "recovery bundle" });
  await expect(alert).toContainText(`${bundleId} is not confirmed stored safely`);
  await expect(alert).toContainText("sudo pangolin confirm-bundle");

  if (confirmCommand === undefined || confirmCommand === "") return;
  expect(execSync(confirmCommand, { encoding: "utf8" })).toContain(
    `Recovery bundle ${bundleId} confirmed stored safely`,
  );
  await page.reload();
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "recovery bundle" })).toHaveCount(0);
  // /healthz reuses its answer for a second: poll past it.
  await expect
    .poll(
      async () =>
        ((await (await request.get("/healthz")).json()) as { warnings?: string[] }).warnings ?? [],
    )
    .not.toContain("recovery-bundle-unconfirmed");
});
