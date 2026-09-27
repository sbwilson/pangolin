// Entry point of the bundled server (dist/main.js). The build places the committed
// migrations and the built PWA next to the bundle: dist/migrations and dist/public.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

function log(level: "info" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

const here = dirname(fileURLToPath(import.meta.url));

try {
  const config = loadConfig(process.env);
  const server = await startServer({
    config,
    migrationsDir: join(here, "migrations"),
    webRoot: join(here, "public"),
  });
  log("info", "listening", { port: server.port, schemaVersion: server.schemaVersion });

  const shutdown = (signal: string): void => {
    log("info", "shutting down", { signal });
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        log("error", "shutdown failed", { error: String(error) });
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch (error) {
  log("error", "startup failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}
