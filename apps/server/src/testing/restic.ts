// Test support: a stub restic (stub-restic.mjs) behind an executable wrapper, a password file and
// a repository directory, all under `dir`.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BackupConfig } from "../config.ts";

export const STUB_RESTIC = fileURLToPath(new URL("./stub-restic.mjs", import.meta.url));

export interface StubRestic {
  readonly bin: string;
  readonly repository: string;
  /** The repository's directory. */
  readonly repoDir: string;
  readonly passwordFile: string;
  readonly config: BackupConfig;
}

export function stubRestic(dir: string): StubRestic {
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, "restic");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${STUB_RESTIC}" "$@"\n`);
  chmodSync(bin, 0o755);
  const passwordFile = join(dir, "restic-password");
  writeFileSync(passwordFile, "correct horse restic\n", { mode: 0o400 });
  const repoDir = join(dir, "repo");
  const repository = `stub:${repoDir}`;
  return {
    bin,
    repository,
    repoDir,
    passwordFile,
    config: { repository, passwordFile, resticBin: bin },
  };
}
