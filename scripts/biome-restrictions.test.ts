// Guards the `noRestrictedImports` bans in biome.json (AD-5, AD-6, AD-14): `temporal-polyfill` only
// in packages/shared/src/temporal/**, `ulid` only in packages/app/src/ids.ts, and the SystemViewer
// factory (by package specifier or relative path) only in apps/server/src/jobs/**,
// apps/server/src/admin/** and test files.
//
// Biome's `--stdin-file-path` mode only applies fixes and never reports lint diagnostics, so this
// copies the repo's real biome.json into a temp directory, writes probe files at the same
// repo-relative paths there, and lints them. Nothing is written inside the repo.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const biome = join(repoRoot, "node_modules", ".bin", "biome");

// Line 1 imports temporal-polyfill, line 2 imports ulid, line 3 imports the SystemViewer factory by
// package specifier, line 4 imports it by relative path.
const PROBE = [
  'import { Temporal } from "temporal-polyfill";',
  'import { ulid } from "ulid";',
  'import { systemViewer } from "@pangolin/app/system-viewer";',
  'import { systemViewer as relative } from "../system-viewer.ts";',
  "export const probe = [Temporal, ulid, systemViewer, relative];",
  "",
].join("\n");
const SYSTEM_VIEWER = "@pangolin/app/system-viewer";
const SYSTEM_VIEWER_RELATIVE = "../system-viewer.ts";
const LINE_TO_MODULE: Record<number, string> = {
  1: "temporal-polyfill",
  2: "ulid",
  3: SYSTEM_VIEWER,
  4: SYSTEM_VIEWER_RELATIVE,
};
/** Both ways of reaching the SystemViewer factory. */
const SV = [SYSTEM_VIEWER, SYSTEM_VIEWER_RELATIVE] as const;

/** Repo-relative probe path -> modules the lint rule must ban there. */
const CASES: Record<string, readonly string[]> = {
  "packages/domain/src/x.ts": ["temporal-polyfill", "ulid", ...SV],
  "packages/app/src/other.ts": ["temporal-polyfill", "ulid", ...SV],
  "packages/app/src/system/x.ts": ["temporal-polyfill", "ulid", ...SV],
  "packages/app/src/system/x.test.ts": ["temporal-polyfill", "ulid"],
  "packages/app/src/ids.ts": ["temporal-polyfill", ...SV],
  "packages/shared/src/temporal/x.ts": ["ulid", ...SV],
  // The temporal override is listed after the test-file one, so it wins for its own tests.
  "packages/shared/src/temporal/x.test.ts": ["ulid", ...SV],
  "packages/db/src/x.ts": ["temporal-polyfill", "ulid", ...SV],
  "apps/web/src/x.ts": ["temporal-polyfill", "ulid", ...SV],
  "e2e/x.ts": ["temporal-polyfill", "ulid", ...SV],
  "scripts/x.ts": ["temporal-polyfill", "ulid", ...SV],
  "apps/server/src/x.ts": ["temporal-polyfill", "ulid", ...SV],
  "apps/server/src/http/x.ts": ["temporal-polyfill", "ulid", ...SV],
  "apps/server/src/http/nested/x.ts": ["temporal-polyfill", "ulid", ...SV],
  "apps/server/src/jobs/x.ts": ["temporal-polyfill", "ulid"],
  "apps/server/src/jobs/nested/x.ts": ["temporal-polyfill", "ulid"],
  "apps/server/src/admin/x.ts": ["temporal-polyfill", "ulid"],
  "apps/server/src/admin/nested/x.ts": ["temporal-polyfill", "ulid"],
};

interface Diagnostic {
  readonly category: string;
  readonly location: { readonly path: string; readonly start: { readonly line: number } };
}

let banned: Map<string, Set<string>>;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "biome-restrictions-"));
  copyFileSync(join(repoRoot, "biome.json"), join(dir, "biome.json"));
  for (const path of Object.keys(CASES)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), PROBE);
  }
  const result = spawnSync(
    biome,
    [
      "lint",
      "--vcs-enabled=false",
      "--only=style/noRestrictedImports",
      "--reporter=json",
      ...Object.keys(CASES),
    ],
    { cwd: dir, encoding: "utf8" },
  );
  const json = result.stdout.slice(result.stdout.indexOf("{"));
  const { diagnostics } = JSON.parse(json) as { diagnostics: Diagnostic[] };
  banned = new Map(Object.keys(CASES).map((path) => [path, new Set<string>()]));
  for (const diagnostic of diagnostics) {
    expect(diagnostic.category).toBe("lint/style/noRestrictedImports");
    const module = LINE_TO_MODULE[diagnostic.location.start.line];
    banned.get(diagnostic.location.path.replaceAll("\\", "/"))?.add(module ?? "?");
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("biome noRestrictedImports", () => {
  it.each(Object.entries(CASES))("%s bans exactly %j", (path, expected) => {
    expect([...(banned.get(path) ?? [])].sort()).toEqual([...expected].sort());
  });
});
