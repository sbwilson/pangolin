import { defineConfig, devices } from "@playwright/test";

// Runs against an already running server on a fresh data directory (see compose.yaml); it
// starts no server itself. The auth project registers the household first, from the server's
// setup link; the other specs sign in as the person it saved. With E2E_RESTORED set, only the
// `restored` project runs: against a server restored from a backup of that household (CI).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
// Local sandboxes point this at a preinstalled Chromium; CI uses `playwright install`.
const executablePath = process.env.PW_CHROMIUM_PATH;
const restored = (process.env.E2E_RESTORED ?? "") !== "";

const chrome = {
  ...devices["Desktop Chrome"],
  ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
};

export default defineConfig({
  testDir: ".",
  forbidOnly: process.env.CI !== undefined,
  // A retry would meet an already-used setup link, so none: the flow runs once per server.
  retries: 0,
  workers: 1,
  reporter: process.env.CI !== undefined ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: restored
    ? [{ name: "restored", testMatch: "restored.spec.ts", use: chrome }]
    : [
        { name: "auth", testMatch: "auth.spec.ts", use: chrome },
        {
          name: "chromium",
          testMatch: "**/*.spec.ts",
          testIgnore: ["auth.spec.ts", "restored.spec.ts"],
          dependencies: ["auth"],
          use: chrome,
        },
      ],
});
