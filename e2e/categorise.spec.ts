// The categorisation journey end to end against the stack's replay mock-llm (`llm` compose
// profile): sign in, point the `categorise` purpose at a mock provider whose fixture suggests
// a category for every batch position, import a three-row statement from unknown merchants,
// run the admin `categorise` command over the whole ledger, and watch `/review` batch the
// ≥90% cards into the bulk-accept card. Accepting all categorises the rows — this spec's
// three among them — and clears the badge again. Nothing here ever applies a suggestion
// without a person accepting it in the UI (AD-6, AD-10).
import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

// The mock-llm container mounts this directory read-only and re-reads the fixture per request,
// so a file written here between the tests' setup and the CLI run is the one it replays.
const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "tools",
  "mock-llm",
  "fixtures",
  "openai",
);
// The server (not this host) calls the mock: in CI it is a compose DNS name.
const llmBase = process.env.E2E_LLM_BASE_URL ?? "http://127.0.0.1:4111";

// One fixture per run, named after the model the provider row carries. The run id only needs
// to be a safe filename token for the fixture directory; the provider create route places no
// charset restriction on the model (the schema only requires a non-empty string).
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const model = `mock-live-${runId}`;
const fixturePath = join(fixtureDir, `${model}.json`);

const categoriseCommand = (): string => {
  const command = process.env.E2E_CATEGORISE_COMMAND;
  if (command === undefined || command === "") {
    throw new Error(
      "Set E2E_CATEGORISE_COMMAND (e.g. `docker compose exec -T pangolin node dist/cli.js categorise`)",
    );
  }
  return command;
};

/** A fresh public account of Alex's: the candidates must never reach a private account. */
async function createAccount(page: Page, name: string): Promise<string> {
  const res = await page.evaluate(async (accountName) => {
    const me = (await (await fetch("/api/identity/me")).json()) as { personId: string };
    const r = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: accountName,
        type: "transaction",
        currency: "AUD",
        isPrivate: false,
        owners: [{ personId: me.personId, shareBp: 10000 }],
      }),
    });
    return { status: r.status, id: ((await r.json()) as { account: { id: string } }).account.id };
  }, name);
  expect(res.status).toBe(201);
  return res.id;
}

async function reviewCount(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const c = (await (await fetch("/api/review/count")).json()) as { open: number };
    return c.open;
  });
}

/** A category of the household's, suggested for every candidate row. */
async function someCategory(page: Page): Promise<string> {
  const categories = await page.evaluate(async () => {
    const res = await fetch("/api/classify/categories");
    return ((await res.json()) as { categories: { id: string }[] }).categories.map((c) => c.id);
  });
  expect(categories.length).toBeGreaterThan(0);
  return categories[0] as string;
}

/**
 * Write the replay fixture: one OpenAI chat completion suggesting the same category at 0.92 —
 * the bulk card's threshold — for EVERY position of a batch (0..CATEGORISE_BATCH_SIZE-1). The
 * run is over the whole ledger, so the candidates include the seeded household's uncategorised
 * rows as well as this spec's import; answering every position makes the run deterministic —
 * recorded equals candidates and the journey's own rows are always among them. A shorter batch
 * simply never reads the trailing suggestions; the engine iterates per row.
 */
function writeFixture(categoryId: string): void {
  const content = JSON.stringify({
    suggestions: Array.from({ length: 20 }, (_, index) => ({
      index,
      category_id: categoryId,
      confidence: 0.92,
    })),
  });
  const completion = {
    id: `chatcmpl-${model}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: null },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 400, completion_tokens: 40, total_tokens: 440 },
  };
  const fixture = {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(completion),
  };
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
}

async function setupProvider(page: Page): Promise<void> {
  const created = await page.evaluate(
    async ([baseUrl, m]) => {
      const res = await fetch("/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Mock categorise ${m}`,
          kind: "openai",
          baseUrl,
          model: m,
          apiKey: "mock-key",
        }),
      });
      return { status: res.status, id: ((await res.json()) as { id: string }).id };
    },
    [llmBase, model],
  );
  expect(created.status).toBe(201);
  const assigned = await page.evaluate(
    async ([providerId]) =>
      (
        await fetch("/api/llm/purposes/categorise", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId }),
        })
      ).status,
    [created.id],
  );
  expect(assigned).toBe(200);
}

