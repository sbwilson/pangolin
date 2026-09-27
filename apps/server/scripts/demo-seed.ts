// Generates a seed file by running the `tools/seed` CLI in a child process. The server never
// imports `tools/seed` (the package graph has no such arrow); it only reads the JSON it writes.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const seedCli = fileURLToPath(new URL("../../../tools/seed/src/cli.ts", import.meta.url));

/** Runs the seed CLI (with any extra `--seed`/`--today` arguments) and writes its output to `outFile`. */
export function generateSeedFile(outFile: string, args: readonly string[] = []): void {
  const dir = mkdtempSync(join(tmpdir(), "pangolin-seed-"));
  try {
    const run = spawnSync(process.execPath, [seedCli, "--out", dir, ...args], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (run.error !== undefined) {
      throw new Error(`The seed CLI could not run (${seedCli}): ${run.error.message}`);
    }
    if (run.status !== 0) {
      const stderr = (run.stderr ?? "").trim();
      throw new Error(`The seed CLI failed (${run.status ?? run.signal}): ${stderr}`);
    }
    const written = join(dir, "seed.json");
    if (!existsSync(written)) {
      throw new Error(`The seed CLI exited 0 but wrote no ${written}`);
    }
    mkdirSync(dirname(outFile), { recursive: true });
    copyFileSync(written, outFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
