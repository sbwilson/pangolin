import { alexSession, loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";

test("desktop navigation rail displays links and anchors to settings cards", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/settings");

    const desktopNav = page.getByRole("navigation", { name: "Settings sections" });
    await expect(desktopNav).toBeVisible();

    const appearanceLink = desktopNav.getByRole("link", { name: "Appearance" });
    const securityLink = desktopNav.getByRole("link", { name: "Sign-in & security" });
    const devicesLink = desktopNav.getByRole("link", { name: "Signed-in devices" });
    const partnerLink = desktopNav.getByRole("link", { name: "Partner" });
    const householdLink = desktopNav.getByRole("link", { name: "Household" });
    const accountsLink = desktopNav.getByRole("link", { name: "Accounts" });
    const statusLink = desktopNav.getByRole("link", { name: "System status" });

    await expect(appearanceLink).toBeVisible();
    await expect(securityLink).toBeVisible();
    await expect(devicesLink).toBeVisible();
    await expect(partnerLink).toBeVisible();
    await expect(householdLink).toBeVisible();
    await expect(accountsLink).toBeVisible();
    await expect(statusLink).toBeVisible();

    await expect(page.locator("#appearance")).toBeVisible();
    await expect(page.locator("#security")).toBeVisible();
    await expect(page.locator("#devices")).toBeVisible();
    await expect(page.locator("#partner")).toBeVisible();
    await expect(page.locator("#household")).toBeVisible();
    await expect(page.locator("#accounts")).toBeVisible();
    await expect(page.locator("#status")).toBeVisible();

    // Click security link
    await securityLink.click();
    await expect(page).toHaveURL((url) => url.hash === "#security");
    await expect(securityLink).toHaveAttribute("aria-current", "location");

    // Click partner link
    await partnerLink.click();
    await expect(page).toHaveURL((url) => url.hash === "#partner");
    await expect(partnerLink).toHaveAttribute("aria-current", "location");

    // Click household link
    await householdLink.click();
    await expect(page).toHaveURL((url) => url.hash === "#household");
    await expect(householdLink).toHaveAttribute("aria-current", "location");

    // Click accounts link
    await accountsLink.click();
    await expect(page).toHaveURL((url) => url.hash === "#accounts");
    await expect(accountsLink).toHaveAttribute("aria-current", "location");

    // Click devices link
    await devicesLink.click();
    await expect(page).toHaveURL((url) => url.hash === "#devices");
    await expect(devicesLink).toHaveAttribute("aria-current", "location");

    // Click status link
    await statusLink.click();
    await expect(page).toHaveURL((url) => url.hash === "#status");
    await expect(statusLink).toHaveAttribute("aria-current", "location");
  } finally {
    await context.close();
  }
});

