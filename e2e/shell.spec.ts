import { existsSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { firstSessionFile, loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";

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

test("desktop shell navigation via AppSidebar reaches all shipped routes and redirects /", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({
    storageState: await alexSession(browser),
    viewport: { width: 1280, height: 800 },
  });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();

    // Root redirects to the Cash flow landing page
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/cash-flow");

    const sidebar = page.getByRole("navigation", { name: "Main" });
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();

    // Verify the Cash flow link has aria-current="page", and Transactions does not
    const cashFlowLink = sidebar.getByRole("link", { name: "Cash flow" });
    const txLink = sidebar.getByRole("link", { name: "Transactions" });
    await expect(cashFlowLink).toHaveAttribute("aria-current", "page");
    await expect(txLink).not.toHaveAttribute("aria-current", "page");

    // Navigate to Transactions
    await txLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/transactions");
    await expect(txLink).toHaveAttribute("aria-current", "page");
    await expect(cashFlowLink).not.toHaveAttribute("aria-current", "page");

    // Navigate to Accounts
    const accountsLink = sidebar.getByRole("link", { name: "Accounts" });
    await accountsLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/accounts");
    await expect(accountsLink).toHaveAttribute("aria-current", "page");
    await expect(txLink).not.toHaveAttribute("aria-current", "page");

    // Navigate to Net worth
    const netWorthLink = sidebar.getByRole("link", { name: "Net worth" });
    await netWorthLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/net-worth");
    await expect(netWorthLink).toHaveAttribute("aria-current", "page");
    await expect(accountsLink).not.toHaveAttribute("aria-current", "page");

    // Navigate to Settings
    const settingsLink = page.locator("aside").getByRole("link", { name: "Settings" });
    await settingsLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/settings");
    await expect(settingsLink).toHaveAttribute("aria-current", "page");
    await expect(accountsLink).not.toHaveAttribute("aria-current", "page");

    // Click the Cash flow link: it lands on /cash-flow
    await cashFlowLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/cash-flow");
    await expect(cashFlowLink).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 2, name: "Cash flow" })).toBeVisible();

    // Navigate back to /
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/cash-flow");
    await expect(cashFlowLink).toHaveAttribute("aria-current", "page");
  } finally {
    await context.close();
  }
});

