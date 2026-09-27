import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages,tools,scripts,deploy}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
  },
});
