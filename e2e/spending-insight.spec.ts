import { existsSync } from "node:fs";
import type { Browser } from "@playwright/test";
import {
  firstSessionFile,
  loadAccount,
  partnerSessionFile,
  signInWithPassword,
} from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";

const pad = (n: number) => String(n).padStart(2, "0");
const day = (year: number, month: number, date: number) => `${year}-${pad(month)}-${pad(date)}`;

function localDay(date: Date): string {
  return day(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

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

let signedIn: Promise<string> | undefined;

function alexSession(browser: Browser): Promise<string> {
  if (existsSync(firstSessionFile)) {
    return Promise.resolve(firstSessionFile);
  }
  signedIn ??= (async () => {
    const account = loadAccount();
    for (let attempt = 0; attempt < 2; attempt++) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await signInWithPassword(page, account);
        const landed = await page
          .getByText("Signed in as Alex")
          .waitFor({ timeout: 10_000 })
          .then(
            () => true,
            () => false,
          );
        if (landed) {
          await context.storageState({ path: firstSessionFile });
          return firstSessionFile;
        }
      } catch {
        // Transient error during sign in attempt; proceed to wait and retry
      } finally {
        await context.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500));
    }
    throw new Error("Alex could not sign in with password and TOTP (twice)");
  })();
  return signedIn;
}

