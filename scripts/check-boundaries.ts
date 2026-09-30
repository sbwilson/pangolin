// Enforces the package graph from the architecture spine (Invariants diagram).
// Arrows point from a package to what it may import; anything not listed is forbidden.
//
// Scans every static import, `export ... from`, side-effect import, dynamic import() and
// require() in apps/, packages/, tools/ and e2e/, plus each package.json's workspace dependencies.
// Usage: node scripts/check-boundaries.ts [repo-root]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface Rule {
  /** Workspace packages this one may import at runtime or as types. */
  readonly allow: readonly string[];
  /** Workspace packages this one may import only with `import type` / `export type`. */
  readonly typeOnly?: readonly string[];
}

const ADAPTER: Rule = { allow: ["packages/app", "packages/shared"] };

/** The spine's graph, keyed by package directory. Add an arrow here only when the spine draws it. */
export const ALLOWED: Readonly<Record<string, Rule>> = {
  "packages/shared": { allow: [] },
  "packages/domain": { allow: ["packages/shared"] },
  "packages/app": { allow: ["packages/domain", "packages/shared"] },
  "packages/db": ADAPTER,
  "packages/importers": ADAPTER,
  "packages/connectors": ADAPTER,
  "packages/llm": ADAPTER,
  "apps/server": {
    allow: [
      "packages/app",
      "packages/db",
      "packages/importers",
      "packages/connectors",
      "packages/llm",
    ],
  },
  "apps/web": { allow: ["packages/shared"], typeOnly: ["apps/server"] },
  // The mock servers replay fixture files and may import no workspace package.
  "tools/mock-llm": { allow: [] },
  "tools/mock-prices": { allow: [] },
  // tools/seed → shared (story 1.4, AD-15), drawn in the spine's Invariants diagram. The seed is
  // data: the server applies it without importing it.
  "tools/seed": { allow: ["packages/shared"] },
  // End-to-end tests drive the running container over HTTP; they import no workspace package.
  e2e: { allow: [] },
};

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

export interface ImportRef {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly line: number;
}

/** Directories whose subdirectories are packages. */
const SCANNED_ROOTS = ["apps", "packages", "tools"];
/** Packages that sit directly at the repo root. */
const ROOT_PACKAGES = ["e2e"];
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "dev-dist",
  "coverage",
  "migrations",
  "playwright-report",
  "test-results",
]);

/**
 * Blanks out comments (keeping newlines, so line numbers hold) and leaves string
 * literals intact, so commented-out imports are ignored and `//` inside a string is not.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          out += source[i];
          i++;
        }
        out += source[i] ?? "";
        i++;
      }
      out += source[i] ?? "";
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const PATTERNS: readonly {
  readonly re: RegExp;
  readonly typeGroup?: number;
  readonly spec: number;
}[] = [
  // import x from "y"; import { a } from "y"; import type { a } from "y"; export * from "y"; export type { a } from "y"
  {
    re: /\b(?:import|export)\s+(type\s+(?!from\b))?[\w*$\s,{}]*?\s*from\s*(["'])([^"']+)\2/g,
    typeGroup: 1,
    spec: 3,
  },
  // import "y"
  { re: /\bimport\s*(["'])([^"']+)\1/g, spec: 2 },
  // import("y"), require("y")
  { re: /\b(?:import|require)\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g, spec: 2 },
];

export function findImports(source: string): ImportRef[] {
  const code = stripComments(source);
  const refs: ImportRef[] = [];
  for (const { re, typeGroup, spec } of PATTERNS) {
    for (const match of code.matchAll(re)) {
      const specifier = match[spec];
      if (specifier === undefined) continue;
      const typeOnly = typeGroup !== undefined && match[typeGroup] !== undefined;
      const line = code.slice(0, match.index).split("\n").length;
      refs.push({ specifier, typeOnly, line });
    }
  }
  return refs.sort((a, b) => a.line - b.line);
}

interface Workspace {
  readonly root: string;
  /** Package directory (relative, `/`-separated) → package name. */
  readonly dirs: ReadonlyMap<string, string>;
  /** Package name → package directory. */
  readonly names: ReadonlyMap<string, string>;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function loadWorkspace(root: string): Workspace {
  const dirs = new Map<string, string>();
  const names = new Map<string, string>();
  for (const top of SCANNED_ROOTS) {
    const topDir = join(root, top);
    if (!existsSync(topDir)) continue;
    for (const entry of readdirSync(topDir).sort()) {
      const manifest = join(topDir, entry, "package.json");
      if (!existsSync(manifest)) continue;
      const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name: string };
      const dir = `${top}/${entry}`;
      dirs.set(dir, name);
      names.set(name, dir);
    }
  }
  for (const dir of ROOT_PACKAGES) {
    const manifest = join(root, dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name: string };
    dirs.set(dir, name);
    names.set(name, dir);
  }
  return { root, dirs, names };
}

