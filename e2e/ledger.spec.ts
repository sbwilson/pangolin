// The seeded ledger, end to end. After both partners have signed up (auth.spec), the `seed`
// admin command loads the demo ledger onto them: institutions, accounts of every cash type,
// payees and tags, a year of transactions with splits, hidden names and transfers. Each partner
// then sees the shared accounts plus their own private ones, and nothing else. The first person
// signs in with password and TOTP; the partner's email is locked by auth.spec's lockout test,
// so the partner uses the session saved when they registered.
//
// Nothing here hard-codes the seed's contents: the spec runs the generator itself (it is
// deterministic, so it makes the file the server loads) and derives what each person should
// see from its events and expectations.
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { loadAccount, partnerSessionFile, signInWithPassword } from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";

interface SeedEvent {
  type: string;
  key?: string;
  account?: string;
  isPrivate?: boolean;
  owners?: { person: string }[];
  postedOn?: string;
  amountCents?: number;
  description?: string;
  transaction?: string;
  transactions?: string[];
  by?: string;
}

interface Seed {
  events: SeedEvent[];
  expectations: Record<string, unknown>;
}

interface ApiTransaction {
  id: string;
  postedOn: string;
  amountCents: number;
  descriptionRaw: string;
  transferLabel: string | null;
  remainingCents: number;
  splits: { amountCents: number }[];
}

/** The seed's `person-a` and `person-b` are the first and second to sign up (auth.spec). */
const SIGNED_UP_AS = { "person-a": "Alex", "person-b": "Sam" } as const;
type Person = keyof typeof SIGNED_UP_AS;
const PEOPLE = Object.keys(SIGNED_UP_AS) as Person[];

const HIDDEN = /^Hidden until \d{1,2} [A-Z][a-z]{2} \d{4}$/;

let seed: Seed;
let seedDir: string;
let loaded: { accounts: number; transactions: number };

const events = (type: string) => seed.events.filter((e) => e.type === type);
const expectation = <T>(key: string) => seed.expectations[key] as T;
const accountOf = (key: string) =>
  events("account.created").find((a) => a.key === key) as SeedEvent;
const transactionOf = (key: string) =>
  events("transaction.created").find((t) => t.key === key) as SeedEvent;

/** Accounts a person sees: the shared ones and their own private ones (AD-3). */
function seesAccount(person: Person, key: string): boolean {
  const account = accountOf(key);
  return account.isPrivate !== true || (account.owners ?? []).some((o) => o.person === person);
}

/** What `person` should see of each seeded transaction, as `date|amount|description`. */
function expectedRows(person: Person): string[] {
  const hiddenBy = new Map(events("transaction.name-hidden").map((h) => [h.transaction, h.by]));
  return events("transaction.created")
    .filter((t) => seesAccount(person, t.account as string))
    .map((t) => {
      const by = hiddenBy.get(t.key);
      const name = by !== undefined && by !== person ? "HIDDEN" : t.description;
      return `${t.postedOn}|${t.amountCents}|${name}`;
    })
    .sort();
}

const rowOf = (t: ApiTransaction): string =>
  `${t.postedOn}|${t.amountCents}|${HIDDEN.test(t.descriptionRaw) ? "HIDDEN" : t.descriptionRaw}`;

/** One page of the list API: 50 rows, and the server's own total, page count and cursors. */
interface ApiPage {
  transactions: ApiTransaction[];
  page: {
    total: number;
    pageCount: number;
    page: number;
    next: string | null;
    prev: string | null;
  };
  summary: { count: number; inCents: number; outCents: number };
  dayNets: Record<string, number>;
}

