// The read rule (AD-3): only privacy.ts, ledger-repos.ts and unit-of-work.ts may touch the
// `account`, `transaction` and `audit_log` tables, so every read composes the viewer's SQL
// projection. biome.json bans the imports for lint; this test greps the sources so the rule also
// fails under `pnpm test`, and shows the grep catches a deliberate direct read.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL(".", import.meta.url));
const ALLOWED = new Set(["privacy.ts", "ledger-repos.ts", "unit-of-work.ts"]);

/** An import of one of the three protected schema files, or of the schema barrel. */
const DIRECT_READ =
  /(?:from|import)\s*\(?\s*["'][^"']*\/schema\/(?:account|transaction|audit-log|index)(?:\.[jt]s)?["']|(?:from|import)\s*\(?\s*["'][^"']*\/schema["']/;

function sources(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      // The schema directory defines the tables; it is the one place they are named freely.
      return entry.name === "schema"
        ? []
        : sources(join(dir, entry.name), `${prefix}${entry.name}/`);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [`${prefix}${entry.name}`]
      : [];
  });
}

describe("the read rule", () => {
  it("catches a deliberate direct read of account, transaction or audit_log", () => {
    for (const table of ["account", "transaction", "audit-log"]) {
      expect(DIRECT_READ.test(`import { x } from "./schema/${table}.ts";`)).toBe(true);
      expect(DIRECT_READ.test(`import { x } from "../schema/${table}";`)).toBe(true);
    }
    expect(DIRECT_READ.test('import { x } from "./schema/index.ts";')).toBe(true);
    expect(DIRECT_READ.test('import { x } from "./schema/payee.ts";')).toBe(false);
    expect(DIRECT_READ.test('import { x } from "./schema/account-owner.ts";')).toBe(false);
  });

  it("finds no schema import of those tables outside the three allowed files", () => {
    const offenders = sources(srcDir)
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => DIRECT_READ.test(readFileSync(join(srcDir, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("still sees the allowed files", () => {
    expect(sources(srcDir)).toEqual(expect.arrayContaining([...ALLOWED]));
  });
});
