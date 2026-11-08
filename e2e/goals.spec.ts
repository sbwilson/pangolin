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

    // Switch to Personal scope: personal pool starts without a stage.
    await page.getByRole("button", { name: "Personal" }).click();

    // 1. Create a personal goal through the editor sheet.
    await page.getByRole("button", { name: "Add a goal" }).first().click();
    await page.getByRole("button", { name: "Alex" }).click();
    await page.getByLabel("Name").fill("E2E goal");
    await page.getByLabel("Target", { exact: true }).fill("100");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { level: 4, name: "E2E goal" })).toBeVisible();

    // 2. The personal pool starts without a stage: add one through the stage sheet.
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

    // 5. Open Cover an expense sheet, check proposals and close
    await page.getByRole("button", { name: "Cover an expense" }).first().click();
    await expect(page.getByTestId("cover-expense-sheet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cover an expense" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("cover-expense-sheet")).toBeHidden();

    await context.close();
  });

  test("interacts with savings review items in review inbox", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await alexSession(browser) });
    const page = await context.newPage();

    // Mock review API to deterministically supply savings review items
    await page.route("**/api/review", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "rev-lw-e2e",
              kind: "planning.savings.large_withdrawal",
              createdAt: "2026-07-15T12:00:00Z",
              accountId: "acc-savings-1",
              detail: {
                type: "savings_large_withdrawal",
                pool: "shared",
                bufferCents: 500_000,
                canTakeFromBuffer: true,
                isPersonal: false,
                transaction: {
                  id: "txn-lw-e2e",
                  accountId: "acc-savings-1",
                  postedOn: "2026-07-15",
                  amountCents: -250_000,
                  description: "Emergency repair",
                  payeeName: "FixIt Co",
                  accountName: "Joint Savings",
                  categoryId: null,
                  transferGroupId: null,
                },
              },
            },
            {
              id: "rev-sf-e2e",
              kind: "planning.savings.shortfall",
              createdAt: "2026-07-15T12:00:00Z",
              accountId: null,
              detail: {
                type: "savings_shortfall",
                pool: "shared",
                shortfallCents: 150_000,
                isPersonal: false,
                hasOpenLargeWithdrawal: false,
              },
            },
          ],
        }),
      });
    });

    await page.goto("/review");
    await page.waitForLoadState("domcontentloaded");

    // Direct assertions ensuring savings review elements and buttons are validated
    const largeWithdrawal = page.locator('[data-kind="planning.savings.large_withdrawal"]').first();
    await expect(largeWithdrawal).toBeVisible();
    await expect(largeWithdrawal.getByRole("button", { name: "Cover it" })).toBeVisible();
    await expect(
      largeWithdrawal.getByRole("button", { name: "Take it from the buffer" }),
    ).toBeVisible();

    const shortfall = page.locator('[data-kind="planning.savings.shortfall"]').first();
    await expect(shortfall).toBeVisible();
    await expect(shortfall.getByRole("button", { name: "Cover it" })).toBeVisible();

    await context.close();
  });
});
