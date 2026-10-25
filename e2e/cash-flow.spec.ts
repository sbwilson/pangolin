import { alexSession } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

test.describe("Cash Flow & Sankey", () => {
  test("desktop renders Sankey and P&L table with matching totals and zero CSP violations", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: await alexSession(browser) });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-07-15T12:00:00Z"));

    await page.goto("/cash-flow");
    await expect(page.getByRole("heading", { level: 2, name: "Cash flow" })).toBeVisible();

    // Verify KPI tiles
    const tiles = page.getByTestId("cash-flow-tiles");
    await expect(tiles).toBeVisible();

    // Verify desktop Sankey card
    const sankeyCard = page.getByTestId("sankey-card");
    await expect(sankeyCard).toBeVisible();

    // Test detail level segmented controls (Groups -> Categories -> Both)
    const categoriesButton = page.getByRole("button", { name: "Categories" });
    await expect(categoriesButton).toBeVisible();
    await categoriesButton.click();
    await expect(categoriesButton).toHaveAttribute("aria-pressed", "true");

    const bothButton = page.getByRole("button", { name: "Both" });
    await expect(bothButton).toBeVisible();
    await bothButton.click();
    await expect(bothButton).toHaveAttribute("aria-pressed", "true");

    const groupsButton = page.getByRole("button", { name: "Groups" });
    await expect(groupsButton).toBeVisible();
    await groupsButton.click();
    await expect(groupsButton).toHaveAttribute("aria-pressed", "true");

    // Switch to Profit & loss table view
    const pnlButton = page.getByRole("button", { name: "Profit & loss" });
    await expect(pnlButton).toBeVisible();
    await pnlButton.click();

    // Verify P&L table renders
    const pnlTable = page.getByTestId("pnl-table");
    await expect(pnlTable).toBeVisible();

    // Switch back to Sankey to verify chart re-mounts without blank canvas
    const flowButton = page.getByRole("button", { name: "Sankey" });
    await expect(flowButton).toBeVisible();
    await flowButton.click();
    await expect(page.getByTestId("sankey-chart")).toBeVisible();

    // Switch back to Profit & loss table for table extraction
    await pnlButton.click();
    await expect(pnlTable).toBeVisible();

    // Extract Money in / Income and Money out / Expenses and verify equality
    const moneyInText = await tiles.locator("dd").nth(0).innerText();
    const moneyOutText = await tiles.locator("dd").nth(1).innerText();
    const keptText = await tiles.locator("dd").nth(2).innerText();

    const pnlIncomeText = await pnlTable
      .locator("tr")
      .filter({ hasText: "Income" })
      .first()
      .locator("td")
      .nth(1)
      .innerText();
    const pnlExpenseText = await pnlTable
      .locator("tr")
      .filter({ hasText: "Expenses" })
      .first()
      .locator("td")
      .nth(1)
      .innerText();
    const pnlKeptText = await pnlTable
      .locator("tr")
      .filter({ hasText: "Kept" })
      .first()
      .locator("td")
      .nth(1)
      .innerText();

    expect(pnlIncomeText).toBe(moneyInText);
    expect(pnlExpenseText).toBe(moneyOutText);
    expect(pnlKeptText).toBe(keptText);

    // Test drill-down link from P&L table to /transactions
    const firstRowLink = pnlTable.locator("tbody tr a").first();
    if (await firstRowLink.isVisible()) {
      const href = await firstRowLink.getAttribute("href");
      expect(href).toContain("/transactions");
      await firstRowLink.click();
      await expect(page).toHaveURL(/\/transactions/);
    }
  });

  test("phone view (< md, 375 px) renders P&L table directly with no chart canvas", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: await alexSession(browser),
      viewport: { width: 375, height: 667 },
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-07-15T12:00:00Z"));

    await page.goto("/cash-flow");
    await expect(page.getByRole("heading", { level: 2, name: "Cash flow" })).toBeVisible();

    // On phone, P&L table is rendered directly under phone container
    const phoneContainer = page.getByTestId("sankey-card-phone");
    await expect(phoneContainer).toBeVisible();
    await expect(phoneContainer.getByTestId("pnl-table")).toBeVisible();

    // No chart canvas is rendered on phone
    await expect(page.getByTestId("sankey-chart")).toHaveCount(0);
  });
});
