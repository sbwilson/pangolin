// Bundles the server to dist/main.js, the admin CLI to dist/cli.js and the backup snapshot worker
// to dist/backup-worker.js (better-sqlite3 stays external: it is a native addon), then copies the
// committed migrations and the built PWA next to them, and generates the demo seed
// (dist/demo-seed.json) by running the seed CLI.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageMigrationsDir } from "@pangolin/db";
import { build } from "esbuild";
import { generateSeedFile } from "./demo-seed.ts";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
const dist = join(serverDir, "dist");
const webDist = join(serverDir, "..", "web", "dist");

if (!existsSync(join(webDist, "index.html"))) {
  console.error(`No built PWA at ${webDist}. Run \`pnpm --filter @pangolin/web build\` first.`);
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });

await build({
  entryPoints: {
    main: join(serverDir, "src", "main.ts"),
    cli: join(serverDir, "src", "cli.ts"),
    // Loaded by src/backup/snapshot.ts next to the bundle that runs it.
    "backup-worker": join(serverDir, "src", "backup", "snapshot-worker.ts"),
  },
  outdir: dist,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.18",
  external: ["better-sqlite3"],
  sourcemap: true,
  // Bundled CommonJS dependencies may call require(); give them one in ESM.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});

cpSync(packageMigrationsDir, join(dist, "migrations"), { recursive: true });
cpSync(webDist, join(dist, "public"), { recursive: true });
generateSeedFile(join(dist, "demo-seed.json"));
console.log(`Copied migrations and PWA, and wrote demo-seed.json, into ${dist}`);
