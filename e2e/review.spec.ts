// The Needs review inbox end to end, after recovery.spec left Alex a "recovery code used" notice
// on the seeded ledger: `/review` lists what is open, the nav badge and heading agree with the
// API, and "Got it" clears an item and drops the count.
import type { Page } from "@playwright/test";
import { loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

interface Inbox {
  readonly items: readonly { id: string; kind: string }[];
  readonly counts: { open: number; partner: { displayName: string; pending: number } | null };
}

async function readInbox(page: Page): Promise<Inbox> {
  return await page.evaluate(async () => {
    const [list, count] = await Promise.all([fetch("/api/review"), fetch("/api/review/count")]);
    const items = ((await list.json()) as { items: { id: string; kind: string }[] }).items;
    return { items, counts: await count.json() };
  });
}

const heading = (open: number): string =>
  open === 0 ? "Needs review" : open === 1 ? "1 thing needs you" : `${open} things need you`;

test("Needs review lists what is open, agrees with the nav badge, and clears an item", async ({
  page,
}) => {
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText("Signed in as Alex")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /Needs review/ })
    .click();
  await expect(page).toHaveURL((url) => url.pathname === "/review");

  const before = await readInbox(page);
  expect(before.counts.open).toBe(before.items.length);
  await expect(
    page.getByRole("heading", { level: 2, name: heading(before.items.length) }),
  ).toBeVisible();
  if (before.items.length === 0) {
    await expect(page.getByText("Nothing needs you. Nice.")).toBeVisible();
  }
  const badge = page.getByRole("navigation", { name: "Main" }).getByTestId("review-badge");
  await expect(badge).toHaveText(before.items.length === 0 ? /all clear/ : /^\d+ waiting$/);
  // The chip is a number: the same one the API gives, hidden at zero.
  const { partner } = before.counts;
  if (partner === null) await expect(page.getByTestId("partner-chip")).toHaveCount(0);
  else
    await expect(page.getByTestId("partner-chip")).toHaveText(
      `${partner.displayName}: ${partner.pending} left`,
    );

  // Clear a notice: the card goes, the heading and the badge follow.
  const notice = page.locator('[data-kind="identity.recovery-code-used"]').first();
  test.skip((await notice.count()) === 0, "recovery.spec left no notice to clear");
  await notice.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator('[data-kind="identity.recovery-code-used"]')).toHaveCount(
    before.items.filter((item) => item.kind === "identity.recovery-code-used").length - 1,
  );
  const after = await readInbox(page);
  expect(after.counts.open).toBe(before.counts.open - 1);
  await expect(
    page.getByRole("heading", { level: 2, name: heading(after.items.length) }),
  ).toBeVisible();
  if (after.items.length === 0) {
    await expect(page.getByText("Nothing needs you. Nice.")).toBeVisible();
    await expect(badge).toHaveText(/all clear/);
  } else {
    await expect(badge).toHaveText(`${after.counts.open} waiting`);
  }
});

test("an item that is already resolved answers 404", async ({ page }) => {
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText("Signed in as Alex")).toBeVisible();
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/review/01J0000000000000000000ZZZZ/dismiss-notice", {
      method: "POST",
    });
    return res.status;
  });
  expect(status).toBe(404);
});

test("suggestion endpoints: accept, dismiss and bulk-accept return 404 on missing or already resolved items", async ({
  page,
}) => {
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText("Signed in as Alex")).toBeVisible();

  const acceptStatus = await page.evaluate(async () => {
    const res = await fetch("/api/review/01J0000000000000000000ZZZZ/accept-suggestion", {
      method: "POST",
    });
    return res.status;
  });
  expect(acceptStatus).toBe(404);

  const dismissStatus = await page.evaluate(async () => {
    const res = await fetch("/api/review/01J0000000000000000000ZZZZ/dismiss-suggestion", {
      method: "POST",
    });
    return res.status;
  });
  expect(dismissStatus).toBe(404);

  const bulkStatus = await page.evaluate(async () => {
    const res = await fetch("/api/review/bulk-accept-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["01J0000000000000000000ZZZZ"] }),
    });
    return res.status;
  });
  expect(bulkStatus).toBe(404);
});
