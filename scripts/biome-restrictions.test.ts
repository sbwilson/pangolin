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
const CLOCK_PLUGIN = join(repoRoot, "tools", "lint", "no-system-clock.grit");

// Line 1 imports temporal-polyfill, line 2 imports ulid, line 3 imports the SystemViewer factory by
// package specifier, line 4 imports it by relative path, lines 5 to 7 import the `account`,
// `transaction` and `audit-log` schema files (the read rule, AD-3).
const PROBE = [
  'import { Temporal } from "temporal-polyfill";',
  'import { ulid } from "ulid";',
  'import { systemViewer } from "@pangolin/app/system-viewer";',
  'import { systemViewer as relative } from "../system-viewer.ts";',
  'import { account } from "../schema/account.ts";',
  'import { transaction } from "../schema/transaction";',
  'import { auditLog } from "../schema/audit-log.ts";',
  "export const probe = [Temporal, ulid, systemViewer, relative, account, transaction, auditLog];",
  "",
].join("\n");
const SYSTEM_VIEWER = "@pangolin/app/system-viewer";
const SYSTEM_VIEWER_RELATIVE = "../system-viewer.ts";
const LINE_TO_MODULE: Record<number, string> = {
  1: "temporal-polyfill",
  2: "ulid",
  3: SYSTEM_VIEWER,
  4: SYSTEM_VIEWER_RELATIVE,
  5: "schema/account",
  6: "schema/transaction",
  7: "schema/audit-log",
};
/** Both ways of reaching the SystemViewer factory. */
const SV = [SYSTEM_VIEWER, SYSTEM_VIEWER_RELATIVE] as const;
/** The three schema files only the privacy path may import. */
const DB = ["schema/account", "schema/transaction", "schema/audit-log"] as const;

/** Repo-relative probe path -> modules the lint rule must ban there. */
const CASES: Record<string, readonly string[]> = {
  "packages/domain/src/x.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  "packages/app/src/other.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  "packages/app/src/system/x.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  "packages/app/src/system/x.test.ts": ["temporal-polyfill", "ulid"],
  "packages/app/src/ids.ts": ["temporal-polyfill", ...SV, ...DB],
  "packages/shared/src/temporal/x.ts": ["ulid", ...SV, ...DB],
  // The temporal override is listed after the test-file one, so it wins for its own tests.
  "packages/shared/src/temporal/x.test.ts": ["ulid", ...SV, ...DB],
  "packages/db/src/x.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  // The privacy path may read the tables; everything else in it stays banned.
  "packages/db/src/privacy.ts": ["temporal-polyfill", "ulid", ...SV],
  "packages/db/src/ledger-repos.ts": ["temporal-polyfill", "ulid", ...SV],
  "packages/db/src/unit-of-work.ts": ["temporal-polyfill", "ulid", ...SV],
  "packages/db/src/ledger-repos.test.ts": ["temporal-polyfill", "ulid"],
  "apps/web/src/x.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  "e2e/x.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  "scripts/x.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  "apps/server/src/x.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  "apps/server/src/http/x.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  "apps/server/src/http/nested/x.ts": ["temporal-polyfill", "ulid", ...SV, ...DB],
  "apps/server/src/jobs/x.ts": ["temporal-polyfill", "ulid", ...DB],
  "apps/server/src/jobs/nested/x.ts": ["temporal-polyfill", "ulid", ...DB],
  "apps/server/src/admin/x.ts": ["temporal-polyfill", "ulid", ...DB],
  "apps/server/src/admin/nested/x.ts": ["temporal-polyfill", "ulid", ...DB],
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
  mkdirSync(join(dir, "tools", "lint"), { recursive: true });
  copyFileSync(CLOCK_PLUGIN, join(dir, "tools", "lint", "no-system-clock.grit"));
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

// AD-14: no system-clock reads in the pure packages, which take a Clock from their caller.
describe("biome system-clock ban", () => {
  const CLOCK_PROBE = [
    "export const a = Date.now();",
    "export const b = new Date();",
    "export const c = new Date(0);",
    "export const d = Temporal.Now.instant();",
    "",
  ].join("\n");
  const PATHS: Record<string, number> = {
    "packages/domain/src/clock.ts": 4,
    "packages/shared/src/period/clock.ts": 4,
    "packages/domain/src/clock.test.ts": 0,
    "packages/app/src/clock.ts": 0,
    "apps/server/src/clock.ts": 0,
  };
  let hits: Map<string, string[]>;

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), "biome-clock-"));
    try {
      copyFileSync(join(repoRoot, "biome.json"), join(root, "biome.json"));
      mkdirSync(join(root, "tools", "lint"), { recursive: true });
      copyFileSync(CLOCK_PLUGIN, join(root, "tools", "lint", "no-system-clock.grit"));
      for (const path of Object.keys(PATHS)) {
        mkdirSync(join(root, dirname(path)), { recursive: true });
        writeFileSync(join(root, path), CLOCK_PROBE);
      }
      const result = spawnSync(
        biome,
        ["lint", "--vcs-enabled=false", "--reporter=json", ...Object.keys(PATHS)],
        { cwd: root, encoding: "utf8" },
      );
      const json = result.stdout.slice(result.stdout.indexOf("{"));
      const { diagnostics } = JSON.parse(json) as {
        diagnostics: (Diagnostic & { message: string })[];
      };
      hits = new Map(Object.keys(PATHS).map((path) => [path, []]));
      for (const d of diagnostics) {
        if (d.message.includes("AD-14")) {
          hits.get(d.location.path.replaceAll("\\", "/"))?.push(d.message);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(Object.entries(PATHS))("%s has %i clock reads flagged, citing AD-14", (path, count) => {
    expect(hits.get(path)).toHaveLength(count);
  });
});
