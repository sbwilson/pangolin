// Story 12.1: the router. A setup link's `token` is typed in the route's search params, read
// once, then dropped from the URL (and history) with a replace; a deep link opens its page
// inside the shell.
import type { Browser } from "@playwright/test";
import { partnerSessionFile } from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";

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

test("a deep link to /ledger opens the ledger inside the shell", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: partnerSessionFile });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/ledger");
    await expect(page.getByRole("heading", { name: "Pangolin Money", level: 1 })).toBeVisible();
    await expect(page.getByRole("table", { name: "Transactions" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Ledger" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(page.getByText("Signed in as Sam")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a signed-in person opening a recovery link is asked to sign out first, and the token leaves", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: partnerSessionFile });
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

/** Opens /ledger as the partner with `count` fake transactions. */
async function openLedger(browser: Browser, cspViolations: string[], count: number) {
  const context = await browser.newContext({ storageState: partnerSessionFile });
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
  await page.route("**/api/ledger/transactions", (route) =>
    route.fulfill({ json: { transactions } }),
  );
  await page.goto("/ledger");
  const table = page.getByRole("table", { name: "Transactions" });
  await expect(table).toBeVisible();
  return { context, page, table };
}

test("a long ledger is virtualised and scrolls to its end, with the table role and name intact", async ({
  browser,
  cspViolations,
}) => {
  const { context, page, table } = await openLedger(browser, cspViolations, 1000);
  try {
    const rows = table.locator("tbody tr[aria-rowindex]");
    await expect(table.getByRole("cell", { name: "Row 0", exact: true })).toBeVisible();
    expect(await table.locator("tbody tr").count()).toBeLessThan(200);
    await expect(table).toHaveAttribute("aria-rowcount", "1001");
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
  const exact = await openLedger(browser, cspViolations, 200);
  try {
    await expect(exact.table.locator("tbody tr")).toHaveCount(200);
  } finally {
    await exact.context.close();
  }
  const over = await openLedger(browser, cspViolations, 201);
  try {
    await expect(over.table.getByRole("cell", { name: "Row 0", exact: true })).toBeVisible();
    expect(await over.table.locator("tbody tr").count()).toBeLessThan(201);
  } finally {
    await over.context.close();
  }
});
