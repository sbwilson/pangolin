// The Accounts page and the account detail page, on the ledger ledger.spec.ts seeds: the
// playwright config runs this file after the rest of the suite (the seed loads once, into an
// empty ledger). Nothing here hard-codes the seed's contents: what each account should show is
// read from the accounts API and compared with what the page renders.
import { loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

interface ApiAccount {
  id: string;
  name: string;
  type: string;
  newestPostedOn: string | null;
}

interface ApiTransactions {
  transactions: { postedOn: string }[];
  page: { total: number };
  summary: { count: number };
}

/** The Accounts page's groups, by the account types each holds (property has its own card). */
const GROUPS: Record<string, string[]> = {
  Cash: ["transaction", "offset"],
  Savings: ["savings"],
  Cards: ["credit_card"],
  Loans: ["home_loan"],
  Investments: ["brokerage", "super"],
  Other: ["vehicle", "other"],
};
const CASH_TYPES = ["transaction", "savings", "offset", "credit_card", "home_loan"];
const STALE_AFTER_DAYS = 45;

const MONEY = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Today in the browser's zone, which is this machine's. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const utcMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

function isStale(newest: string | null): boolean {
  return newest !== null && (utcMs(localToday()) - utcMs(newest)) / 86_400_000 > STALE_AFTER_DAYS;
}

const freshness = (newest: string | null) =>
  newest === null
    ? "No transactions yet"
    : `to ${Number(newest.slice(8))} ${MONTHS[Number(newest.slice(5, 7)) - 1]}`;

const shiftDay = (day: string, days: number) =>
  new Date(utcMs(day) + days * 86_400_000).toISOString().slice(0, 10);

test("the Accounts page groups each account, shows the Properties placeholder and stale captions", async ({
  page,
}) => {
  await signInWithPassword(page, loadAccount());
  const res = await page.request.get("/api/accounts");
  expect(res.status()).toBe(200);
  const accounts = ((await res.json()) as { accounts: ApiAccount[] }).accounts;
  expect(accounts.length).toBeGreaterThan(0);

  await page.getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/accounts");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();

  for (const [label, types] of Object.entries(GROUPS)) {
    const inGroup = accounts.filter((a) => types.includes(a.type));
    if (inGroup.length === 0) {
      await expect(page.getByRole("heading", { name: new RegExp(`^${label} ·`) })).toHaveCount(0);
      continue;
    }
    const group = page
      .getByRole("heading", { name: `${label} · ${inGroup.length}` })
      .locator("xpath=ancestor::section[1]");
    await expect(group).toBeVisible();
    for (const account of inGroup) {
      const row = group.getByRole("listitem").filter({
        has: page.getByRole("link", { name: account.name, exact: true }),
      });
      await expect(row).toHaveCount(1);
      const caption = row.getByText(new RegExp(`^${freshness(account.newestPostedOn)}`));
      await expect(caption).toBeVisible();
      if (isStale(account.newestPostedOn)) {
        await expect(caption).toContainText("(stale)");
        // The warning colour is #8A5600 in the light theme.
        await expect(caption).toHaveClass(/text-warning/);
        await expect(caption).toHaveCSS("color", "rgb(138, 86, 0)");
      } else {
        await expect(caption).not.toContainText("stale");
      }
      // Only the cash types have a balance, and it is the server's figure.
      if (CASH_TYPES.includes(account.type)) {
        const balance = await page.request.get(`/api/accounts/${account.id}/balance`);
        const { balanceCents } = (await balance.json()) as { balanceCents: number };
        await expect(
          row.getByText(MONEY.format(balanceCents / 100), { exact: true }),
        ).toBeVisible();
      } else {
        await expect(row.getByText(/\$\d/)).toHaveCount(0);
      }
    }
  }
});

test("an account's page shows its balance, freshness and only its transactions in range", async ({
  page,
}) => {
  await signInWithPassword(page, loadAccount());
  const list = await page.request.get("/api/accounts");
  const accounts = ((await list.json()) as { accounts: ApiAccount[] }).accounts;
  const account = accounts.find(
    (a) => a.type === "transaction" && a.newestPostedOn !== null,
  ) as ApiAccount;
  expect(account).toBeDefined();
  const newest = account.newestPostedOn as string;
  const from = shiftDay(newest, -60);
  const range = `account=${account.id}&from=${from}&to=${newest}`;
  const inRange = await page.request.get(`/api/ledger/transactions?${range}`);
  const expected = (await inRange.json()) as ApiTransactions;
  expect(expected.summary.count).toBeGreaterThan(0);
  // The range really narrows the list: the account has older lines too.
  const all = await page.request.get(`/api/ledger/transactions?account=${account.id}`);
  expect(((await all.json()) as ApiTransactions).page.total).toBeGreaterThan(expected.page.total);

  await page.goto(`/accounts/${account.id}?from=${from}&to=${newest}`);
  await expect(page.getByRole("heading", { name: account.name, level: 2 })).toBeVisible();
  const balance = await page.request.get(`/api/accounts/${account.id}/balance`);
  const { balanceCents } = (await balance.json()) as { balanceCents: number };
  await expect(page.getByText(MONEY.format(balanceCents / 100), { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`^${freshness(account.newestPostedOn)}`))).toBeVisible();

  const noun = expected.summary.count === 1 ? "transaction" : "transactions";
  await expect(page.getByText(new RegExp(`^${expected.summary.count} ${noun} ·`))).toBeVisible();
  const table = page.getByRole("table", { name: "Transactions" });
  await expect(table.getByRole("checkbox")).toHaveCount(Math.min(50, expected.page.total));
  // The page is already about one account: no Account filter, and the URL keeps the range only.
  await expect(page.getByRole("combobox", { name: "Account" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Type" }).selectOption("out");
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/accounts/${account.id}` &&
      url.searchParams.get("type") === "out" &&
      url.searchParams.get("from") === from &&
      !url.searchParams.has("account"),
  );
});

test("an unknown account shows not found", async ({ page }) => {
  await signInWithPassword(page, loadAccount());
  await page.goto("/accounts/no-such-account");
  await expect(page.getByText("Account not found")).toBeVisible();
});
