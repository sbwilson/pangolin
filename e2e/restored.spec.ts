// Story 1.10, after a restore: run only with E2E_RESTORED set (the `restored` project), against a
// server restored from a backup of the household the other specs built, into the running
// stack's volume or onto a fresh one from the recovery bundle's values alone. The first person
// signs in with the password and TOTP secret the suite saved (`loadAccount`): the TOTP secret is
// encrypted under the auth secret, so this proves the bundle's auth secret came along.
import { loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

test("the restored household signs in with the saved password and TOTP code", async ({ page }) => {
  const account = loadAccount();
  await signInWithPassword(page, account);
  await expect(page.getByText("Signed in as Alex")).toBeVisible();
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  const me = await page.evaluate(async () => (await fetch("/api/identity/me")).json());
  expect(me).toMatchObject({ displayName: "Alex", enrolment: "complete" });
});