async function fetchPage(page: Page, query = ""): Promise<ApiPage> {
  const res = await page.request.get(`/api/ledger/transactions${query}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as ApiPage;
}

/** Every transaction the person sees, by following `next` from the first page. */
async function fetchTransactions(page: Page): Promise<ApiTransaction[]> {
  const rows: ApiTransaction[] = [];
  let query = "";
  for (;;) {
    const body = await fetchPage(page, query);
    rows.push(...body.transactions);
    if (body.page.next === null) return rows;
    query = `?after=${encodeURIComponent(body.page.next)}`;
  }
}

const seedCommand = (): string => {
  const command = process.env.E2E_SEED_COMMAND;
  if (command === undefined || command === "") {
    throw new Error(
      "Set E2E_SEED_COMMAND (e.g. `docker compose exec -T pangolin node dist/cli.js seed`)",
    );
  }
  return command;
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // The generator is deterministic, so this is the file the server loads from its build.
  seedDir = mkdtempSync(join(tmpdir(), "pangolin-e2e-seed-"));
  const cli = fileURLToPath(new URL("../tools/seed/src/cli.ts", import.meta.url));
  execFileSync(process.execPath, [cli, "--out", seedDir], { stdio: "pipe" });
  seed = JSON.parse(readFileSync(join(seedDir, "seed.json"), "utf8")) as Seed;
  loaded = {
    accounts: events("account.created").length,
    transactions: events("transaction.created").length,
  };

  // CI runs the CLI in the container (`docker compose exec`); it needs both partners signed up
  // and the stack started with PANGOLIN_ENABLE_SEED=true.
  const out = execSync(seedCommand(), { encoding: "utf8" });
  expect(out).toContain(
    `Seeded ${loaded.accounts} accounts and ${loaded.transactions} transactions`,
  );
});

test.afterAll(() => {
  if (seedDir !== undefined) rmSync(seedDir, { recursive: true, force: true });
});

/** What a person sees in the UI and the API, checked against what the seed says they should. */
async function expectSeededView(page: Page, person: Person): Promise<ApiTransaction[]> {
  const visible = expectation<Record<string, number>>("transfers-and-privacy.visibleCounts")[
    person
  ] as number;
  expect(visible).toBeGreaterThan(300);

  // The UI shows the first page of 50 with the server's total and page count.
  await page.getByRole("button", { name: "Transactions" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/transactions");
  const table = page.getByRole("table", { name: "Transactions" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("checkbox")).toHaveCount(50);
  const first = await fetchPage(page);
  expect(first.transactions).toHaveLength(50);
  expect(first.page.total).toBe(visible);
  expect(first.page.pageCount).toBe(Math.ceil(visible / 50));
  expect(first.summary.count).toBe(visible);
  await expect(
    page.getByText(`Showing 50 of ${visible} \u00b7 Page 1 of ${first.page.pageCount}`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.has("after"));
  await expect(page.getByText(`Page 2 of ${first.page.pageCount}`)).toBeVisible();

  // Changing a filter from page 2 goes back to page 1: no paging position stays in the URL.
  const out = await fetchPage(page, "?type=out");
  expect(out.page.pageCount).toBeGreaterThan(1);
  await page.getByRole("combobox", { name: "Type" }).selectOption("out");
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("type") === "out" &&
      !url.searchParams.has("after") &&
      !url.searchParams.has("before") &&
      !url.searchParams.has("page"),
  );
  await expect(page.getByText(`Page 1 of ${out.page.pageCount}`)).toBeVisible();
  await expect(page.getByText(`${out.page.total} transactions`)).toBeVisible();

  // Next, then Previous (a `before` cursor), then a jump to a page number: each leaves one
  // paging position in the URL, and the pager follows.
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.has("after") && url.searchParams.get("type") === "out",
  );
  await expect(page.getByText(`Page 2 of ${out.page.pageCount}`)).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.has("before") &&
      !url.searchParams.has("after") &&
      !url.searchParams.has("page") &&
      url.searchParams.get("type") === "out",
  );
  await expect(page.getByText(`Page 1 of ${out.page.pageCount}`)).toBeVisible();
  await page.getByLabel("Go to page").fill("2");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("page") === "2" &&
      !url.searchParams.has("after") &&
      !url.searchParams.has("before") &&
      url.searchParams.get("type") === "out",
  );
  await expect(page.getByText(`Page 2 of ${out.page.pageCount}`)).toBeVisible();

  // The API holds the detail: the same rows, hidden names and transfer labels as the seed says.
  const rows = await fetchTransactions(page);
  expect(rows).toHaveLength(visible);
  expect(rows.map(rowOf).sort()).toEqual(expectedRows(person));

  // Every split list adds up to its transaction.
  for (const t of rows) {
    expect(t.splits.length).toBeGreaterThan(0);
    expect(t.splits.reduce((sum, s) => sum + s.amountCents, 0)).toBe(t.amountCents);
    expect(t.remainingCents).toBe(0);
  }
  const multiSplit = expectation<string[]>("ledger-transactions.multiSplitKeys");
  expect(multiSplit.length).toBeGreaterThan(0);
  const multiShown = rows.filter((t) => t.splits.length > 1).length;
  const multiExpected = multiSplit.filter((key) =>
    seesAccount(person, transactionOf(key).account as string),
  ).length;
  expect(multiShown).toBe(multiExpected);

  // A hidden name shows to the person who hid it and as a placeholder to the other.
  const hidden = expectation<{ transaction: string; by: Person; description: string }[]>(
    "transfers-and-privacy.hidden",
  );
  expect(hidden.length).toBeGreaterThan(0);
  for (const h of hidden) {
    const t = transactionOf(h.transaction);
    const row = rows.find(
      (r) =>
        r.postedOn === t.postedOn &&
        r.amountCents === t.amountCents &&
        (r.descriptionRaw === h.description || HIDDEN.test(r.descriptionRaw)),
    );
    expect(row, `${h.transaction} is in the account both partners share`).toBeDefined();
    if (h.by === person) expect(row?.descriptionRaw).toBe(h.description);
    else expect(row?.descriptionRaw).toMatch(HIDDEN);
  }

  // A transfer whose counterpart is in a partner's private account reads "Transfer from/to
  // <owner>" to the other partner, and carries no label for the owner, who sees both sides.
  const privateKeys = new Set(expectation<string[]>("transfers-and-privacy.privateTransferKeys"));
  expect(privateKeys.size).toBeGreaterThan(0);
  for (const group of events("transfer.grouped")) {
    for (const key of group.transactions as string[]) {
      if (!privateKeys.has(key)) continue;
      const t = transactionOf(key);
      if (accountOf(t.account as string).isPrivate === true) {
        // The private side exists only for its owner.
        expect(seesAccount(person, t.account as string)).toBe(group.by === person);
        continue;
      }
      const sides = rows.filter(
        (r) =>
          r.postedOn === t.postedOn &&
          r.amountCents === t.amountCents &&
          r.descriptionRaw === t.description,
      );
      expect(sides.length).toBeGreaterThan(0);
      const labels = sides.map((r) => r.transferLabel);
      if (group.by === person) expect(labels).toContain(null);
      else {
        const owner = SIGNED_UP_AS[group.by as Person];
        const direction = (t.amountCents as number) >= 0 ? "from" : "to";
        expect(labels).toContain(`Transfer ${direction} ${owner}`);
      }
    }
  }
  return rows;
}

test("the first person sees the shared accounts and their own private ones, not the partner's", async ({
  page,
}) => {
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText(`Signed in as ${SIGNED_UP_AS["person-a"]}`)).toBeVisible();
  await expectSeededView(page, "person-a");
});

test("the partner sees the shared accounts and their own private ones, not the first person's", async ({
  browser,
  cspViolations,
}) => {
  const context = await browser.newContext({ storageState: partnerSessionFile });
  try {
    await watchCsp(context, cspViolations);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByText(`Signed in as ${SIGNED_UP_AS["person-b"]}`)).toBeVisible();
    await expectSeededView(page, "person-b");
  } finally {
    await context.close();
  }
});

test("the partners' views differ only by private accounts and hidden names", () => {
  const [a, b] = PEOPLE.map((p) => expectedRows(p));
  const shared = events("transaction.created").filter(
    (t) => !accountOf(t.account as string).isPrivate,
  );
  expect(a?.length).toBeGreaterThan(shared.length);
  expect(b?.length).toBeGreaterThan(shared.length);
  expect(a).not.toEqual(b);
});

test("the API answers per viewer and is never cached", async ({ page }) => {
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText(`Signed in as ${SIGNED_UP_AS["person-a"]}`)).toBeVisible();
  const res = await page.request.get("/api/ledger/transactions");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  const { transactions } = (await res.json()) as { transactions: { descriptionRaw: string }[] };
  const partnerOnly = events("transaction.created")
    .filter((t) => !seesAccount("person-a", t.account as string))
    .map((t) => t.description);
  expect(partnerOnly.length).toBeGreaterThan(0);
  const seen = new Set(transactions.map((t) => t.descriptionRaw));
  const sharedNames = new Set(
    events("transaction.created")
      .filter((t) => seesAccount("person-a", t.account as string))
      .map((t) => t.description),
  );
  for (const name of partnerOnly) {
    // A description the partner's private account shares with a visible one (a merchant used in
    // both) is fine; one only the partner has must not appear.
    if (!sharedNames.has(name)) expect(seen.has(name as string)).toBe(false);
  }
});

test("loading the seed a second time is refused and changes nothing", async ({ page }) => {
  const run = spawnSync(seedCommand(), { shell: true, encoding: "utf8" });
  expect(run.status).not.toBe(0);
  expect(`${run.stdout}${run.stderr}`).toMatch(/already has accounts or transactions/);

  await signInWithPassword(page, loadAccount());
  await expect(page.getByText(`Signed in as ${SIGNED_UP_AS["person-a"]}`)).toBeVisible();
  const rows = await fetchTransactions(page);
  expect(rows).toHaveLength(
    expectation<Record<string, number>>("transfers-and-privacy.visibleCounts")[
      "person-a"
    ] as number,
  );
});
