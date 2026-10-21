// Story 12.1: the router. A setup link's `token` is typed in the route's search params, read
// once, then dropped from the URL (and history) with a replace; a deep link opens its page
// inside the shell.
import { rmSync } from "node:fs";
import type { Browser } from "@playwright/test";
import { firstSessionFile, loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";

let signedIn: Promise<string> | undefined;

/**
 * Signs Alex in once with password and TOTP and saves the session. The partner's session from
 * registration is no use here: the recovery spec, which runs first, resets the partner's access.
 * A TOTP code cannot be replayed within its 30 second step and an earlier spec may have just used
 * this one, so a sign-in that does not land waits for the next step and tries once more.
 */
function alexSession(browser: Browser): Promise<string> {
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

test("a setup link's token is read once and then leaves the URL", async ({ page }) => {
  await page.goto("/setup");
  const before = await page.evaluate(() => window.history.length);
  await page.goto("/setup?token=not-a-real-token");
  await expect(page.getByRole("heading", { name: "Set up your sign-in" })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/setup" && url.search === "");
  // The strip replaced the entry: the load added one entry, the strip none.
  expect(await page.evaluate(() => window.history.length)).toBe(before + 1);
  // A reload no longer carries the token.
  await page.reload();
  await expect(page.getByText("This page needs the one-time setup link")).toBeVisible();
});

test("a recovery link's token leaves the URL too", async ({ page }) => {
  await page.goto("/recover?token=not-a-real-token");
  await expect(page.getByRole("heading", { name: "Reset your sign-in" })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/recover" && url.search === "");
});

test("a deep link to /transactions opens the list inside the shell, and /ledger redirects to it", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/transactions");
    await expect(page.getByRole("heading", { name: "Pangolin Money", level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Transactions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await nav.getByRole("link", { name: "Accounts" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/accounts");
    await expect(page.getByText("Signed in as Alex")).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/transactions");
  } finally {
    await context.close();
  }
});

test("/ledger replaces itself with /transactions, keeping its filters, in one history entry", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/");
    const before = await page.evaluate(() => window.history.length);
    await page.goto("/ledger?type=in&uncategorised=true");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/transactions" &&
        url.searchParams.get("type") === "in" &&
        url.searchParams.get("uncategorised") === "true",
    );
    expect(await page.evaluate(() => window.history.length)).toBe(before + 1);
    await expect(page.getByRole("combobox", { name: "Type" })).toHaveValue("in");
    await expect(page.getByRole("button", { name: "Uncategorised", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    await context.close();
  }
});

test("a signed-in person opening a recovery link is asked to sign out first, and the token leaves", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/recover?token=not-a-real-token");
    await expect(page.getByRole("heading", { name: "Use a recovery link" })).toBeVisible();
    await expect(page.getByText("sign out first")).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === "/recover" && url.search === "");
  } finally {
    await context.close();
  }
});

/**
 * Opens /transactions as Alex with `count` fake transactions on one date, all in one stubbed
 * response (the server pages 50 at a time; the table must still window whatever it is given).
 */
async function openTransactions(
  browser: Browser,
  cspViolations: string[],
  count: number,
  viewport?: { width: number; height: number },
) {
  const context = await browser.newContext({
    storageState: await alexSession(browser),
    ...(viewport === undefined ? {} : { viewport }),
  });
  await watchCsp(context, cspViolations);
  const page = await context.newPage();
  const transactions = Array.from({ length: count }, (_, i) => ({
    id: `txn-${i}`,
    accountId: "acc",
    postedOn: "2026-01-01",
    amountCents: -(i + 1),
    status: "posted",
    splits: [],
    descriptionRaw: `Row ${i}`,
  }));
  const outCents = (count * (count + 1)) / 2;
  await page.route("**/api/ledger/transactions*", (route) =>
    route.fulfill({
      json: {
        transactions,
        page: { total: count, pageCount: 1, page: 1, next: null, prev: null },
        summary: { count, inCents: 0, outCents },
        dayNets: { "2026-01-01": -outCents },
      },
    }),
  );
  await page.goto("/transactions");
  const table = page.getByRole("table", { name: "Transactions" });
  await expect(table).toBeVisible();
  return { context, page, table };
}

test("a long list is virtualised and scrolls to its end, with date headers and the table role and name intact", async ({
  browser,
  cspViolations,
}) => {
  const { context, page, table } = await openTransactions(browser, cspViolations, 1000);
  try {
    const rows = table.locator("tbody tr[aria-rowindex]");
    await expect(table.getByRole("cell", { name: "Row 0", exact: true })).toBeVisible();
    await expect(table.getByRole("rowheader").first()).toContainText("1 Jan 2026");
    expect(await table.locator("tbody tr").count()).toBeLessThan(200);
    // One date header and 1000 rows, and the column header row.
    await expect(table).toHaveAttribute("aria-rowcount", "1002");
    const scroller = page.getByLabel("Transactions list, scrollable");
    await expect(scroller).toHaveAttribute("tabindex", "0");
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(table.getByRole("cell", { name: "Row 999", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "Row 0", exact: true })).toHaveCount(0);
    expect(await table.locator("tbody tr").count()).toBeLessThan(200);
    expect(await rows.count()).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("exactly 200 rows are all rendered; 201 are windowed", async ({ browser, cspViolations }) => {
  const exact = await openTransactions(browser, cspViolations, 200);
  try {
    // 200 rows and the one date header.
    await expect(exact.table.locator("tbody tr")).toHaveCount(201);
  } finally {
    await exact.context.close();
  }
  const over = await openTransactions(browser, cspViolations, 201);
  try {
    await expect(over.table.getByRole("cell", { name: "Row 0", exact: true })).toBeVisible();
    expect(await over.table.locator("tbody tr").count()).toBeLessThan(201);
  } finally {
    await over.context.close();
  }
});

for (const width of [375, 320]) {
  test(`at ${width} px the filters, summary and list show without sideways scroll, and the Account and checkbox columns are hidden`, async ({
    browser,
    cspViolations,
  }) => {
    const { context, page, table } = await openTransactions(browser, cspViolations, 30, {
      width,
      height: 800,
    });
    try {
      const main = page.getByRole("main");
      await expect(main.getByRole("button", { name: "All", exact: true })).toBeVisible();
      await expect(main.getByRole("button", { name: "Needs review" })).toBeDisabled();
      await expect(main.getByRole("combobox", { name: "Type" })).toBeVisible();
      await expect(main.getByRole("combobox", { name: "Account" })).toBeVisible();
      await expect(main.getByRole("combobox", { name: "Category" })).toBeVisible();
      await expect(main.getByRole("button", { name: "Quarter" })).toBeVisible();
      await expect(
        page.getByText("30 transactions \u00b7 In $0.00 \u00b7 Out $4.65"),
      ).toBeVisible();
      await expect(table.getByRole("cell", { name: "Row 0", exact: true })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Account" })).toBeHidden();
      await expect(table.getByRole("checkbox").first()).toBeHidden();
      await expect(table.getByRole("columnheader", { name: "Amount" })).toBeVisible();
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
    } finally {
      await context.close();
    }
  });
}

test("Clear filters keeps the date range, and a no-match list says so", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    // The server stub answers every query with nothing.
    await page.route("**/api/ledger/transactions*", (route) =>
      route.fulfill({
        json: {
          transactions: [],
          page: { total: 0, pageCount: 1, page: 1, next: null, prev: null },
          summary: { count: 0, inCents: 0, outCents: 0 },
          dayNets: {},
        },
      }),
    );
    await page.goto("/transactions?from=2026-07-01&to=2026-09-30&type=out&transfers=true");
    await expect(page.getByText("Nothing matches those filters.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).last().click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("from") === "2026-07-01" &&
        url.searchParams.get("to") === "2026-09-30" &&
        !url.searchParams.has("type") &&
        !url.searchParams.has("transfers"),
    );
    await page.goto("/transactions");
    await expect(page.getByText("No transactions yet")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("desktop sidebar is visible >= 768px and mobile tab bar is hidden; mobile tab bar is visible < 768px and sidebar is hidden", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({
    storageState: await alexSession(browser),
    viewport: { width: 1024, height: 768 },
  });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/transactions");
    const desktopNav = page.getByRole("navigation", { name: "Main" });
    await expect(desktopNav).toBeVisible();
    await expect(desktopNav.getByRole("link", { name: "Transactions" })).toBeVisible();
    await expect(desktopNav.getByRole("link", { name: "Accounts" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();

    // Resize to phone viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(desktopNav).toBeHidden();
    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Cash flow" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Transactions" })).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: /Needs review/ })).toBeVisible();
    await expect(mobileNav.getByRole("button", { name: "Planning" })).toBeVisible();
    await expect(mobileNav.getByRole("button", { name: "More" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("mobile More tab opens sheet with Accounts, Settings, and Sign out, and tapping Accounts navigates to /accounts", async ({
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
    await page.goto("/transactions");
    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await mobileNav.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Accounts" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
    await sheet.getByRole("button", { name: "Accounts" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/accounts");
    await expect(sheet).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("unauthenticated visitor visiting /transactions or /accounts redirects to /sign-in, and signed-in visitor redirects to /transactions", async ({
  browser,
  cspViolations,
}) => {
  const anonContext = await browser.newContext();
  try {
    await watchCsp(anonContext, cspViolations);
    const anonPage = await anonContext.newPage();
    await anonPage.goto("/transactions");
    await expect(anonPage).toHaveURL((url) => url.pathname === "/sign-in");
    await expect(anonPage.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await anonPage.goto("/accounts");
    await expect(anonPage).toHaveURL((url) => url.pathname === "/sign-in");
  } finally {
    await anonContext.close();
  }

  const authContext = await browser.newContext({ storageState: await alexSession(browser) });
  try {
    await watchCsp(authContext, cspViolations);
    const authPage = await authContext.newPage();
    await authPage.goto("/sign-in");
    await expect(authPage).toHaveURL((url) => url.pathname === "/transactions");
  } finally {
    await authContext.close();
  }
});

test("mobile Planning tab opens sheet with Planning items and is dismissible via Escape or Done", async ({
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
    await page.goto("/transactions");
    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await mobileNav.getByRole("button", { name: "Planning" }).click();
    const sheet = page.getByRole("dialog", { name: "Planning" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Budgets")).toBeVisible();
    await expect(sheet.getByText("Goals")).toBeVisible();
    await expect(sheet.getByText("Home buying")).toBeVisible();
    await expect(sheet.getByText("Forecast")).toBeVisible();

    // Dismiss with Escape
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // Reopen and dismiss with Done button
    await mobileNav.getByRole("button", { name: "Planning" }).click();
    await expect(page.getByRole("dialog", { name: "Planning" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog", { name: "Planning" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("mobile More tab allows signing out which terminates session and lands on /sign-in", async ({
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
    await page.goto("/transactions");
    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await mobileNav.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Sign out" }).click();
    rmSync(firstSessionFile, { force: true });
    await expect(page).toHaveURL((url) => url.pathname === "/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  } finally {
    await context.close();
  }
});
