// The read rule for raw SQL (AD-3): the schema-import rule (`read-rule.test.ts`, biome.json) cannot
// see SQL written as text, so this test scans every non-test source file in the repository for SQL
// that names a scoped table (`account`, `account_owner`, `transaction`, `split`, `split_tag`,
// `balance_snapshot`, `review_item`, `transfer_group`, `audit_log`) after FROM, JOIN, INTO, UPDATE,
// TABLE or REFERENCES. A file outside the allow-list below fails the test with its path and line.
//
// The viewerless `upkeepMembers` read (decision 81) is drizzle, not text, so this scan does not
// see it; it is allow-listed in `packages/app/src/ports/tx-repos-viewer.test.ts` instead.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Source files that may name a scoped table in raw SQL, each with its reason. */
const ALLOWED: Readonly<Record<string, string>> = {
  "packages/db/src/balance.ts":
    "the one balance definition (AD-19), applied to an account the caller already decided to read",
  "packages/db/src/manifest.ts":
    "the backup manifest counts and sums every account as the system (AD-19 as amended)",
  "apps/server/src/privacy/privacy-harness.ts":
    "test support: the privacy suite reads the tables raw to find A's private ids and to dump them",
};

const TABLES = [
  "account",
  "account_owner",
  "transaction",
  "split",
  "split_tag",
  "balance_snapshot",
  "review_item",
  "transfer_group",
  "audit_log",
];

/**
 * A scoped table after an SQL keyword, bare or quoted, in any case, optionally schema-qualified
 * (`main.account`, `"main"."account"`). `\s+` spans newlines, so a keyword at the end of one line
 * and the table on the next is a read too.
 */
const SQL_READ = new RegExp(
  String.raw`\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)\s+(?:["\x60\[]?\w+["\x60\]]?\s*\.\s*)?["\x60\[]?(?:${TABLES.join("|")})["\x60\]]?(?![\w-])`,
  "gi",
);

/** Directories skipped by name wherever they are. */
const SKIP_NAMES = new Set([
  "node_modules",
  "dist",
  "dev-dist",
  "playwright-report",
  "test-results",
  ".git",
]);
/** Directories skipped by repository path only: the table definitions and the generated SQL. */
const SKIP_PATHS = new Set(["packages/db/src/schema", "packages/db/migrations"]);
const TOP = ["apps", "packages", "tools", "scripts", "e2e", "deploy"];

function sources(dir: string, prefix: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP_NAMES.has(entry.name) || SKIP_PATHS.has(`${prefix}${entry.name}`)
        ? []
        : sources(join(dir, entry.name), `${prefix}${entry.name}/`);
    }
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)
      ? [`${prefix}${entry.name}`]
      : [];
  });
}

/**
 * `path:line` (of the keyword) of each place `text` names a scoped table in SQL, over the whole
 * text so a read split across lines is found. Whole-line comments are blanked first, keeping
 * every offset.
 */
function sqlReads(path: string, text: string): string[] {
  const code = text.replace(/^[ \t]*(?:\/\/|\/\*|\*).*$/gm, (line) => " ".repeat(line.length));
  return [...code.matchAll(SQL_READ)].map(
    (m) => `${path}:${code.slice(0, m.index).split("\n").length}`,
  );
}

/** Every read found in `files` (path -> text) outside the allow-list. */
const offendersIn = (files: Readonly<Record<string, string>>): string[] =>
  Object.entries(files)
    .filter(([path]) => !(path in ALLOWED))
    .flatMap(([path, text]) => sqlReads(path, text));

function repositorySources(): Record<string, string> {
  const paths = TOP.flatMap((top) => {
    try {
      return sources(join(repoRoot, top), `${top}/`);
    } catch {
      return [];
    }
  });
  return Object.fromEntries(
    paths.map((path) => [path, readFileSync(join(repoRoot, path), "utf8")]),
  );
}

describe("the read rule for raw SQL", () => {
  it("catches SQL that names a scoped table, quoted or not, in any case", () => {
    for (const table of TABLES) {
      expect(sqlReads("x.ts", `db.prepare("SELECT 1 FROM ${table}")`), table).toHaveLength(1);
      expect(sqlReads("x.ts", `db.prepare('select 1 from "${table}" t')`), table).toHaveLength(1);
      expect(sqlReads("x.ts", `sql\`JOIN ${table} o ON o.id = 1\``), table).toHaveLength(1);
    }
    expect(sqlReads("x.ts", 'db.prepare("UPDATE account SET name = 1")')).toHaveLength(1);
    expect(sqlReads("x.ts", 'db.prepare("INSERT INTO audit_log VALUES (1)")')).toHaveLength(1);
    // A keyword at the end of a line, and a schema-qualified table, are reads too.
    expect(sqlReads("x.ts", "const q = `SELECT 1 FROM\n  account`;")).toEqual(["x.ts:1"]);
    expect(sqlReads("x.ts", "a\nconst q = `SELECT 1\n  FROM main.account a`;")).toEqual(["x.ts:3"]);
    expect(sqlReads("x.ts", 'db.prepare(\'SELECT 1 FROM "main"."transaction"\')')).toHaveLength(1);
    expect(sqlReads("x.ts", "db.prepare('UPDATE main . audit_log SET a = 1')")).toHaveLength(1);
    // Other tables, longer names and prose are not reads.
    expect(sqlReads("x.ts", 'db.prepare("SELECT 1 FROM payee")')).toEqual([]);
    expect(sqlReads("x.ts", 'db.prepare("SELECT 1 FROM account_summary")')).toEqual([]);
    expect(sqlReads("x.ts", "// the totals come from\n// account balances")).toEqual([]);
    expect(sqlReads("x.ts", 'db.prepare("SELECT 1 FROM main.payee")')).toEqual([]);
  });

  it("finds no raw SQL on a scoped table outside the allow-list", () => {
    const files = repositorySources();
    // It really looked: the privacy path and the allowed files are all in the scan.
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([...Object.keys(ALLOWED), "packages/db/src/privacy.ts"]),
    );
    expect(offendersIn(files)).toEqual([]);
  });

  it("fails naming the file and line of a planted read", () => {
    const planted =
      'const a = 1;\nexport const rows = db.prepare("SELECT * FROM transaction").all();\n';
    expect(
      offendersIn({
        "apps/server/src/leak.ts": planted,
        "packages/db/src/manifest.ts": planted,
      }),
    ).toEqual(["apps/server/src/leak.ts:2"]);
  });

  it("gives every allowed file a reason, and each one still reads a scoped table", () => {
    const files = repositorySources();
    for (const [path, reason] of Object.entries(ALLOWED)) {
      expect(reason.trim(), path).not.toBe("");
      // A stale entry would let a future read through unnoticed.
      expect(sqlReads(path, files[path] ?? ""), path).not.toEqual([]);
    }
  });
});
