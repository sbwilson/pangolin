import { defineConfig } from "drizzle-kit";

// drizzle-kit generates SQL only; our own runner (src/migrate.ts) applies it.
// drizzle-kit does not emit STRICT: hand-edit every generated CREATE TABLE to add it.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});