test.describe("End-to-end spending insight journey", () => {
  test("complete cross-epic journey across Cash Flow, Settings, Spending, and Net Worth for both partners", async ({
    browser,
    cspViolations,
  }) => {
    const context = await browser.newContext({ storageState: await alexSession(browser) });
    try {
      await watchCsp(context, cspViolations);
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date("2026-07-15T12:00:00Z"));

      // 1. Landing redirect from / to /cash-flow (Done-when 4)
      await page.goto("/");
      await expect(page).toHaveURL((url) => url.pathname === "/cash-flow");
      await expect(page.getByRole("heading", { level: 2, name: "Cash flow" })).toBeVisible();

      // Verify 4 KPI tiles
      const tiles = page.getByTestId("cash-flow-tiles");
      await expect(tiles).toBeVisible();
      for (const label of ["Money in", "Money out", "Kept", "Savings rate"]) {
        await expect(tiles.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(tiles.locator("dd")).toHaveCount(4);

      // Verify apportioned share line and My share / Everything I can see toggle
      const shareLine = page.getByTestId("share-line");
      await expect(shareLine).toBeVisible();
      const shareLineText = page.getByTestId("share-line-text");
      await expect(shareLineText).toBeVisible();

      const myShareBtn = page.getByRole("button", { name: "My share" });
      const everythingBtn = page.getByRole("button", { name: "Everything I can see" });
      await expect(myShareBtn).toBeVisible();
      await expect(everythingBtn).toBeVisible();

      // 2. Sankey controls & P&L totals hand-sum equality (Done-when 1)
      const sankeyCard = page.getByTestId("sankey-card");
      await expect(sankeyCard).toBeVisible();

      // Detail segmented controls
      const categoriesButton = page.getByRole("button", { name: "Categories" });
      await categoriesButton.click();
      await expect(categoriesButton).toHaveAttribute("aria-pressed", "true");

      const bothButton = page.getByRole("button", { name: "Both" });
      await bothButton.click();
      await expect(bothButton).toHaveAttribute("aria-pressed", "true");

      const groupsButton = page.getByRole("button", { name: "Groups" });
      await groupsButton.click();
      await expect(groupsButton).toHaveAttribute("aria-pressed", "true");

      // Switch to Profit & loss table
      const pnlButton = page.getByRole("button", { name: "Profit & loss" });
      await pnlButton.click();
      const pnlTable = page.getByTestId("pnl-table");
      await expect(pnlTable).toBeVisible();

      // Switch back to Flow to verify re-mount
      const flowButton = page.getByRole("button", { name: "Flow" });
      await flowButton.click();
      await expect(page.getByTestId("sankey-chart")).toBeVisible();

      // Switch back to P&L table to extract and compare figures
      await pnlButton.click();
      await expect(pnlTable).toBeVisible();

      const moneyInText = (await tiles.locator("dd").nth(0).innerText()).trim();
      const moneyOutText = (await tiles.locator("dd").nth(1).innerText()).trim();
      const keptText = (await tiles.locator("dd").nth(2).innerText()).trim();

      const pnlIncomeText = (
        await pnlTable
          .locator("tr")
          .filter({ hasText: "Income" })
          .first()
          .locator("td")
          .nth(1)
          .innerText()
      ).trim();
      const pnlExpenseText = (
        await pnlTable
          .locator("tr")
          .filter({ hasText: "Expenses" })
          .first()
          .locator("td")
          .nth(1)
          .innerText()
      ).trim();
      const pnlKeptText = (
        await pnlTable
          .locator("tr")
          .filter({ hasText: "Kept" })
          .first()
          .locator("td")
          .nth(1)
          .innerText()
      ).trim();

      expect(pnlIncomeText).toBe(moneyInText);
      expect(pnlExpenseText).toBe(moneyOutText);
      expect(pnlKeptText).toBe(keptText);

      // P&L drill-down link to /transactions
      const firstRowLink = pnlTable.locator("tbody tr a").first();
      await expect(firstRowLink).toBeVisible();
      const href = await firstRowLink.getAttribute("href");
      expect(href).toContain("/transactions");

      // 3. Share toggle on Cash Flow (Done-when 4)
      const scoped = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === "/api/reports/cash-flow" &&
          new URL(res.url()).searchParams.get("share") === "mine",
      );
      await myShareBtn.click();
      await scoped;
      await expect(page).toHaveURL((url) => url.searchParams.get("share") === "mine");
      await expect(myShareBtn).toHaveAttribute("aria-pressed", "true");
      await expect(shareLine).toBeVisible();
      await expect(shareLineText).toBeVisible();

      const resetScope = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === "/api/reports/cash-flow" &&
          !new URL(res.url()).searchParams.has("share"),
      );
      await everythingBtn.click();
      await resetScope;
      await expect(page).toHaveURL((url) => !url.searchParams.has("share"));
      await expect(everythingBtn).toHaveAttribute("aria-pressed", "true");
      await expect(shareLine).toBeVisible();

      // 4. Household 50/50 attribution setting change & revert (Done-when 3)
      try {
        await page.goto("/settings#household");
        const householdCard = page.locator("#household");
        await expect(householdCard).toBeVisible();

        const attributionGroup = householdCard.getByRole("radiogroup", {
          name: "Shared spending attribution",
        });
        await expect(attributionGroup).toBeVisible();

        const radio5050 = attributionGroup.getByRole("radio", { name: /50\/50/ });
        const radioContrib = attributionGroup.getByRole("radio", { name: /By contribution/ });
        await expect(radioContrib).toBeVisible();
        await expect(radioContrib).toHaveAttribute("aria-checked", "true");

        const patchTo5050 = page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === "/api/system/household" &&
            res.request().method() === "PATCH",
        );
        await radio5050.click();
        const patchRes = await patchTo5050;
        expect(patchRes.status()).toBe(200);
        await expect(radio5050).toHaveAttribute("aria-checked", "true");

        // Verify share line on Cash Flow under 50/50
        await page.goto("/cash-flow");
        await expect(shareLine).toBeVisible();
        const activeUrl = new URL(page.url());
        const fromParam = activeUrl.searchParams.get("from");
        const toParam = activeUrl.searchParams.get("to");
        const range =
          fromParam && toParam
            ? { from: fromParam, to: toParam }
            : quarterRange(localDay(new Date()));
        const queryStr = `?from=${range.from}&to=${range.to}`;

        const alexShareRes = await page.request.get(`/api/reports/shared-apportionment${queryStr}`);
        expect(alexShareRes.status()).toBe(200);
        const alexShareData = (await alexShareRes.json()) as {
          setting: string;
          sharedCents: number;
          shareCents: number;
          sharePercent: number | null;
        };
        expect(alexShareData.setting).toBe("even");
        expect(alexShareData.sharedCents).toBeGreaterThan(0);
        expect(
          Math.abs(alexShareData.shareCents * 2 - alexShareData.sharedCents),
        ).toBeLessThanOrEqual(1);

        // Partner session verification under 50/50
        expect(existsSync(partnerSessionFile), "partnerSessionFile must exist from auth spec").toBe(
          true,
        );
        const partnerContext = await browser.newContext({ storageState: partnerSessionFile });
        try {
          await watchCsp(partnerContext, cspViolations);
          const partnerPage = await partnerContext.newPage();
          await partnerPage.goto(`/cash-flow${queryStr}`);
          await expect(
            partnerPage.getByRole("heading", { level: 2, name: "Cash flow" }),
          ).toBeVisible();

          const samShareRes = await partnerPage.request.get(
            `/api/reports/shared-apportionment${queryStr}`,
          );
          expect(samShareRes.status()).toBe(200);
          const samShareData = (await samShareRes.json()) as {
            setting: string;
            sharedCents: number;
            shareCents: number;
            sharePercent: number | null;
          };
          expect(samShareData.setting).toBe("even");
          // Identity of shared figures (Done-when 2 & 3)
          expect(samShareData.sharedCents).toBe(alexShareData.sharedCents);
          expect(samShareData.shareCents + alexShareData.shareCents).toBe(
            alexShareData.sharedCents,
          );
        } finally {
          await partnerContext.close();
        }
      } finally {
        // Cleanly reset attribution back to "By contribution"
        try {
          await page.goto("/settings#household");
          const householdCard = page.locator("#household");
          const radioContrib = householdCard
            .getByRole("radiogroup", { name: "Shared spending attribution" })
            .getByRole("radio", { name: /By contribution/ });
          if ((await radioContrib.getAttribute("aria-checked")) !== "true") {
            const patchToContrib = page.waitForResponse(
              (res) =>
                new URL(res.url()).pathname === "/api/system/household" &&
                res.request().method() === "PATCH",
            );
            await radioContrib.click();
            const revertRes = await patchToContrib;
            expect(revertRes.status()).toBe(200);
          }
          await expect(radioContrib).toHaveAttribute("aria-checked", "true");
        } catch {
          // Fallback direct API reset to guarantee setting is restored even if UI navigation throws
          await page.request.patch("/api/system/household", {
            data: { sharedAttribution: "contribution" },
          });
        }
      }

      // 5. Spending page category breakdown & Biggest Little Leaks (Done-when 1 & 4)
      await page.goto("/spending");
      await expect(page.getByRole("heading", { level: 2, name: "Spending" })).toBeVisible();
      await expect(page.getByTestId("share-line")).toBeVisible();

      // Hand-sum equality across category rows
      const spendingUrl = new URL(page.url());
      const spFrom = spendingUrl.searchParams.get("from");
      const spTo = spendingUrl.searchParams.get("to");
      const spRange =
        spFrom && spTo ? { from: spFrom, to: spTo } : quarterRange(localDay(new Date()));
      const spQuery = `from=${spRange.from}&to=${spRange.to}&by=category`;
      const pnlCatRes = await page.request.get(`/api/reports/pnl?${spQuery}`);
      expect(pnlCatRes.status()).toBe(200);
      const pnlCatData = (await pnlCatRes.json()) as {
        expense: {
          totalCents: number;
          rows: { id: string | null; name: string | null; cents: number }[];
        };
      };
      const totalExpenseHandSum = pnlCatData.expense.rows.reduce((sum, r) => sum + r.cents, 0);
      expect(totalExpenseHandSum).toBe(pnlCatData.expense.totalCents);

      const catBarsCard = page.getByTestId("spending-category-bars-card");
      await expect(catBarsCard).toBeVisible();
      const categoryRows = catBarsCard.locator("[data-testid^='category-row-']");
      await expect(categoryRows).toHaveCount(pnlCatData.expense.rows.length);

      // Biggest little leaks card and drill-down
      const leaksCard = page.getByTestId("biggest-little-leaks-card");
      await expect(leaksCard).toBeVisible();
      await expect(leaksCard.getByRole("heading", { name: "Biggest little leaks" })).toBeVisible();

      const firstLeakTile = leaksCard.locator('[data-testid^="leak-tile-"]').first();
      await expect(firstLeakTile).toBeVisible();
      const tileHref = await firstLeakTile.getAttribute("href");
      expect(tileHref).toContain("/transactions");
      expect(tileHref).toContain("payee=");

      await firstLeakTile.click();
      await expect(page).toHaveURL(
        (url) => url.pathname === "/transactions" && url.searchParams.has("payee"),
      );
      await expect(page.getByRole("heading", { level: 1, name: "Pangolin Money" })).toBeVisible();

      // 6. Net worth page, 12-month trend & private account privacy (Done-when 2 & 4)
      await page.goto("/net-worth");
      await expect(page.getByRole("heading", { level: 1, name: "Net worth" })).toBeVisible();

      // 3-up KPIs
      const kpis = page.getByTestId("net-worth-kpis");
      await expect(kpis).toBeVisible();
      await expect(page.getByTestId("kpi-net-worth")).toBeVisible();
      await expect(page.getByTestId("kpi-assets")).toBeVisible();
      await expect(page.getByTestId("kpi-liabilities")).toBeVisible();

      // Assets and liabilities cards
      await expect(page.getByTestId("assets-card")).toBeVisible();
      await expect(page.getByTestId("liabilities-card")).toBeVisible();

      // 12-month trend card and table view toggle
      const trendCard = page.getByTestId("trend-card");
      await expect(trendCard).toBeVisible();
      const trendToggle = page.getByTestId("trend-view-toggle");
      await expect(trendToggle).toHaveText("View as table");

      // Toggle to table view
      await trendToggle.click();
      const trendTable = page.getByTestId("net-worth-table");
      await expect(trendTable).toBeVisible();
      await expect(trendToggle).toHaveText("View as chart");
      await expect(trendTable.locator("tbody tr")).toHaveCount(12);

      // Toggle back to chart view
      await trendToggle.click();
      await expect(page.getByTestId("net-worth-chart")).toBeVisible();

      // Fetch Alex's Net Worth accounts
      const alexNetWorthRes = await page.request.get("/api/reports/net-worth");
      expect(alexNetWorthRes.status()).toBe(200);
      const alexNetWorthData = (await alexNetWorthRes.json()) as {
        accounts: {
          id: string;
          name: string;
          isPrivate: boolean;
          pool: string;
          balanceCents: number;
        }[];
      };

      const alexPrivateAccounts = alexNetWorthData.accounts.filter((a) => a.isPrivate);
      const alexSharedAccounts = alexNetWorthData.accounts.filter((a) => a.pool === "shared");

      // Verify lock icon for Alex's private accounts
      for (const pa of alexPrivateAccounts) {
        const row = page.getByTestId(`account-row-${pa.id}`);
        await expect(row).toBeVisible();
        await expect(row.getByRole("img", { name: "Private" })).toBeVisible();
      }

      // Verify partner privacy: Sam sees only their own accounts, never Alex's private ones (Done-when 2)
      expect(existsSync(partnerSessionFile), "partnerSessionFile must exist from auth spec").toBe(
        true,
      );
      const partnerContext = await browser.newContext({ storageState: partnerSessionFile });
      try {
        await watchCsp(partnerContext, cspViolations);
        const partnerPage = await partnerContext.newPage();
        await partnerPage.goto("/net-worth");
        await expect(
          partnerPage.getByRole("heading", { level: 1, name: "Net worth" }),
        ).toBeVisible();

        // Ensure NONE of Alex's private accounts are visible in Sam's UI
        for (const pa of alexPrivateAccounts) {
          await expect(partnerPage.getByTestId(`account-row-${pa.id}`)).toHaveCount(0);
        }

        // Ensure NONE of Alex's private accounts are returned in Sam's Net Worth API
        const samNetWorthRes = await partnerPage.request.get("/api/reports/net-worth");
        expect(samNetWorthRes.status()).toBe(200);
        const samNetWorthData = (await samNetWorthRes.json()) as {
          accounts: {
            id: string;
            name: string;
            isPrivate: boolean;
            pool: string;
            balanceCents: number;
          }[];
        };

        const samAccountIds = new Set(samNetWorthData.accounts.map((a) => a.id));
        for (const pa of alexPrivateAccounts) {
          expect(samAccountIds.has(pa.id)).toBe(false);
        }

        // Shared accounts and balances are identical for both partners
        const samSharedAccounts = samNetWorthData.accounts.filter((a) => a.pool === "shared");
        expect(samSharedAccounts.length).toBe(alexSharedAccounts.length);
        for (const shared of alexSharedAccounts) {
          const matching = samSharedAccounts.find((a) => a.id === shared.id);
          expect(matching).toBeDefined();
          expect(matching?.balanceCents).toBe(shared.balanceCents);
        }

        // If Sam has private accounts, verify Sam sees lock icons and Alex cannot see them
        const samPrivateAccounts = samNetWorthData.accounts.filter((a) => a.isPrivate);
        for (const spa of samPrivateAccounts) {
          const row = partnerPage.getByTestId(`account-row-${spa.id}`);
          await expect(row).toBeVisible();
          await expect(row.getByRole("img", { name: "Private" })).toBeVisible();
          await expect(page.getByTestId(`account-row-${spa.id}`)).toHaveCount(0);
        }
      } finally {
        await partnerContext.close();
      }
    } finally {
      await context.close();
    }
  });
});
