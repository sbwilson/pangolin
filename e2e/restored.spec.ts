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

test("the status page shows the restored snapshot as the last backup", async ({ page }) => {
  // The restic snapshot the restore swapped in, from its output (CI sets it).
  const snapshot = process.env.E2E_RESTORED_SNAPSHOT ?? "";
  expect(snapshot).toMatch(/^[0-9a-f]{64}$/);
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText(/^Last backup .+ \(snapshot [0-9a-f]{8}\)$/)).toContainText(
    snapshot.slice(0, 8),
  );
  const backup = await page.evaluate(async () => (await fetch("/api/system/backup")).json());
  expect(backup).toMatchObject({ configured: true, last: { snapshotId: snapshot } });
});