test("mobile shell navigation via MobileNav and More sheet reaches shipped routes", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({
    storageState: await alexSession(browser),
    viewport: { width: 375, height: 667 },
  });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();

    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/cash-flow");

    const desktopNav = page.getByRole("navigation", { name: "Main" });
    await expect(desktopNav).toBeHidden();

    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNav).toBeVisible();

    const cashFlowLink = mobileNav.getByRole("link", { name: "Cash flow" });
    await expect(cashFlowLink).toHaveAttribute("aria-current", "page");
    const txLink = mobileNav.getByRole("link", { name: "Transactions" });
    await expect(txLink).toBeVisible();
    await expect(txLink).not.toHaveAttribute("aria-current", "page");

    // Open More sheet and dismiss via close button (Done)
    await mobileNav.getByRole("button", { name: "More" }).click();
    const moreSheet = page.getByRole("dialog", { name: "More" });
    await expect(moreSheet).toBeVisible();
    await moreSheet.getByRole("button", { name: "Done" }).click();
    await expect(moreSheet).toHaveCount(0);

    // Reopen More sheet and navigate to Settings
    await mobileNav.getByRole("button", { name: "More" }).click();
    await expect(moreSheet).toBeVisible();
    await moreSheet.getByRole("button", { name: "Settings" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/settings");
    await expect(moreSheet).toHaveCount(0);

    // Open More sheet from Settings and navigate to Accounts
    await mobileNav.getByRole("button", { name: "More" }).click();
    await expect(moreSheet).toBeVisible();
    await moreSheet.getByRole("button", { name: "Accounts" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/accounts");
    await expect(moreSheet).toHaveCount(0);

    // Open More sheet from Accounts and navigate to Net worth
    await mobileNav.getByRole("button", { name: "More" }).click();
    await expect(moreSheet).toBeVisible();
    await moreSheet.getByRole("button", { name: "Net worth" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/net-worth");
    await expect(moreSheet).toHaveCount(0);

    // Return to Transactions via tab bar
    await mobileNav.getByRole("link", { name: "Transactions" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/transactions");
    await expect(txLink).toHaveAttribute("aria-current", "page");

    // And back to Cash flow
    await cashFlowLink.click();
    await expect(page).toHaveURL((url) => url.pathname === "/cash-flow");
    await expect(cashFlowLink).toHaveAttribute("aria-current", "page");
  } finally {
    await context.close();
  }
});

test("theme preference switching persists across discrete browser contexts and hydrates root attributes", async ({
  browser,
  cspViolations,
}) => {
  const contextA = await browser.newContext({ storageState: await alexSession(browser) });
  let contextB: BrowserContext | undefined;
  let pageA: Page | undefined;
  try {
    await watchCsp(contextA, cspViolations);
    pageA = await contextA.newPage();
    await pageA.goto("/settings#appearance");

    const appearanceCard = pageA.locator("#appearance");
    await expect(appearanceCard).toBeVisible();

    // Select mode "Dark" and wait for preference save
    const modeGroup = appearanceCard.getByRole("radiogroup", { name: "Mode" });
    const darkRadio = modeGroup.getByRole("radio", { name: "Dark" });
    const modeSave = pageA.waitForResponse((r) => r.url().includes("/preferences") && r.ok());
    await darkRadio.click();
    await modeSave;
    await expect(darkRadio).toHaveAttribute("aria-checked", "true");

    // Select theme "Harbour Morning" and wait for preference save
    const themeGroup = appearanceCard.getByRole("radiogroup", { name: "Theme" });
    const harbourRadio = themeGroup.getByRole("radio", { name: "Harbour Morning" });
    const themeSave = pageA.waitForResponse((r) => r.url().includes("/preferences") && r.ok());
    await harbourRadio.click();
    await themeSave;
    await expect(harbourRadio).toHaveAttribute("aria-checked", "true");

    // Verify context A HTML attributes
    const htmlA = pageA.locator("html");
    await expect(htmlA).toHaveAttribute("data-theme", "harbour-morning");
    await expect(htmlA).toHaveAttribute("data-resolved-mode", "dark");
    await expect(htmlA).toHaveAttribute("data-mode", "dark");

    // Open context B without inheriting context A's localStorage
    contextB = await browser.newContext({ storageState: await alexSession(browser) });
    await watchCsp(contextB, cspViolations);
    const pageB = await contextB.newPage();
    await pageB.goto("/transactions");

    // Context B fetches preferences from server and hydrates on root html
    const htmlB = pageB.locator("html");
    await expect(htmlB).toHaveAttribute("data-theme", "harbour-morning");
    await expect(htmlB).toHaveAttribute("data-resolved-mode", "dark");
    await expect(htmlB).toHaveAttribute("data-mode", "dark");
  } finally {
    if (pageA) {
      try {
        await pageA.goto("/settings#appearance");
        const appearanceCard = pageA.locator("#appearance");
        const modeGroup = appearanceCard.getByRole("radiogroup", { name: "Mode" });
        const systemRadio = modeGroup.getByRole("radio", { name: "System" });
        const systemSave = pageA.waitForResponse((r) => r.url().includes("/preferences") && r.ok());
        await systemRadio.click();
        await systemSave;

        const themeGroup = appearanceCard.getByRole("radiogroup", { name: "Theme" });
        const clayRadio = themeGroup.getByRole("radio", { name: "Clay & Linen" });
        const claySave = pageA.waitForResponse((r) => r.url().includes("/preferences") && r.ok());
        await clayRadio.click();
        await claySave;
      } catch {
        // Ignore cleanup failure if context is closing
      }
    }
    await contextA.close();
    if (contextB) await contextB.close();
  }
});

test("settings rail on desktop and chips on mobile navigate and update hash across all sections", async ({
  browser,
  cspViolations,
}) => {
  // Desktop navigation rail
  const desktopContext = await browser.newContext({
    storageState: await alexSession(browser),
    viewport: { width: 1280, height: 800 },
  });
  try {
    await watchCsp(desktopContext, cspViolations);
    const page = await desktopContext.newPage();
    await page.goto("/settings");

    const desktopNav = page.getByRole("navigation", { name: "Settings sections" });
    await expect(desktopNav).toBeVisible();

    const sections = [
      { id: "appearance", name: "Appearance" },
      { id: "security", name: "Sign-in & security" },
      { id: "devices", name: "Signed-in devices" },
      { id: "partner", name: "Partner" },
      { id: "household", name: "Household" },
      { id: "accounts", name: "Accounts" },
      { id: "status", name: "System status" },
    ];

    for (const sec of sections) {
      const link = desktopNav.getByRole("link", { name: sec.name });
      await expect(link).toBeVisible();
      await expect(page.locator(`#${sec.id}`)).toBeVisible();
      await link.click();
      await expect(page).toHaveURL((url) => url.hash === `#${sec.id}`);
    }
    const securityLink = desktopNav.getByRole("link", { name: "Sign-in & security" });
    await securityLink.click();
    await expect(securityLink).toHaveAttribute("aria-current", "location");
  } finally {
    await desktopContext.close();
  }

  // Mobile chip navigation
  const mobileContext = await browser.newContext({
    storageState: await alexSession(browser),
    viewport: { width: 375, height: 667 },
  });
  try {
    await watchCsp(mobileContext, cspViolations);
    const page = await mobileContext.newPage();
    await page.goto("/settings");

    const mobileNav = page.getByRole("navigation", { name: "Settings sections mobile" });
    await expect(mobileNav).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Settings sections", exact: true }),
    ).toBeHidden();

    const chips = [
      { id: "security", name: "Sign-in & security" },
      { id: "devices", name: "Signed-in devices" },
      { id: "partner", name: "Partner" },
      { id: "household", name: "Household" },
      { id: "accounts", name: "Accounts" },
      { id: "status", name: "System status" },
      { id: "appearance", name: "Appearance" },
    ];

    for (const chip of chips) {
      const chipLink = mobileNav.getByRole("link", { name: chip.name });
      await expect(chipLink).toBeVisible();
      await chipLink.click();
      await expect(page).toHaveURL((url) => url.hash === `#${chip.id}`);
    }
    const securityChip = mobileNav.getByRole("link", { name: "Sign-in & security" });
    await securityChip.click();
    await expect(securityChip).toHaveAttribute("aria-current", "location");
  } finally {
    await mobileContext.close();
  }
});

test("remote session revocation invalidates remote session and leaves current device active", async ({
  browser,
  cspViolations,
}) => {
  const account = loadAccount();
  const mainContext = await browser.newContext({ storageState: await alexSession(browser) });
  const secondContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  try {
    await watchCsp(mainContext, cspViolations);
    await watchCsp(secondContext, cspViolations);

    // Create a second active session
    const secondPage = await secondContext.newPage();
    await signInWithPassword(secondPage, account);

    // Primary session visits devices card
    const mainPage = await mainContext.newPage();
    await mainPage.goto("/settings#devices");

    const devicesCard = mainPage.locator("#devices");
    await expect(devicesCard.getByText("This device")).toBeVisible();

    const thisDeviceRow = devicesCard.locator(".border-b").filter({ hasText: "This device" });
    await expect(thisDeviceRow).toBeVisible();

    // Locate the distinct remote session (iPhone)
    const remoteSessionRow = devicesCard
      .locator(".border-b")
      .filter({ hasText: "iPhone · Safari" });
    await expect(remoteSessionRow).toBeVisible();

    // Sign out the remote session
    await remoteSessionRow.getByRole("button", { name: "Sign out" }).click();

    // Verify remote session row removed from devices list
    await expect(remoteSessionRow).toHaveCount(0);
    await expect(thisDeviceRow).toBeVisible();

    // Verify remote session is invalidated when secondPage interacts/reloads
    await secondPage.reload();
    await expect(secondPage).toHaveURL((url) => url.pathname === "/sign-in");
    await expect(secondPage.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  } finally {
    await mainContext.close();
    await secondContext.close();
  }
});

test("reauth dialog ceremony displays security heading, toggles passkey/password tabs, and cancels cleanly", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();

    // Intercept CSV export to return ReauthRequired
    await page.route("**/api/ledger/export*", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "ReauthRequired",
            message: "Sign in again to do this",
          },
        }),
      }),
    );

    await page.goto("/transactions");

    // Click Export CSV to trigger ReauthRequired and open ReauthDialog
    await page.getByRole("button", { name: "Export CSV" }).click();

    const dialog = page.getByRole("dialog", { name: "For your security, sign in again" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "For your security, sign in again" }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "Confirm it's you to export transactions. Once you're in, the change goes through.",
      ),
    ).toBeVisible();

    // Initial step is passkey
    await expect(dialog.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
    const usePasswordButton = dialog.getByRole("button", { name: "Use password instead" });
    await expect(usePasswordButton).toBeVisible();

    // Switch to password mode
    await usePasswordButton.click();
    await expect(dialog.getByLabel("Email")).toBeVisible();
    await expect(dialog.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continue" })).toBeVisible();

    // Switch back to passkey mode
    const usePasskeyButton = dialog.getByRole("button", { name: "Use passkey instead" });
    await expect(usePasskeyButton).toBeVisible();
    await usePasskeyButton.click();
    await expect(dialog.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();

    // Cancel closes the dialog
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await context.close();
  }
});
