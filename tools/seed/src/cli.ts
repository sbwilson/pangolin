// `pnpm seed --out <dir> [--seed <seed>] [--today YYYY-MM-DD]`: writes <dir>/seed.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { defaultModules } from "./modules/index.ts";
import { DEFAULT_SEED, DEFAULT_TODAY, runSeed } from "./run.ts";
import { serialize } from "./serialize.ts";

const USAGE = "Usage: pnpm seed --out <dir> [--seed <seed>] [--today YYYY-MM-DD]";

/** Parses the arguments, generates the seed and writes `<out>/seed.json`. Returns its path. */
export function main(argv: readonly string[]): string {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      out: { type: "string" },
      seed: { type: "string", default: DEFAULT_SEED },
      today: { type: "string", default: DEFAULT_TODAY },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.out === undefined || values.out === "") throw new Error(`--out is required\n${USAGE}`);
  const output = runSeed({ seed: values.seed, today: values.today, modules: defaultModules });
  const dir = resolve(values.out);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "seed.json");
  writeFileSync(file, serialize(output));
  return file;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Wrote ${main(process.argv.slice(2))}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
