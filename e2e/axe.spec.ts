import { existsSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { firstSessionFile, loadAccount, signInWithPassword } from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";

let signedIn: Promise<string | undefined> | undefined;

async function alexSession(browser: Browser): Promise<string | undefined> {
  if (existsSync(firstSessionFile)) {
    return firstSessionFile;
  }
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const res = await page.request.get("/api/accounts");
    await context.close();
    if (res.status() === 200) {
      return undefined;
    }
  } catch {
    // continue to sign-in attempt
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

const MODES = ["light", "dark"] as const;
type ColorMode = (typeof MODES)[number];

const THEMES = [
  "clay-linen",
  "harbour-morning",
  "fern-gully",
  "galah-party",
  "gelato-bar",
  "black-opal",
] as const;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

async function setMode(page: Page, mode: ColorMode, theme?: string): Promise<void> {
  await page.emulateMedia({ colorScheme: mode });
  await page.evaluate(
    ({ m, t }) => {
      try {
        localStorage.setItem("pangolin_mode", m);
        if (t) localStorage.setItem("pangolin_theme", t);
      } catch {}
      if (t) document.documentElement.setAttribute("data-theme", t);
      document.documentElement.setAttribute("data-mode", m);
      document.documentElement.setAttribute("data-resolved-mode", m);
    },
    { m: mode, t: theme },
  );
  await page.waitForTimeout(50);
}

async function auditPage(page: Page) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
  return results.violations;
}

test.describe("WCAG 2.2 AA accessibility audit", () => {
  for (const mode of MODES) {
    test(`/sign-in in ${mode} mode passes WCAG 2.2 AA audit`, async ({
      browser,
      cspViolations,
    }) => {
      const context = await browser.newContext({ colorScheme: mode });
      try {
        await watchCsp(context, cspViolations);
        await context.addInitScript(
          ({ m }: { m: string }) => {
            try {
              localStorage.setItem("pangolin_mode", m);
            } catch {}
          },
          { m: mode },
        );
        const page = await context.newPage();
        await page.route("**/api/identity/me", (route) =>
          route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ message: "Unauthorized" }),
          }),
        );
        await page.goto("/sign-in");
        await page.waitForLoadState("domcontentloaded");
        await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

        await setMode(page, mode);

        const initialViolations = await auditPage(page);
        expect(
          initialViolations,
          `Violations on /sign-in passkey view (${mode}): ${JSON.stringify(initialViolations, null, 2)}`,
        ).toEqual([]);

        // Audit password view with email/password/submit inputs
        await page.getByRole("button", { name: "Use password instead" }).click();
        await expect(
          page.getByRole("heading", { name: "Sign in with your password" }),
        ).toBeVisible();

        const passwordViolations = await auditPage(page);
        expect(
          passwordViolations,
          `Violations on /sign-in password view (${mode}): ${JSON.stringify(passwordViolations, null, 2)}`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });

    test(`/transactions in ${mode} mode passes WCAG 2.2 AA audit`, async ({
      browser,
      cspViolations,
    }) => {
      const storageState = await alexSession(browser);
      const context = await browser.newContext({
        colorScheme: mode,
        ...(storageState ? { storageState } : {}),
      });
      try {
        await watchCsp(context, cspViolations);
        await context.addInitScript(
          ({ m }: { m: string }) => {
            try {
              localStorage.setItem("pangolin_mode", m);
            } catch {}
          },
          { m: mode },
        );
        const page = await context.newPage();
        await page.goto("/transactions");
        await page.waitForLoadState("domcontentloaded");
        await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();

        await setMode(page, mode);

        const violations = await auditPage(page);
        expect(
          violations,
          `Violations on /transactions (${mode}): ${JSON.stringify(violations, null, 2)}`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });

    test(`/accounts in ${mode} mode passes WCAG 2.2 AA audit`, async ({
      browser,
      cspViolations,
    }) => {
      const storageState = await alexSession(browser);
      const context = await browser.newContext({
        colorScheme: mode,
        ...(storageState ? { storageState } : {}),
      });
      try {
        await watchCsp(context, cspViolations);
        await context.addInitScript(
          ({ m }: { m: string }) => {
            try {
              localStorage.setItem("pangolin_mode", m);
            } catch {}
          },
          { m: mode },
        );
        const page = await context.newPage();
        await page.goto("/accounts");
        await page.waitForLoadState("domcontentloaded");
        await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();

        await setMode(page, mode);

        const violations = await auditPage(page);
        expect(
          violations,
          `Violations on /accounts (${mode}): ${JSON.stringify(violations, null, 2)}`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });

    test(`/accounts/:id in ${mode} mode passes WCAG 2.2 AA audit`, async ({
      browser,
      cspViolations,
    }) => {
      const storageState = await alexSession(browser);
      const context = await browser.newContext({
        colorScheme: mode,
        ...(storageState ? { storageState } : {}),
      });
      try {
        await watchCsp(context, cspViolations);
        await context.addInitScript(
          ({ m }: { m: string }) => {
            try {
              localStorage.setItem("pangolin_mode", m);
            } catch {}
          },
          { m: mode },
        );
        const page = await context.newPage();
        const res = await page.request.get("/api/accounts");
        expect(res.status()).toBe(200);
        const data = (await res.json()) as { accounts: { id: string }[] };
        const account = data.accounts[0];
        if (!account) throw new Error("Expected at least one account");
        const accountId = account.id;

        await page.goto(`/accounts/${accountId}`);
        await page.waitForLoadState("domcontentloaded");
        await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();

        await setMode(page, mode);

        const violations = await auditPage(page);
        expect(
          violations,
          `Violations on /accounts/:id (${mode}): ${JSON.stringify(violations, null, 2)}`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });

    test(`/settings in ${mode} mode passes WCAG 2.2 AA audit`, async ({
      browser,
      cspViolations,
    }) => {
      const storageState = await alexSession(browser);
      const context = await browser.newContext({
        colorScheme: mode,
        ...(storageState ? { storageState } : {}),
      });
      try {
        await watchCsp(context, cspViolations);
        await context.addInitScript(
          ({ m }: { m: string }) => {
            try {
              localStorage.setItem("pangolin_mode", m);
            } catch {}
          },
          { m: mode },
        );
        const page = await context.newPage();
        await page.goto("/settings");
        await page.waitForLoadState("domcontentloaded");
        await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();

        await setMode(page, mode);

        const violations = await auditPage(page);
        expect(
          violations,
          `Violations on /settings (${mode}): ${JSON.stringify(violations, null, 2)}`,
        ).toEqual([]);

        // Audit open "Leave household" confirmation dialog
        const accountsCard = page.locator("#accounts");
        const leaveBtn = accountsCard.getByRole("button", { name: "Leave household" });
        await leaveBtn.scrollIntoViewIfNeeded();
        if (await leaveBtn.isEnabled()) {
          await leaveBtn.click();
          const dialog = page.getByRole("dialog", { name: "Leave household" });
          await expect(dialog).toBeVisible();

          const modalViolations = await auditPage(page);
          expect(
            modalViolations,
            `Violations on /settings Leave household modal (${mode}): ${JSON.stringify(modalViolations, null, 2)}`,
          ).toEqual([]);

          await dialog.getByRole("button", { name: "Cancel" }).click();
          await expect(dialog).toBeHidden();
        }
      } finally {
        await context.close();
      }
    });
  }
});

test.describe("WCAG 2.2 AA dark mode theme contrast audit", () => {
  for (const theme of THEMES) {
    test(`theme ${theme} in dark mode passes WCAG 2.2 AA audit`, async ({
      browser,
      cspViolations,
    }) => {
      const storageState = await alexSession(browser);
      const context = await browser.newContext({
        colorScheme: "dark",
        ...(storageState ? { storageState } : {}),
      });
      try {
        await watchCsp(context, cspViolations);
        await context.addInitScript(
          ({ m, t }: { m: string; t: string }) => {
            try {
              localStorage.setItem("pangolin_mode", m);
              localStorage.setItem("pangolin_theme", t);
            } catch {}
            document.documentElement.setAttribute("data-theme", t);
            document.documentElement.setAttribute("data-mode", m);
            document.documentElement.setAttribute("data-resolved-mode", m);
          },
          { m: "dark", t: theme },
        );
        const page = await context.newPage();
        await page.route("**/api/identity/preferences", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ theme, mode: "dark" }),
          }),
        );
        await page.goto("/settings");
        await page.waitForLoadState("domcontentloaded");
        await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();

        await setMode(page, "dark", theme);

        const violations = await auditPage(page);
        expect(
          violations,
          `Violations on /settings in dark mode with theme ${theme}: ${JSON.stringify(violations, null, 2)}`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
