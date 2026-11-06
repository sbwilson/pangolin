// End-to-end tests for the Goals workspace (Epic 7, story 7.4): goal CRUD and stage shares
// through the new write routes, against the household the auth project registers.
import { alexSession } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

test.describe("Goals workspace", () => {
  test("creates a goal, adds a stage, sets its share, and cleans up", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await alexSession(browser) });
    const page = await context.newPage();

    await page.goto("/planning/goals");
    await expect(page.getByRole("heading", { level: 1, name: "Goals & Savings" })).toBeVisible();

    // 1. Create a shared goal through the editor sheet.
    await page.getByRole("button", { name: "Add a goal" }).first().click();
    await page.getByLabel("Name").fill("E2E goal");
    await page.getByLabel("Target", { exact: true }).fill("100");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { level: 4, name: "E2E goal" })).toBeVisible();

    // 2. The pool starts without a stage: add one through the stage sheet.
    await page.getByRole("button", { name: "Add a stage" }).first().click();
    await expect(page.getByRole("heading", { name: "Allocation stages" })).toBeVisible();
    await page.getByLabel("Stage name").fill("E2E stage");
    // Share 60% with the new goal; the sheet shows the 40% buffer remainder.
    await page.getByLabel("E2E goal share percent").fill("60");
    await expect(page.getByText("Goals take 60% · buffer keeps 40%")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();

    // 3. The stage card now carries the stage with its share chips.
    await expect(page.getByText("E2E stage")).toBeVisible();
    await expect(page.getByText("E2E goal", { exact: true }).first()).toBeVisible();

    // 4. Clean up: delete the stage, then the goal, from the same sheets.
    await page.getByRole("button", { name: "Edit stages" }).first().click();
    await page.getByRole("button", { name: "Delete stage" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByRole("heading", { name: "Allocation stages" })).toBeHidden();

    await page.getByRole("button", { name: "Edit E2E goal" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByRole("heading", { level: 4, name: "E2E goal" })).toBeHidden();

    await context.close();
  });
});
