// The household the auth spec registers, shared with the specs that run after it: the setup
// link comes from the server's data directory, and the first person's credentials are saved
// for later specs to sign in with.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
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
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Authenticator code").fill(totp(account.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
