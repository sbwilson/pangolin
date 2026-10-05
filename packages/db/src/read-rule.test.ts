// The read rule (AD-3): only privacy.ts, ledger-repos.ts and unit-of-work.ts may import the schema
// of a scoped table (`account`, `account_owner`, `transaction`, `split`, `split_tag`,
// `balance_snapshot`, `review_item`, `transfer_group`, `audit_log`), so every read composes the
// viewer's SQL projection. Two repositories are excepted because they apply a viewer filter of
// their own. biome.json bans the imports for lint; this test greps the sources so the rule also
// fails under `pnpm test`, and shows the grep catches a deliberate direct read. Raw SQL that names
// these tables is `raw-sql-read-rule.test.ts`; a repository method without a viewer is
// `packages/app/src/ports/tx-repos-viewer.test.ts`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL(".", import.meta.url));

/** The schema file of every scoped table. */
const SCOPED = [
  "account",
  "account-owner",
  "transaction",
  "split",
  "split-tag",
  "balance-snapshot",
  "review-item",
  "transfer-group",
  "audit-log",
] as const;

/**
 * The files that may import a scoped table's schema (mirrors biome.json), each with the tables it
 * may import and its reason. A file importing a table outside its list fails, so an exemption
 * cannot widen quietly.
 */
const ALLOWED: Readonly<Record<string, { tables: readonly string[]; reason: string }>> = {
  "privacy.ts": {
    tables: SCOPED,
    reason: "defines the viewer's SQL projections (visibleAccounts, visibleTxn, visibleAudit)",
  },
  "ledger-repos.ts": {
    tables: SCOPED,
    reason: "the ledger repositories, every read composed with the viewer's projection",
  },
  "unit-of-work.ts": {
    tables: SCOPED,
    reason: "the audit repository and the unit of work that hand out the repositories",
  },
  "classify-repos.ts": {
    tables: ["split", "split-tag"],
    reason:
      "reads split and split_tag through visibleTxnId(viewer) or under the tag's own scope filter",
  },
  "review-item-repo.ts": {
    tables: ["review-item"],
    reason: "reads review_item for a viewer only through visibleReviewItems(viewer)",
  },
};

/**
 * An import, re-export, dynamic import or require of a scoped schema file or of the schema barrel
 * (captured as `index`, which no file may use).
 */
const IMPORT = new RegExp(
  String.raw`(?:from|import|require)\s*\(?\s*["'][^"']*/schema(?:/(${SCOPED.join("|")}|index))?(?:\.[jt]s)?["']`,
  "g",
);

/** The scoped tables (or `index`) a source text imports. */
const importedTables = (text: string): string[] => [
  ...new Set([...text.matchAll(IMPORT)].map((m) => m[1] ?? "index")),
];

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

/** Each `file: table` among `files` (name -> text) that imports a table it is not allowed to. */
const offendersIn = (files: Readonly<Record<string, string>>): string[] =>
  Object.entries(files).flatMap(([file, text]) =>
    importedTables(text)
      .filter((table) => !(ALLOWED[file]?.tables ?? []).includes(table))
      .map((table) => `${file}: ${table}`),
  );

describe("the read rule", () => {
  it("catches a deliberate direct read of every scoped table, in every import form", () => {
    for (const table of SCOPED) {
      expect(importedTables(`import { x } from "./schema/${table}.ts";`), table).toEqual([table]);
      expect(importedTables(`import { x } from "../schema/${table}";`), table).toEqual([table]);
      expect(importedTables(`const x = require("../schema/${table}");`), table).toEqual([table]);
      expect(importedTables(`const x = await import("./schema/${table}.ts");`), table).toEqual([
        table,
      ]);
    }
    expect(importedTables('import { x } from "./schema/index.ts";')).toEqual(["index"]);
    expect(importedTables('import { x } from "./schema";')).toEqual(["index"]);
    expect(importedTables('import { x } from "./schema/payee.ts";')).toEqual([]);
    expect(importedTables('import { x } from "./schema/split-tag-extra.ts";')).toEqual([]);
  });

  it("finds no schema import of a scoped table outside what each file may import", () => {
    const files = Object.fromEntries(
      sources(srcDir).map((file) => [file, readFileSync(join(srcDir, file), "utf8")]),
    );
    expect(offendersIn(files)).toEqual([]);
  });

  it("fails on a planted import, in a file that is not allowed and beyond an allowed file's tables", () => {
    const planted = 'import { split } from "./schema/split.ts";\n';
    const other = 'import { account } from "./schema/account.ts";\n';
    expect(
      offendersIn({
        "planted-repo.ts": planted,
        "ledger-repos.ts": planted,
        "classify-repos.ts": `${planted}${other}`,
        "review-item-repo.ts": 'const r = require("./schema/transfer-group.ts");\n',
      }),
    ).toEqual([
      "planted-repo.ts: split",
      "classify-repos.ts: account",
      "review-item-repo.ts: transfer-group",
    ]);
  });

  it("gives every allowed file a reason, and still sees each of them", () => {
    for (const [file, { reason }] of Object.entries(ALLOWED)) {
      expect(reason.trim(), file).not.toBe("");
    }
    expect(sources(srcDir)).toEqual(expect.arrayContaining(Object.keys(ALLOWED)));
  });

  it("lets only an allowed file import a scoped table, and each one does", () => {
    // An allow-list entry that no longer imports one is stale: drop it.
    const importers = sources(srcDir).filter(
      (file) => importedTables(readFileSync(join(srcDir, file), "utf8")).length > 0,
    );
    expect(importers.sort()).toEqual(Object.keys(ALLOWED).sort());
  });
});
