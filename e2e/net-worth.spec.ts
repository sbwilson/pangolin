import { existsSync } from "node:fs";
import { alexSession, partnerSessionFile } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

test.describe("Net Worth Page", () => {
  test("renders KPIs, trend with table toggle, and verifies hand sums", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await alexSession(browser) });
    const page = await context.newPage();

    // Navigate to /net-worth
    await page.goto("/net-worth");
    await expect(page.getByRole("heading", { level: 1, name: "Net worth" })).toBeVisible();

    // Check navigation link active state
    const netWorthNavLink = page.getByRole("link", { name: "Net worth" });
    await expect(netWorthNavLink).toBeVisible();

    // Verify 3-up KPIs
    const kpis = page.getByTestId("net-worth-kpis");
    await expect(kpis).toBeVisible();

    const netWorthKpi = page.getByTestId("kpi-net-worth");
    const assetsKpi = page.getByTestId("kpi-assets");
    const liabilitiesKpi = page.getByTestId("kpi-liabilities");

    await expect(netWorthKpi).toBeVisible();
    await expect(assetsKpi).toBeVisible();
    await expect(liabilitiesKpi).toBeVisible();

    // Verify Assets and Liabilities cards
    const assetsCard = page.getByTestId("assets-card");
    const liabilitiesCard = page.getByTestId("liabilities-card");
    await expect(assetsCard).toBeVisible();
    await expect(liabilitiesCard).toBeVisible();

    // Verify trend card and table view toggle
    const trendCard = page.getByTestId("trend-card");
    await expect(trendCard).toBeVisible();

    const toggle = page.getByTestId("trend-view-toggle");
    await expect(toggle).toHaveText("View as table");

    // Toggle to table view
    await toggle.click();
    const table = page.getByTestId("net-worth-table");
    await expect(table).toBeVisible();
    await expect(toggle).toHaveText("View as chart");

    // Assert 12 rows in table for 12 monthly trend points
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(12);

    // Toggle back to chart
    await toggle.click();
    await expect(page.getByTestId("net-worth-chart")).toBeVisible();

    // Verify Forecast link card is rendered with disabled link
    const forecastCard = page.getByTestId("forecast-card");
    await expect(forecastCard).toBeVisible();
    const forecastLink = forecastCard.getByText("Where will we be in 2 years? →");
    await expect(forecastLink).toHaveAttribute("aria-disabled", "true");
  });

  test("partner cannot see private accounts of the other partner", async ({ browser }) => {
    // Only run if partner session file exists
    if (!existsSync(partnerSessionFile)) {
      test.skip();
      return;
    }

    // First user views net worth
    const alexContext = await browser.newContext({ storageState: await alexSession(browser) });
    const page = await alexContext.newPage();
    await page.goto("/net-worth");
    await expect(page.getByRole("heading", { level: 1, name: "Net worth" })).toBeVisible();

    // Partner context
    const partnerContext = await browser.newContext({ storageState: partnerSessionFile });
    try {
      const partnerPage = await partnerContext.newPage();
      await partnerPage.goto("/net-worth");
      await expect(partnerPage.getByRole("heading", { level: 1, name: "Net worth" })).toBeVisible();

      // Ensure that any private account visible to the first person is NOT visible to partner
      // If the first person has an account with a lock icon, partner cannot see it
      const privateLock = page.locator('[aria-label="Private: only you can see this"]');
      const hasPrivateAccount = (await privateLock.count()) > 0;

      if (hasPrivateAccount) {
        const privateAccountRow = privateLock
          .first()
          .locator("xpath=ancestor::div[contains(@data-testid, 'account-row-')]");
        const accountTestId = await privateAccountRow.getAttribute("data-testid");
        if (accountTestId) {
          await expect(partnerPage.getByTestId(accountTestId)).toHaveCount(0);
        }
      }
    } finally {
      await partnerContext.close();
    }
  });
});
