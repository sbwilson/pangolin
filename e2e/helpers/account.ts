// The household the auth spec registers, shared with the specs that run after it: the setup
// link comes from the server's data directory, and the first person's credentials are saved
// for later specs to sign in with.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { totp } from "./totp.ts";

export interface Account {
  readonly email: string;
  readonly password: string;
  /** The base32 TOTP secret shown during setup. */
  readonly totpSecret: string;
}

const stateFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".state", "account.json");

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

export function saveAccount(account: Account): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(account), { mode: 0o600 });
}

export function loadAccount(): Account {
  return JSON.parse(readFileSync(stateFile, "utf8")) as Account;
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
