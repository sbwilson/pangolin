// Epic 2's tracer bullet: after both partners have signed up (auth.spec), the `seed` admin
// command attaches the demo seed's accounts to them, and each partner sees the shared account's
// transactions and only their own private account's. The first person signs in with password
// and TOTP; the partner's email is locked by auth.spec's lockout test, so the partner uses the
// session saved when they registered.
import { execSync } from "node:child_process";
import { loadAccount, partnerSessionFile, signInWithPassword } from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";

// The descriptions tools/seed's accounts module emits.
const SHARED = [
  "Joint: Woolworths groceries",
  "Joint: Energy bill",
  "Joint: Internet",
  "Joint: Council rates",
];
const PRIVATE_A = ["Person A private: Book shop", "Person A private: Gift"];
const PRIVATE_B = ["Person B private: Gym", "Person B private: Record shop"];

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // CI runs the CLI in the container (`docker compose exec`); it needs both partners signed up.
  const command = process.env.E2E_SEED_COMMAND;
  if (command === undefined || command === "") {
    throw new Error(
      "Set E2E_SEED_COMMAND (e.g. `docker compose exec -T pangolin node dist/cli.js seed`)",
    );
  }
  expect(execSync(command, { encoding: "utf8" })).toContain("Seeded 3 accounts");
});

async function descriptions(page: import("@playwright/test").Page): Promise<string[]> {
  await page.getByRole("button", { name: "Transactions" }).click();
  const table = page.getByRole("table", { name: "Transactions" });
  await expect(table).toBeVisible();
  return table.locator("tbody tr td:nth-child(2)").allTextContents();
}

test("the first person sees the shared account and their own private one, not the partner's", async ({
  page,
}) => {
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText("Signed in as Alex")).toBeVisible();
  expect((await descriptions(page)).sort()).toEqual([...SHARED, ...PRIVATE_A].sort());
});

test("the partner sees the shared account and their own private one, not the first person's", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: partnerSessionFile });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByText("Signed in as Sam")).toBeVisible();
    expect((await descriptions(page)).sort()).toEqual([...SHARED, ...PRIVATE_B].sort());
  } finally {
    await context.close();
  }
});

test("the API answers per viewer and is never cached", async ({ page }) => {
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText("Signed in as Alex")).toBeVisible();
  const res = await page.request.get("/api/ledger/transactions");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  const { transactions } = (await res.json()) as { transactions: { descriptionRaw: string }[] };
  expect(transactions.map((t) => t.descriptionRaw)).not.toContain(PRIVATE_B[0]);
});
