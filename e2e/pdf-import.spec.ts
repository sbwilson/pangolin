// The PDF statement path end to end against the stack's replay mock-llm (`llm` compose profile):
// sign in, configure the `pdf_extract` provider, upload a balanced statement through the Import
// popover (verified, staged, encrypted at rest, readable only through the batch route), then
// upload a one-cent-off statement: the popover reports the exact gap, `/review` shows the card
// with rows beside the rendered page image, a correction persists, and Re-check clears it.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test } from "./helpers/csp.ts";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "importers",
  "fixtures",
);
// The server (not this host) calls the mock: in CI it is a compose DNS name.
const llmBase = process.env.E2E_LLM_BASE_URL ?? "http://127.0.0.1:4111";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

/** A fresh account of Alex's own, returning its id for the batch-scoped file route. */
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
    return { status: r.status, id: ((await r.json()) as { id: string }).id };
  }, name);
  expect(res.status).toBe(201);
  return res.id;
}

async function setupProvider(page: Page, model: string): Promise<string> {
  const created = await page.evaluate(
    async ([baseUrl, m]) => {
      const res = await fetch("/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Mock PDF ${Date.now()}`,
          kind: "openai",
          baseUrl,
          model: m,
          apiKey: "mock-key",
          // The compose DNS name is not a LAN literal, so AD-6 needs the explicit opt-in.
          cloudPdf: true,
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
        await fetch("/api/llm/purposes/pdf_extract", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId }),
        })
      ).status,
    [created.id],
  );
  expect(assigned).toBe(200);
  return created.id;
}

async function setProviderModel(page: Page, id: string, model: string): Promise<void> {
  const status = await page.evaluate(
    async ([providerId, m]) =>
      (
        await fetch(`/api/llm/providers/${providerId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: providerId, model: m }),
        })
      ).status,
    [id, model],
  );
  expect(status).toBe(200);
}

interface StoredFile {
  readonly name: string;
  /** The first four bytes in lower-case hex. */
  readonly magic: string;
}

/** What the data volume holds right now: names plus a sniff of the bytes (AD-21). */
function listAttachments(): StoredFile[] {
  const command = process.env.E2E_ATTACHMENTS_COMMAND;
  if (command !== undefined && command !== "") {
    const out = execSync(command, { encoding: "utf8" }).trim();
    if (out === "") return [];
    return out
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts): parts is [string, string] => parts.length >= 2 && parts[1] !== undefined)
      .map(([name, magic]) => ({ name, magic }));
  }
  const dataDir = process.env.PANGOLIN_DATA_DIR;
  if (dataDir === undefined) {
    throw new Error("Set PANGOLIN_DATA_DIR (the server's) or E2E_ATTACHMENTS_COMMAND");
  }
  const dir = join(dataDir, "attachments");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => ({
    name,
    magic: readFileSync(join(dir, name)).subarray(0, 4).toString("hex"),
  }));
}

async function openPopoverAndUpload(page: Page, file: string, accountName: string): Promise<void> {
  await page.goto("/transactions");
  await page.getByRole("button", { name: "Import" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import a bank file" });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("import-file").setInputFiles(join(fixtures, file));
  await dialog.getByLabel("Which account is this for?").selectOption({ label: accountName });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
}

test("uploads, reviews, corrects and re-checks a PDF statement", async ({ page }) => {
  await signInWithPassword(page, loadAccount());
  const name = `PDF e2e ${Date.now()}`;
  const accountId = await createAccount(page, name);
  const providerId = await setupProvider(page, "mock-pdf-ok");

  // A balanced statement: the popover reports verified-and-staged, never "imported".
  await openPopoverAndUpload(page, "statement-ok.pdf", name);
  const status = page.getByTestId("import-status");
  await expect(status).toHaveText("3 rows verified and staged.");
  expect((await status.textContent()) ?? "").not.toMatch(/imported/i);

  // At rest the file is a 64-hex HMAC name whose bytes are not a plaintext %PDF (AD-21).
  const stored = listAttachments();
  expect(
    stored.some((f) => /^[0-9a-f]{64}$/.test(f.name) && f.magic !== "25504446"),
    `no encrypted attachment in ${JSON.stringify(stored)}`,
  ).toBe(true);

  // The stored bytes decrypt through the batch row only: the file route serves the real %PDF.
  const fileCheck = await page.evaluate(
    async ([id, b64]) => {
      const upload = await fetch("/api/import/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: id, content: b64 }),
      });
      const batch = (await upload.json()) as { batchId?: string; status?: string };
      const res = await fetch(`/api/import/pdf/${batch.batchId}/file`);
      const head = Array.from(new Uint8Array(await res.arrayBuffer()).subarray(0, 4));
      return { upload: upload.status, batch: batch.status, res: res.status, head };
    },
    [accountId, readFileSync(join(fixtures, "statement-ok.pdf")).toString("base64")],
  );
  expect(fileCheck.upload).toBe(200);
  expect(fileCheck.batch).toBe("ready");
  expect(fileCheck.res).toBe(200);
  expect(String.fromCharCode(...fileCheck.head)).toBe("%PDF");

  // A one-cent-off statement: the exact gap in the popover, with a link to Needs review.
  await setProviderModel(page, providerId, "mock-pdf-gap");
  const openBefore = await page.evaluate(async () => {
    const c = (await (await fetch("/api/review/count")).json()) as { open: number };
    return c.open;
  });
  await openPopoverAndUpload(page, "statement-gap.pdf", name);
  await expect(status).toContainText("exact gap of 1 cents");
  await status.getByRole("link", { name: "Needs review" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/review");

  // The card: extracted rows beside the rendered page image.
  const card = page.locator('[data-kind="import.pdf_failed"]').first();
  await expect(card).toBeVisible();
  await expect(card.getByRole("alert").first()).toContainText("exact gap of 1 cents");
  await expect(card.getByText("Row 2")).toBeVisible();
  await expect(card.getByRole("img", { name: "Statement page 1" })).toBeVisible();

  // The inbox with the new card open stays axe-clean (mirrors axe.spec's /review audit).
  const audit = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  expect(audit.violations, JSON.stringify(audit.violations)).toEqual([]);

  // Correct the bad amount (the extraction says -20.01; the statement balances at -20.00).
  const woolies = card.getByRole("listitem").filter({ hasText: "WOOLWORTHS" });
  await expect(woolies.getByLabel("Amount")).toHaveValue("-20.01");
  await woolies.getByLabel("Amount").fill("-20.00");
  await woolies.getByRole("button", { name: "Save row 2" }).click();
  await expect(woolies.getByLabel("Amount")).toHaveValue("-20.00");

  // Re-check (no LLM): the batch turns ready and the card is gone.
  await card.getByRole("button", { name: "Re-check" }).click();
  await expect(page.locator('[data-kind="import.pdf_failed"]')).toHaveCount(0);
  const openAfter = await page.evaluate(async () => {
    const c = (await (await fetch("/api/review/count")).json()) as { open: number };
    return c.open;
  });
  expect(openAfter).toBe(openBefore);
});
