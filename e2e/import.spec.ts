// The Import popover end to end: open it from the shell header, drop a CommBank OFX file into a
// fresh account, read the announced summary, import it again for "nothing new", then drop a CSV
// with an unreadable row and follow "N need review" to /review. Unsupported files stay refused.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "importers",
  "fixtures",
);

/** A fresh account of Alex's own, so the import does not depend on what other specs seeded. */
async function createAccount(page: Page, name: string): Promise<void> {
  const status = await page.evaluate(async (accountName) => {
    const me = (await (await fetch("/api/identity/me")).json()) as { personId: string };
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: accountName,
        type: "transaction",
        currency: "AUD",
        isPrivate: false,
        owners: [{ personId: me.personId, shareBp: 10000 }],
      }),
    });
    return res.status;
  }, name);
  expect(status).toBe(201);
}

test("imports a file from the header popover, reports nothing new on a repeat, and links to Needs review", async ({
  page,
}) => {
  await signInWithPassword(page, loadAccount());
  const name = `Import e2e ${Date.now()}`;
  await createAccount(page, name);
  await page.goto("/transactions");

  const opener = page.getByRole("button", { name: "Import" }).first();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Import a bank file" });
  await expect(dialog).toBeVisible();

  // Nothing is importable until a supported file and an account are chosen.
  const submit = dialog.getByRole("button", { name: "Import", exact: true });
  await expect(submit).toBeDisabled();
  await dialog.getByTestId("import-file").setInputFiles({
    name: "statement.xlsx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a statement"),
  });
  await expect(dialog.getByRole("alert")).toHaveText(
    "We can't read .xlsx files. Try CSV, OFX, QIF or PDF.",
  );
  await expect(submit).toBeDisabled();

  const importOfx = async () => {
    await dialog.getByTestId("import-file").setInputFiles(join(fixtures, "commbank.ofx"));
    await dialog.getByLabel("Which account is this for?").selectOption({ label: name });
    await expect(submit).toBeEnabled();
    await submit.click();
  };

  const status = dialog.getByTestId("import-status");
  await importOfx();
  await expect(status).toHaveText(/^\d+ (new|imported)/);
  await expect(status).toHaveAttribute("aria-live", "polite");

  await importOfx();
  // The region also holds the review link while the first import's items are still open.
  await expect(status).toContainText("Nothing new. You've already imported all of this.");

  // A CSV with a row that cannot be read: it is set aside and counted in "need review".
  const csv = readFileSync(join(fixtures, "commbank.csv"), "utf8");
  await dialog.getByTestId("import-file").setInputFiles({
    name: "with-a-bad-row.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`${csv.trimEnd()}\n31/09/2026,abc,BAD ROW,1.00\n`),
  });
  await dialog.getByLabel("Which account is this for?").selectOption({ label: name });
  await submit.click();
  const review = status.getByRole("link", { name: /^\d+ needs? review$/ });
  await expect(review).toBeVisible();
  await review.click();
  await expect(page).toHaveURL((url) => url.pathname === "/review");
  await expect(dialog).toBeHidden();
});

test("Esc closes the popover and focus returns to the Import button", async ({ page }) => {
  await signInWithPassword(page, loadAccount());
  await page.goto("/transactions");
  const opener = page.getByRole("button", { name: "Import" }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Import a bank file" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("another person's account id answers 404 from the import route", async ({ page }) => {
  await signInWithPassword(page, loadAccount());
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "01J0000000000000000000ZZZZ",
        format: "commbank_csv",
        content: "Date,Amount,Description,Balance\n01/09/2026,-1.00,X,1.00",
      }),
    });
    return res.status;
  });
  expect(status).toBe(404);
});