test("mobile viewport displays scrollable chips and hides desktop rail", async ({
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
    await page.goto("/settings");

    const mobileNav = page.getByRole("navigation", { name: "Settings sections mobile" });
    await expect(mobileNav).toBeVisible();

    const desktopNav = page.getByRole("navigation", {
      name: "Settings sections",
      exact: true,
    });
    await expect(desktopNav).toBeHidden();

    const chips = mobileNav.getByRole("link");
    await expect(chips).toHaveCount(8);
    await expect(mobileNav.getByRole("link", { name: "Appearance" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Sign-in & security" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Signed-in devices" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Partner" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Household" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Accounts" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "LLM providers" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "System status" })).toBeVisible();

    await mobileNav.getByRole("link", { name: "Sign-in & security" }).click();
    await expect(page).toHaveURL((url) => url.hash === "#security");
    await expect(mobileNav.getByRole("link", { name: "Sign-in & security" })).toHaveAttribute(
      "aria-current",
      "location",
    );

    await mobileNav.getByRole("link", { name: "Accounts" }).click();
    await expect(page).toHaveURL((url) => url.hash === "#accounts");
    await expect(mobileNav.getByRole("link", { name: "Accounts" })).toHaveAttribute(
      "aria-current",
      "location",
    );

    await mobileNav.getByRole("link", { name: "System status" }).click();
    await expect(page).toHaveURL((url) => url.hash === "#status");
    await expect(mobileNav.getByRole("link", { name: "System status" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  } finally {
    await context.close();
  }
});

test("renders sign-in & security, partner, household, and accounts cards at /settings", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/settings");

    const securityCard = page.locator("#security");
    await expect(securityCard).toBeVisible();
    await expect(securityCard.getByRole("heading", { name: "Sign-in & security" })).toBeVisible();
    await expect(securityCard.getByRole("button", { name: "Add a passkey" })).toBeVisible();
    await expect(
      securityCard.getByRole("heading", { name: "Password and authenticator" }),
    ).toBeVisible();
    await expect(securityCard.getByRole("heading", { name: "Recovery codes" })).toBeVisible();

    const partnerCard = page.locator("#partner");
    await expect(partnerCard).toBeVisible();
    await expect(partnerCard.getByRole("heading", { name: "Partner" })).toBeVisible();

    const householdCard = page.locator("#household");
    await expect(householdCard).toBeVisible();
    await expect(householdCard.getByRole("heading", { name: "Household" })).toBeVisible();
    await expect(
      householdCard.getByRole("radiogroup", { name: "Shared spending attribution" }),
    ).toBeVisible();
    await expect(householdCard.getByRole("radio", { name: /By contribution/ })).toBeVisible();
    await expect(householdCard.getByRole("radio", { name: /50\/50/ })).toBeVisible();

    const accountsCard = page.locator("#accounts");
    await expect(accountsCard).toBeVisible();
    await expect(
      accountsCard.getByRole("heading", { name: "Accounts", exact: true }),
    ).toBeVisible();
    await expect(
      accountsCard.getByRole("heading", { name: "Archived closed accounts" }),
    ).toBeVisible();
    await expect(accountsCard.getByRole("heading", { name: "Household membership" })).toBeVisible();
    await expect(accountsCard.getByRole("button", { name: "Leave household" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("leave household confirmation dialog opens and can be cancelled", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/settings#accounts");

    const accountsCard = page.locator("#accounts");
    await accountsCard.getByRole("button", { name: "Leave household" }).click();

    const dialog = page.getByRole("dialog", { name: "Leave household" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Are you sure you want to leave the household?")).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await context.close();
  }
});

test("renders live system status, health, and CLI restore note at /settings#status", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/settings#status");

    const statusCard = page.locator("#status");
    await expect(statusCard).toBeVisible();

    await expect(statusCard.getByRole("heading", { name: "System status" })).toBeVisible();
    await expect(statusCard.getByRole("status").filter({ hasText: "Healthy" })).toBeVisible();
    await expect(statusCard.getByText(/^Schema version \d+/)).toBeVisible();
    await expect(statusCard.getByText("No jobs need attention", { exact: true })).toBeVisible();
    await expect(
      statusCard.getByText(
        "Restores run from the server CLI, with Pangolin stopped. There's no restore button here on purpose.",
      ),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("signed-in devices lists active session and marks current device", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/settings#devices");

    const devicesCard = page.locator("#devices");
    await expect(devicesCard).toBeVisible();
    await expect(devicesCard.getByRole("heading", { name: "Signed-in devices" })).toBeVisible();
    const thisDeviceRow = devicesCard.locator(".border-b").filter({ hasText: "This device" });
    await expect(thisDeviceRow).toBeVisible();
    await expect(thisDeviceRow.getByRole("button", { name: "Sign out" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("revoking a remote session removes it from the devices list", async ({
  browser,
  cspViolations,
}) => {
  const account = loadAccount();
  const mainContext = await browser.newContext({ storageState: await alexSession(browser) });
  const secondContext = await browser.newContext();

  try {
    await watchCsp(mainContext, cspViolations);
    await watchCsp(secondContext, cspViolations);

    // Create a second active session
    const secondPage = await secondContext.newPage();
    await signInWithPassword(secondPage, account);

    const mainPage = await mainContext.newPage();
    await mainPage.goto("/settings#devices");

    const devicesCard = mainPage.locator("#devices");
    await expect(devicesCard.getByText("This device")).toBeVisible();

    // Verify sessions are listed and include This device plus remote sessions
    const thisDeviceRow = devicesCard.locator(".border-b").filter({ hasText: "This device" });
    await expect(thisDeviceRow).toBeVisible();
    const remoteRows = devicesCard.locator(".border-b").filter({ hasNotText: "This device" });
    const remoteCountBefore = await remoteRows.count();
    expect(remoteCountBefore).toBeGreaterThanOrEqual(1);

    // Sign out the first remote session
    await remoteRows.first().getByRole("button", { name: "Sign out" }).click();

    // The remote session is removed, and This device remains
    await expect(remoteRows).toHaveCount(remoteCountBefore - 1);
    await expect(thisDeviceRow).toBeVisible();
    await expect(thisDeviceRow).toContainText("This device");
  } finally {
    await mainContext.close();
    await secondContext.close();
  }
});

test("signing out This device from the devices card lands on /sign-in", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext();
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await signInWithPassword(page, loadAccount());

    await page.goto("/settings#devices");
    const devicesCard = page.locator("#devices");
    const thisDeviceRow = devicesCard.locator(".border-b").filter({ hasText: "This device" });
    await expect(thisDeviceRow).toBeVisible();

    await thisDeviceRow.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
