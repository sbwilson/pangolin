// Entry point of the bundled server (dist/main.js). The build places the committed
// migrations, the built PWA and the demo seed next to the bundle: dist/migrations,
// dist/public and dist/demo-seed.json.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

function log(
  level: "info" | "warn" | "error",
  msg: string,
  fields: Record<string, unknown> = {},
): void {
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
    defaultSeedFile: join(here, "demo-seed.json"),
    log,
  });
  log("info", "listening", {
    port: server.port,
    schemaVersion: server.schemaVersion,
    demo: server.demo,
    version: config.version,
    ...(server.adminSocket === undefined ? {} : { adminSocket: server.adminSocket }),
  });
  if (server.setupLinkFile !== undefined) {
    // The path only: the link inside is a one-time sign-up token.
    log("info", "setup link written; open it to create the first login", {
      file: server.setupLinkFile,
    });
  }

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
