// Shared by the deploy tests: stub commands put on PATH in front of the real ones.
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Writes `dir/name`, a `#!/bin/sh` script of `lines`, executable (0755). Returns its path. */
export function stub(dir: string, name: string, lines: readonly string[]): string {
  const file = join(dir, name);
  writeFileSync(file, ["#!/bin/sh", ...lines, ""].join("\n"));
  chmodSync(file, 0o755);
  return file;
}
