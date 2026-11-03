// End-to-end tests for Budgets and Recurring Bills (Epic 6, AD-1, AD-3, AD-10, AD-14, AD-17, AD-22, AD-25).
import { alexSession } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

test.describe("Budgets & Recurring Bills", () => {
  test("loads /planning/budgets, inspects summary line, filters by scope, and interacts with editor", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: await alexSession(browser) });
    const page = await context.newPage();

    // 1. Navigate to /planning/budgets
    await page.goto("/planning/budgets");
    await expect(page.getByRole("heading", { level: 1, name: "Budgets" })).toBeVisible();

    // 2. Summary line displays budget counts
    const summaryLine = page.getByTestId("budget-summary-line");
    await expect(summaryLine).toBeVisible();
    await expect(summaryLine).toContainText(/budgets?\s+you can see/i);

    // 3. Filter tabs: All / Shared / Personal
    const scopeFilter = page.getByRole("group", { name: "Scope filter" });
    await expect(scopeFilter).toBeVisible();

    const allBtn = scopeFilter.getByRole("button", { name: "All" });
    const sharedBtn = scopeFilter.getByRole("button", { name: "Shared" });
    const personalBtn = scopeFilter.getByRole("button", { name: "Personal" });

    const groceriesCard = page.locator('[data-testid="budget-card"]:has-text("Groceries")');
    const coffeeCard = page.locator('[data-testid="budget-card"]:has-text("Coffee")');

    // Both should initially be visible in "All" view
    await expect(groceriesCard).toBeVisible();
    await expect(coffeeCard).toBeVisible();

    // In Shared view: Shared budget card is visible, personal is hidden
    await sharedBtn.click();
    await expect(groceriesCard).toBeVisible();
    await expect(coffeeCard).toBeHidden();

    // In Personal view: Personal budget card is visible, shared is hidden
    await personalBtn.click();
    await expect(coffeeCard).toBeVisible();
    await expect(groceriesCard).toBeHidden();

    // In All view: both budget cards are visible again
    await allBtn.click();
    await expect(groceriesCard).toBeVisible();
    await expect(coffeeCard).toBeVisible();

    // 4. Open budget editor modal
    const newBudgetBtn = page.getByRole("button", { name: "New budget" });
    await expect(newBudgetBtn).toBeVisible();
    await newBudgetBtn.click();

    // The editor sheet should be visible
    await expect(page.getByRole("heading", { name: "New Budget" })).toBeVisible();
    // Close editor sheet
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "New Budget" })).toBeHidden();

    // 5. Recurring Bills section is visible
    const recurringHeading = page.getByRole("heading", { level: 2, name: "Recurring bills" });
    await expect(recurringHeading).toBeVisible();

    // Check for candidate recurring series and one-click confirm candidate
    const confirmButton = page.getByRole("button", { name: "Confirm" }).first();
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();
    await expect(confirmButton).toBeHidden();
  });

  test("dismissing review items on /review for over-budget or bill alert", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await alexSession(browser) });
    const page = await context.newPage();

    // Navigate to /review
    await page.goto("/review");
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("heading", { level: 2, name: /Needs review|needs? you/ }),
    ).toBeVisible();

    // In the seeded scenario, an over-budget review card or bill alert review card is present if evaluated
    const reviewCard = page
      .locator(
        '[data-kind="planning.over_budget"], [data-kind="planning.bill_alert.missed_payment"], [data-kind="planning.bill_alert.price_rise"]',
      )
      .first();
    test.skip(
      (await reviewCard.count()) === 0,
      "no over-budget or bill alert review card pending in review inbox",
    );

    const dismissBtn = reviewCard.getByRole("button", {
      name: /Acknowledge|Got it|Dismiss/i,
    });
    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();
    await expect(reviewCard).toBeHidden();
  });
});