function owningPackage(ws: Workspace, absPath: string): string | undefined {
  const rel = toPosix(relative(ws.root, absPath));
  for (const dir of ws.dirs.keys()) {
    if (rel === dir || rel.startsWith(`${dir}/`)) return dir;
  }
  return undefined;
}

function packageOfName(ws: Workspace, specifier: string): string | undefined {
  for (const [name, dir] of ws.names) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return dir;
  }
  return undefined;
}

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) listSources(path, out);
    else if (SOURCE_EXT.test(entry) && !entry.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

function ruleFor(from: string): Rule {
  return ALLOWED[from] ?? { allow: [] };
}

/** Why `from` may not import `to` this way, or undefined when it may. */
function verdict(from: string, to: string, typeOnly: boolean): string | undefined {
  if (from === to) return undefined;
  const rule = ruleFor(from);
  if (rule.allow.includes(to)) return undefined;
  if (rule.typeOnly?.includes(to)) {
    return typeOnly ? undefined : `${from} may import ${to} only with "import type"`;
  }
  return `${from} may not import ${to}`;
}

export function checkBoundaries(root: string): Violation[] {
  const ws = loadWorkspace(root);
  const violations: Violation[] = [];

  for (const dir of ws.dirs.keys()) {
    if (ALLOWED[dir] === undefined) {
      violations.push({
        file: `${dir}/package.json`,
        line: 1,
        rule: "boundaries/unknown-package",
        message: `${dir} is not in the allowed map in scripts/check-boundaries.ts`,
      });
    }
  }

  for (const [dir, name] of ws.dirs) {
    const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const dep of Object.keys(manifest[field] ?? {})) {
        const target = ws.names.get(dep);
        if (target === undefined || target === dir) continue;
        const rule = ruleFor(dir);
        const allowed = rule.allow.includes(target) || rule.typeOnly?.includes(target) === true;
        if (!allowed) {
          violations.push({
            file: `${dir}/package.json`,
            line: 1,
            rule: `boundaries/${dir.replace("/", "-")}`,
            message: `${name} declares ${dep} in ${field}, but ${dir} may not import ${target}`,
          });
        }
      }
    }
  }

  for (const top of [...SCANNED_ROOTS, ...ROOT_PACKAGES]) {
    const topDir = join(root, top);
    if (!existsSync(topDir)) continue;
    for (const file of listSources(topDir)) {
      const from = owningPackage(ws, file);
      const relFile = toPosix(relative(root, file));
      if (from === undefined) continue;
      for (const ref of findImports(readFileSync(file, "utf8"))) {
        let to: string | undefined;
        let outside = false;
        if (ref.specifier.startsWith(".")) {
          const target = resolve(dirname(file), ref.specifier);
          to = owningPackage(ws, target);
          outside = to === undefined;
        } else {
          to = packageOfName(ws, ref.specifier);
        }
        const rule = `boundaries/${from.replace("/", "-")}`;
        if (outside) {
          violations.push({
            file: relFile,
            line: ref.line,
            rule,
            message: `"${ref.specifier}" reaches outside ${from}; import workspace code by package name`,
          });
          continue;
        }
        if (to === undefined) continue;
        const reason = verdict(from, to, ref.typeOnly);
        if (reason !== undefined) {
          violations.push({
            file: relFile,
            line: ref.line,
            rule,
            message: `${reason} ("${ref.specifier}")`,
          });
        }
      }
    }
  }
  return violations;
}

function main(): void {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
  const violations = checkBoundaries(root);
  if (violations.length === 0) {
    console.log("Package boundaries: ok");
    return;
  }
  for (const v of violations) console.error(`${v.file}:${v.line}  ${v.rule}  ${v.message}`);
  console.error(
    `\nPackage boundaries: ${violations.length} violation(s). See the spine's Invariants.`,
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
