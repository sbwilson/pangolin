// Alex's end-to-end forecasting journey on the world ledger.spec.ts seeds (the reports project
// runs this file after the seed and before import.spec mutates it). Both seeded low-balance
// warnings show their stable day-0 amounts; the savings-rate chip edits to 60%, resets to the
// all-zero default and is edited back to 45%, with the net-worth headline moving each way;
// then Joint everyday's low-balance line is zeroed and restored from the accounts sheet,
// watching exactly that warning go and come back. The spec ends with the world seeded again —
// savings 45% and the $60,000 threshold — honoring the plan's invariant that it leaves the
// world as seeded, whatever runs after it.
import { alexSession } from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";

// Day 0 of every projection is today's snapshot balances, so these amounts hold on any server
// date; only the day label is left open (Person A private is negative at threshold 0, so it
// keeps the one warning when Joint everyday's threshold goes to $0).
const JOINT_WARNING = /Joint everyday could dip to \$58,909\.75 on \d{1,2} \w{3}/;
const PRIVATE_WARNING = /Person A private could dip to -\$14,292\.50 on \d{1,2} \w{3}/;

test.describe("Forecast journey", () => {
  test("seeded warnings, savings-rate edit/reset/restore, threshold zero/restore", async ({
    browser,
    cspViolations,
  }) => {
    const context = await browser.newContext({ storageState: await alexSession(browser) });
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    const warnings = page.getByTestId("forecast-warning");

    // --- The seeded warnings, over the chart ---
    await page.goto("/planning/forecast");
    await expect(
      page.getByRole("heading", { level: 1, name: "Forecast", exact: true }),
    ).toBeVisible();
    await expect(warnings).toHaveCount(2);
    await expect(warnings.filter({ hasText: JOINT_WARNING })).toHaveCount(1);
    await expect(warnings.filter({ hasText: PRIVATE_WARNING })).toHaveCount(1);
    await expect(page.getByTestId("forecast-chart")).toBeVisible();

    // --- Switch to net-worth mode: the headline and the seeded savings chip ---
    await page
      .getByRole("group", { name: "Forecast mode" })
      .getByRole("button", { name: "Net worth", exact: true })
      .click();
    await expect(page).toHaveURL(/mode=networth/);
    const headline = page.getByTestId("forecast-networth-headline");
    await expect(headline).toBeVisible();
    await expect(page.getByTestId("assumption-chips")).toBeVisible();
    const chip = page.getByTestId("assumption-chip-savings");
    await expect(chip).toContainText("Savings rate 45%");
    await expect(chip.getByRole("img", { name: "changed" })).toHaveCount(1);
    const baseline = (await headline.textContent()) ?? "";

    // --- Edit the savings rate to 60%: the chip follows, the headline redraws ---
    await page.getByRole("button", { name: "Savings rate: 45%. Edit" }).click();
    const editor = page.getByLabel("Savings rate", { exact: true });
    await editor.fill("60");
    await editor.press("Enter");
    await expect(chip).toContainText("Savings rate 60%");
    await expect(headline).not.toHaveText(baseline);
    const atSixty = (await headline.textContent()) ?? "";

    // --- Reset: the chip drops to the all-zero default, so the dot goes and the head moves ---
    await page.getByRole("button", { name: "Reset savings rate" }).click();
    await expect(chip).toContainText("Savings rate 0%");
    await expect(chip.getByRole("img", { name: "changed" })).toHaveCount(0);
    await expect(headline).not.toHaveText(atSixty);

    // --- Restore 45% by editing again: the same inputs recompute the same headline ---
    await page.getByRole("button", { name: "Savings rate: 0%. Edit" }).click();
    await editor.fill("45");
    await editor.press("Enter");
    await expect(chip).toContainText("Savings rate 45%");
    await expect(chip.getByRole("img", { name: "changed" })).toHaveCount(1);
    await expect(headline).toHaveText(baseline);

    // --- Zero Joint everyday's low-balance line: exactly its warning goes ---
    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
    await page.getByRole("button", { name: "Edit Joint everyday" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit account" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Low-balance line", { exact: true }).fill("0");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(sheet).toHaveCount(0);

    await page.goto("/planning/forecast");
    await expect(warnings).toHaveCount(1);
    await expect(warnings.filter({ hasText: JOINT_WARNING })).toHaveCount(0);
    await expect(warnings.filter({ hasText: PRIVATE_WARNING })).toHaveCount(1);

    // --- Restore the $60,000 line: both warnings are back, and the world is seeded again ---
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Edit Joint everyday" }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Low-balance line", { exact: true }).fill("60000");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(sheet).toHaveCount(0);

    await page.goto("/planning/forecast");
    await expect(warnings).toHaveCount(2);
    await expect(warnings.filter({ hasText: JOINT_WARNING })).toHaveCount(1);
    await expect(warnings.filter({ hasText: PRIVATE_WARNING })).toHaveCount(1);
  });
});
