import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // apps/web imports `@/…` (its vite.config.ts has the same alias).
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  test: {
    include: ["{apps,packages,tools,scripts,deploy}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    // Tests that apply the demo seed (732 events, about 1.4 s on a laptop) take 4 to 6 s on the
    // 2-vCPU CI runner, which also runs the install script suite beside them, so the 5 s default
    // fails them on a busy run. A real hang still fails, only later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
