// The household the auth spec registers, shared with the specs that run after it: the setup
// link comes from the server's data directory, and the first person's credentials are saved
// for later specs to sign in with.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, expect, type Page } from "@playwright/test";
import { totp } from "./totp.ts";

export interface Account {
  readonly email: string;
  readonly password: string;
  /** The base32 TOTP secret shown during setup. */
  readonly totpSecret: string;
  /** The recovery codes shown once when enrolment completed, `XXXXX-XXXXX`. */
  readonly recoveryCodes: readonly string[];
}

const stateDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".state");
const stateFile = join(stateDir, "account.json");
const partnerFile = join(stateDir, "partner.json");
/** The partner's signed-in browser state, saved when they register (see `savePartnerSession`). */
export const partnerSessionFile = join(stateDir, "partner-session.json");
/**
 * The first person's signed-in browser state, saved by a spec that needs a session that later
 * specs cannot invalidate (see routing.spec.ts); the partner's above ends when Alex resets them.
 */
export const firstSessionFile = join(stateDir, "first-session.json");

/**
 * The first-boot setup link: from `E2E_SETUP_LINK_COMMAND` (e.g. `docker compose exec` in CI),
 * else from `setup-link.txt` in `PANGOLIN_DATA_DIR`.
 */
export function readSetupLink(): string {
  const command = process.env.E2E_SETUP_LINK_COMMAND;
  if (command !== undefined && command !== "")
    return execSync(command, { encoding: "utf8" }).trim();
  const dataDir = process.env.PANGOLIN_DATA_DIR;
  if (dataDir === undefined) {
    throw new Error("Set PANGOLIN_DATA_DIR (the server's) or E2E_SETUP_LINK_COMMAND");
  }
  return readFileSync(join(dataDir, "setup-link.txt"), "utf8").trim();
}

/** Which of the household's two people: the first to sign up, or their invited partner. */
export type Who = "first" | "partner";

export function saveAccount(account: Account, who: Who = "first"): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(who === "first" ? stateFile : partnerFile, JSON.stringify(account), {
    mode: 0o600,
  });
}

export function loadAccount(who: Who = "first"): Account {
  return JSON.parse(readFileSync(who === "first" ? stateFile : partnerFile, "utf8")) as Account;
}

/** Signs in through the page with email, password and a computed TOTP code. */
export async function signInWithPassword(page: Page, account: Account): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Use password instead" }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Authenticator code").fill(totp(account.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/^Signed in as /)).toBeVisible();
}

/**
 * The last enrolment step: shows the recovery codes once, confirms they were saved and returns
 * them. The signed-in home follows.
 */
export async function saveRecoveryCodes(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "Show my recovery codes" }).click();
  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const codes = (await list.getByRole("listitem").allTextContents()).map((code) => code.trim());
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  await page.getByLabel("I have saved these codes").check();
  await continueButton.click();
  return codes;
}

let signedIn: Promise<string> | undefined;

/**
 * Signs Alex in once with password and TOTP and saves the session.
 */
export function alexSession(browser: Browser): Promise<string> {
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