/** Import a three-row statement through the popover, exactly as a person would. */
async function importStatement(page: Page, accountName: string): Promise<void> {
  const csv = [
    "Date,Amount,Description,Balance",
    // Merchants no seeded payee or rule knows: every row must stay uncategorised for the engine.
    "10/06/2026,-15.00,QUANDONG FLATS KIOSK,1000.00",
    "11/06/2026,-45.20,BRIXHAM GATE LOCKUPS,954.80",
    "12/06/2026,-120.00,TAMBREY WELL DEPOT,834.80",
    "",
  ].join("\n");
  await page.goto("/transactions");
  await page.getByRole("button", { name: "Import" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import a bank file" });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("import-file").setInputFiles({
    name: `categorise-${runId}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await dialog.getByLabel("Which account is this for?").selectOption({ label: accountName });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByTestId("import-status")).toContainText("3");
  // The "Close import" button is the backdrop beside the dialog, not inside it; Esc is the
  // documented close (import.spec covers focus return).
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test.afterAll(() => {
  // The fixture lives in the repository tree only for the duration of the run.
  rmSync(fixturePath, { force: true });
});

test("categorises imported rows and bulk-accepts them from the review inbox", async ({ page }) => {
  await signInWithPassword(page, loadAccount());

  // The inbox state to return to: the run must add three items and leave none of its own.
  const openBefore = await reviewCount(page);

  const name = `Categorise e2e ${runId}`;
  const accountId = await createAccount(page, name);
  const categoryId = await someCategory(page);
  writeFixture(categoryId);
  await setupProvider(page);

  await importStatement(page, name);
  expect(await reviewCount(page)).toBe(openBefore + 3);

  // The admin command over the socket, like a person typing `pangolin categorise`. It runs
  // over the whole ledger (the seeded household leaves uncategorised rows on purpose), so the
  // printed count covers more than this spec's import — every candidate gets a suggestion and
  // none is discarded.
  const out = execSync(categoriseCommand(), { encoding: "utf8" });
  const counts =
    /Sent (\d+) unclassified transactions to the provider: (\d+) suggestions recorded for the review inbox, (\d+) discarded/.exec(
      out,
    );
  if (counts === null) throw new Error(`unexpected categorise output: ${out}`);
  const [candidates, recorded, discarded] = [
    Number(counts[1]),
    Number(counts[2]),
    Number(counts[3]),
  ];
  expect(discarded).toBe(0);
  expect(recorded).toBe(candidates);
  expect(recorded).toBeGreaterThanOrEqual(3);

  // The bulk card: the ≥90% suggestions batched under "N more we're very sure about".
  await page.goto("/review");
  const bulk = page.locator('[data-kind="classify.bulk_accept"]').first();
  await expect(bulk).toBeVisible();
  await expect(bulk).toContainText(/\d+ more we're very sure about/);
  await bulk.getByRole("button", { name: "Accept all" }).click();
  await expect(page.locator('[data-kind="classify.bulk_accept"]')).toHaveCount(0);

  // The ledger: every imported row now has a category, and the inbox is back where it started.
  const rows = await page.evaluate(async (id: string) => {
    const res = await fetch(`/api/ledger/transactions?account=${encodeURIComponent(id)}`);
    const body = (await res.json()) as {
      transactions: { descriptionRaw: string; splits: { categoryId: string | null }[] }[];
    };
    return body.transactions;
  }, accountId);
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row.splits.length).toBeGreaterThan(0);
    // Not merely categorised: the fixture answered with this exact category, so the row must
    // carry it — the engine's suggestion, not some other default, was accepted.
    for (const split of row.splits) expect(split.categoryId).toBe(categoryId);
  }
  const uncategorised = await page.evaluate(async (id: string) => {
    const res = await fetch(
      `/api/ledger/transactions?account=${encodeURIComponent(id)}&uncategorised=true`,
    );
    const body = (await res.json()) as { transactions: unknown[] };
    return body.transactions.length;
  }, accountId);
  expect(uncategorised).toBe(0);

  expect(await reviewCount(page)).toBe(openBefore);
  if (openBefore === 0) {
    // Conditional: with the seed's other open items the badge shows a count instead of the
    // "all clear" copy (deviation recorded in the plan's Plan Change Log). When it renders,
    // the sidebar copy is the one under review (the mobile tab bar is hidden here).
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByTestId("review-badge"),
    ).toContainText(/all clear/);
  }
});
