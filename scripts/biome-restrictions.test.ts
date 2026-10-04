// Guards the `noRestrictedImports` bans in biome.json (AD-5, AD-6, AD-14): `temporal-polyfill` only
// in packages/shared/src/temporal/**, `ulid` only in packages/app/src/ids.ts, and the SystemViewer
// factory (by package specifier or relative path) only in apps/server/src/jobs/**,
// apps/server/src/admin/** and test files. The read rule (AD-3) is a plugin, checked below.
//
// Biome's `--stdin-file-path` mode only applies fixes and never reports lint diagnostics, so this
// copies the repo's real biome.json into a temp directory, writes probe files at the same
// repo-relative paths there, and lints them. Nothing is written inside the repo.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const biome = join(repoRoot, "node_modules", ".bin", "biome");
const CLOCK_PLUGIN = join(repoRoot, "tools", "lint", "no-system-clock.grit");
const READ_PLUGIN = join(repoRoot, "tools", "lint", "no-ledger-schema-read.grit");

/** Copies the repo's biome.json and its plugins into `to`. */
function copyConfig(to: string): void {
  copyFileSync(join(repoRoot, "biome.json"), join(to, "biome.json"));
  mkdirSync(join(to, "tools", "lint"), { recursive: true });
  for (const plugin of [CLOCK_PLUGIN, READ_PLUGIN]) {
    copyFileSync(plugin, join(to, "tools", "lint", basename(plugin)));
  }
}

// Line 1 imports temporal-polyfill, line 2 imports ulid, line 3 imports the SystemViewer factory by
// package specifier, line 4 imports it by relative path, lines 5 to 8 import the `account`,
// `transaction` and `audit-log` schema files (the read rule, AD-3) by the forms it must catch.
const PROBE = [
  'import { Temporal } from "temporal-polyfill";',
  'import { ulid } from "ulid";',
  'import { systemViewer } from "@pangolin/app/system-viewer";',
  'import { systemViewer as relative } from "../system-viewer.ts";',
  'import { account } from "../schema/account.ts";',
  'import { transaction } from "../schema/transaction";',
  'import { auditLog } from "../schema/audit-log.ts";',
  'import "../schema/account.js";',
  'import { payee } from "../schema/payee.ts";',
  "export const probe = [Temporal, ulid, systemViewer, relative, account, transaction, auditLog, payee];",
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
  8: "schema/account (side effect)",
};
/** Both ways of reaching the SystemViewer factory. */
const SV = [SYSTEM_VIEWER, SYSTEM_VIEWER_RELATIVE] as const;
/** The three schema files only the privacy path may import (the read-rule plugin). */
const DB = [
  "schema/account",
  "schema/transaction",
  "schema/audit-log",
  "schema/account (side effect)",
] as const;

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
  // The privacy path may read the tables; everything else in it stays banned.
  "packages/db/src/privacy.ts": ["temporal-polyfill", "ulid", ...SV],
  "packages/db/src/ledger-repos.ts": ["temporal-polyfill", "ulid", ...SV],
  "packages/db/src/unit-of-work.ts": ["temporal-polyfill", "ulid", ...SV],
  "packages/db/src/ledger-repos.test.ts": ["temporal-polyfill", "ulid"],
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

/** Repo-relative probe path -> schema modules the read-rule plugin must ban there. */
const READ_CASES: Record<string, readonly string[]> = {
  "packages/domain/src/x.ts": DB,
  "packages/app/src/other.ts": DB,
  "packages/app/src/ids.ts": DB,
  "packages/shared/src/temporal/x.ts": DB,
  "packages/db/src/x.ts": DB,
  "packages/db/src/nested/x.ts": DB,
  "apps/web/src/x.ts": DB,
  "apps/server/src/http/x.ts": DB,
  "apps/server/src/jobs/x.ts": DB,
  "apps/server/src/admin/x.ts": DB,
  // The privacy path may read the tables, and tests may do anything the lint allows them.
  "packages/db/src/privacy.ts": [],
  "packages/db/src/ledger-repos.ts": [],
  "packages/db/src/unit-of-work.ts": [],
  "packages/db/src/ledger-repos.test.ts": [],
  "packages/app/src/system/x.test.ts": [],
};

interface Diagnostic {
  readonly category: string;
  readonly location: { readonly path: string; readonly start: { readonly line: number } };
}

let banned: Map<string, Set<string>>;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "biome-restrictions-"));
  copyConfig(dir);
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
      copyConfig(root);
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

// AD-3: account, transaction and audit_log are read only through privacy.ts, ledger-repos.ts and
// unit-of-work.ts. A plugin states the rule once; this proves where it applies.
describe("biome read rule", () => {
  let found: Map<string, Set<string>>;

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), "biome-read-rule-"));
    try {
      copyConfig(root);
      for (const path of Object.keys(READ_CASES)) {
        mkdirSync(join(root, dirname(path)), { recursive: true });
        writeFileSync(join(root, path), PROBE);
      }
      const result = spawnSync(
        biome,
        ["lint", "--vcs-enabled=false", "--reporter=json", ...Object.keys(READ_CASES)],
        { cwd: root, encoding: "utf8" },
      );
      const json = result.stdout.slice(result.stdout.indexOf("{"));
      const { diagnostics } = JSON.parse(json) as {
        diagnostics: (Diagnostic & { message: string })[];
      };
      found = new Map(Object.keys(READ_CASES).map((path) => [path, new Set<string>()]));
      for (const d of diagnostics) {
        if (d.category === "plugin" && d.message.includes("AD-3")) {
          const module = LINE_TO_MODULE[d.location.start.line];
          found.get(d.location.path.replaceAll("\\", "/"))?.add(module ?? "?");
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(Object.entries(READ_CASES))("%s flags exactly %j", (path, expected) => {
    expect([...(found.get(path) ?? [])].sort()).toEqual([...expected].sort());
  });
});
