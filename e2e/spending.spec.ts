import { alexSession, loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

const pad = (n: number) => String(n).padStart(2, "0");
const day = (year: number, month: number, date: number) => `${year}-${pad(month)}-${pad(date)}`;

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function quarterRange(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  const last = first + 2;
  return { from: day(year, first, 1), to: day(year, last, lastDay(year, last)) };
}

function formatCents(cents: number, currency = "AUD"): string {
  const value = cents === 0 ? 0 : cents / 100;
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(value);
}

test.describe("Spending Page", () => {
  test("renders spending page with bar lists, category bars, correct period change and drill-down", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: await alexSession(browser) });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-07-15T12:00:00Z"));

    // Navigate to /spending
    await page.goto("/spending");
    await expect(page.getByRole("heading", { level: 2, name: "Spending" })).toBeVisible();

    // Verify apportioned share line
    const shareLine = page.getByTestId("share-line");
    await expect(shareLine).toBeVisible();
    await expect(shareLine.getByTestId("share-line-text")).toBeVisible();

    // Verify My share toggle exists and works
    const myShareBtn = page.getByRole("button", { name: "My share" });
    await expect(myShareBtn).toBeVisible();
    await myShareBtn.click();
    await expect(page).toHaveURL(/share=mine/);

    const everythingBtn = page.getByRole("button", { name: "Everything I can see" });
    await expect(everythingBtn).toBeVisible();
    await everythingBtn.click();
    await expect(page).not.toHaveURL(/share=mine/);

    // Verify Income and Expense bar lists card
    const barListsCard = page.getByTestId("bar-lists-card");
    await expect(barListsCard).toBeVisible();
    await expect(page.getByTestId("income-bar-card")).toBeVisible();
    await expect(page.getByTestId("expense-bar-card")).toBeVisible();

    // Verify Spending by category card
    const categoryBarsCard = page.getByTestId("spending-category-bars-card");
    await expect(categoryBarsCard).toBeVisible();
    await expect(
      categoryBarsCard.getByRole("heading", { name: "Spending by category" }),
    ).toBeVisible();

    // Extract current URL range or derive dynamically from quarterRange(today)
    const url = new URL(page.url());
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const activeRange =
      fromParam && toParam ? { from: fromParam, to: toParam } : quarterRange("2026-07-15");

    // Fetch the server's spending report for category breakdown
    const spendingQuery = `from=${activeRange.from}&to=${activeRange.to}&by=category`;
    const pnlRes = await page.request.get(`/api/reports/pnl?${spendingQuery}`);
    expect(pnlRes.ok()).toBeTruthy();
    const pnlData = (await pnlRes.json()) as {
      from: string;
      to: string;
      expense: {
        totalCents: number;
        rows: { id: string | null; name: string | null; cents: number }[];
      };
    };

    // Verify category totals equal the sum of rows
    const totalHandSumCents = pnlData.expense.rows.reduce((sum, r) => sum + r.cents, 0);
    expect(totalHandSumCents).toBe(pnlData.expense.totalCents);

    // Verify category rows are present and rendered
    const categoryRows = categoryBarsCard.locator("[data-testid^='category-row-']");
    const rowCount = await categoryRows.count();
    expect(rowCount).toBe(pnlData.expense.rows.length);

    // Verify each category row's formatted amount matches server response and change indicator is valid
    for (const serverRow of pnlData.expense.rows) {
      const rowId = serverRow.id ?? "uncategorised";
      const rowEl = categoryBarsCard.locator(`[data-testid='category-row-${rowId}']`);
      await expect(rowEl).toBeVisible();

      // Verify formatted amount
      const expectedAmount = formatCents(serverRow.cents);
      await expect(rowEl).toContainText(expectedAmount);

      // Verify change indicator text has ↑, ↓, or same as last
      const changeEl = rowEl.locator(`[data-testid='category-change-${rowId}']`);
      await expect(changeEl).toBeVisible();
      const changeText = (await changeEl.innerText()).trim();
      expect(
        changeText.startsWith("↑") ||
          changeText.startsWith("↓") ||
          changeText.startsWith("same as last"),
      ).toBeTruthy();
    }

    // Verify flexible badges appear when isFixedCost is false
    const categoriesRes = await page.request.get("/api/classify/categories");
    expect(categoriesRes.ok()).toBeTruthy();
    const categoriesData = (await categoriesRes.json()) as {
      categories: { id: string; name: string; isFixedCost: boolean }[];
    };
    const flexibleIds = new Set(
      categoriesData.categories.filter((c) => !c.isFixedCost).map((c) => c.id),
    );
    for (const catId of flexibleIds) {
      const row = categoryBarsCard.locator(`[data-testid='category-row-${catId}']`);
      if ((await row.count()) > 0) {
        await expect(row.getByTestId("flexible-badge")).toBeVisible();
      }
    }

    // Verify drill-down to /transactions on category row click
    const firstLink = categoryRows.first();
    await firstLink.click();
    await expect(page).toHaveURL(/\/transactions/);
    const transactionsUrl = new URL(page.url());
    expect(
      transactionsUrl.searchParams.has("category") ||
        transactionsUrl.searchParams.has("uncategorised"),
    ).toBeTruthy();
  });

  test("sidebar and mobile navigation contain active Spending link", async ({ page }) => {
    await signInWithPassword(page, loadAccount());

    // Desktop sidebar link
    await page.goto("/cash-flow");
    const sidebar = page.getByRole("navigation", { name: "Main" });
    const spendingLink = sidebar.getByRole("link", { name: "Spending" });
    await expect(spendingLink).toBeVisible();
    await spendingLink.click();
    await expect(page).toHaveURL(/\/spending/);
    await expect(spendingLink).toHaveAttribute("aria-current", "page");

    // Mobile view: test Spending link in "More" sheet
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/cash-flow");
    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNav).toBeVisible();

    const moreBtn = mobileNav.getByRole("button", { name: "More" });
    await moreBtn.click();

    const spendingMobileBtn = page.getByRole("button", { name: "Spending" });
    await expect(spendingMobileBtn).toBeVisible();
    await spendingMobileBtn.click();
    await expect(page).toHaveURL(/\/spending/);
  });
});
