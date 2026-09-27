import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALLOWED, checkBoundaries, findImports, stripComments } from "./check-boundaries.ts";

describe("findImports", () => {
  it("finds every import form and marks type-only ones", () => {
    const source = [
      'import a from "a";',
      'import { b, type c } from "b";',
      'import type { D } from "d";',
      'export * from "e";',
      'export type { F } from "f";',
      'import "g";',
      'const h = await import("h");',
      'const i = require("i");',
      "import {",
      "  j,",
      '} from "j";',
      'import type from "k";',
    ].join("\n");
    expect(findImports(source)).toEqual([
      { specifier: "a", typeOnly: false, line: 1 },
      { specifier: "b", typeOnly: false, line: 2 },
      { specifier: "d", typeOnly: true, line: 3 },
      { specifier: "e", typeOnly: false, line: 4 },
      { specifier: "f", typeOnly: true, line: 5 },
      { specifier: "g", typeOnly: false, line: 6 },
      { specifier: "h", typeOnly: false, line: 7 },
      { specifier: "i", typeOnly: false, line: 8 },
      { specifier: "j", typeOnly: false, line: 9 },
      { specifier: "k", typeOnly: false, line: 12 },
    ]);
  });

  it("ignores imports in comments but not // inside strings", () => {
    const source = [
      '// import x from "commented";',
      '/* import y from "block";',
      '*/ const url = "http://example.com"; import z from "z";',
    ].join("\n");
    expect(stripComments(source)).toContain('"http://example.com"');
    expect(findImports(source)).toEqual([{ specifier: "z", typeOnly: false, line: 3 }]);
  });
});

describe("checkBoundaries", () => {
  let root: string;

  function write(path: string, content: string): void {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  function pkg(dir: string, deps: Record<string, string> = {}): void {
    const name = `@pangolin/${dir.split("/").at(-1)}`;
    write(`${dir}/package.json`, JSON.stringify({ name, dependencies: deps }));
    write(`${dir}/src/index.ts`, "export {};\n");
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pangolin-boundaries-"));
    for (const dir of Object.keys(ALLOWED)) pkg(dir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts every allowed arrow", () => {
    write("packages/app/src/x.ts", 'import "@pangolin/domain";\nimport "@pangolin/shared";\n');
    write("packages/db/src/x.ts", 'import { a } from "@pangolin/app";\n');
    write("apps/server/src/x.ts", 'import { a } from "@pangolin/db";\n');
    write("apps/web/src/x.ts", 'import type { AppType } from "@pangolin/server";\n');
    write("apps/web/src/y.ts", 'import { z } from "@pangolin/shared/period";\n');
    expect(checkBoundaries(root)).toEqual([]);
  });

  it("rejects domain importing db, naming the file and rule", () => {
    write("packages/domain/src/bad.ts", '\nimport { openDatabase } from "@pangolin/db";\n');
    expect(checkBoundaries(root)).toEqual([
      {
        file: "packages/domain/src/bad.ts",
        line: 2,
        rule: "boundaries/packages-domain",
        message: 'packages/domain may not import packages/db ("@pangolin/db")',
      },
    ]);
  });

  it("rejects a value import from web to server, and a mixed inline-type import", () => {
    write("apps/web/src/a.ts", 'import { createApp } from "@pangolin/server";\n');
    write("apps/web/src/b.ts", 'import { type AppType } from "@pangolin/server";\n');
    const found = checkBoundaries(root).map((v) => [v.file, v.message]);
    expect(found).toEqual([
      [
        "apps/web/src/a.ts",
        'apps/web may import apps/server only with "import type" ("@pangolin/server")',
      ],
      [
        "apps/web/src/b.ts",
        'apps/web may import apps/server only with "import type" ("@pangolin/server")',
      ],
    ]);
  });

  it("rejects adapters importing each other and app importing adapters", () => {
    write("packages/db/src/x.ts", 'export * from "@pangolin/llm";\n');
    write("packages/app/src/x.ts", 'const m = await import("@pangolin/db");\n');
    expect(checkBoundaries(root).map((v) => v.file)).toEqual([
      "packages/app/src/x.ts",
      "packages/db/src/x.ts",
    ]);
  });

  it("rejects a relative path into another package", () => {
    write("packages/shared/src/x.ts", 'import "../../domain/src/index.ts";\n');
    expect(checkBoundaries(root).map((v) => v.message)).toEqual([
      'packages/shared may not import packages/domain ("../../domain/src/index.ts")',
    ]);
  });

  it("rejects a workspace dependency declared against the graph", () => {
    pkg("packages/domain", { "@pangolin/db": "workspace:*" });
    expect(checkBoundaries(root).map((v) => v.message)).toEqual([
      "@pangolin/domain declares @pangolin/db in dependencies, but packages/domain may not import packages/db",
    ]);
  });

  it("rejects an e2e import of a workspace package", () => {
    write("e2e/health.spec.ts", 'import { openDatabase } from "@pangolin/db";\n');
    expect(checkBoundaries(root)).toEqual([
      {
        file: "e2e/health.spec.ts",
        line: 1,
        rule: "boundaries/e2e",
        message: 'e2e may not import packages/db ("@pangolin/db")',
      },
    ]);
  });

  it("rejects a package missing from the map", () => {
    pkg("packages/extra");
    expect(checkBoundaries(root).map((v) => v.rule)).toEqual(["boundaries/unknown-package"]);
  });
});
