// The viewer-first rule for repositories (AD-3): every method of a repository of scoped data takes
// the `Viewer` as its first parameter, or is listed below with the reason it may not. The check
// reads `unit-of-work.ts` as source, so a method added to `TxRepos` (or a repository added to it)
// fails here until it takes a viewer or is allow-listed with a reason, writes included.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const portFile = fileURLToPath(new URL("./unit-of-work.ts", import.meta.url));

/** `TxRepos` keys whose repositories read or write scoped data: each method is checked. */
const SCOPED_REPOS = [
  "audit",
  "reviewItems",
  "accounts",
  "transactions",
  "balanceSnapshots",
  "transferGroups",
  "tags",
  "activities",
  "payees",
  "payeeAliases",
] as const;

/** `TxRepos` keys that hold no scoped data, each with its reason. Every other key is checked. */
const UNSCOPED_REPOS: Readonly<Record<string, string>> = {
  householdSettings: "one household-wide row",
  person: "the household's two people, no ledger data",
  users: "logins and enrolment, no ledger data",
  setupLinks: "household setup links",
  loginAttempts: "the sign-in throttle log",
  recoveryCodes: "a person's recovery codes, read by their own id",
  reEnrolmentLinks: "re-enrolment links, read by token or id",
  credentials: "passkey and two-factor rows of one login",
  jobs: "the job queue; payloads carry no ledger data (AD-9)",
  institutions: "household-wide, shared by both partners",
  categoryGroups: "household-wide, shared by both partners",
  categories: "household-wide, shared by both partners",
  taxCategories: "household-wide, shared by both partners",
  backups:
    "one row per backup: its id, when it was taken, the schema version, its push job and its restic snapshot id; no count or digest of the household's data",
  backupVerifications:
    "one row per check or drill: its kind, whether it passed and fixed words naming the check; no figure of the household's data",
  recoveryBundle: "whether the recovery bundle is confirmed",
};

/** `Repo.method` for each method that may take no viewer first, with the reason. */
const VIEWERLESS: Readonly<Record<string, string>> = {
  // Writes the caller has already authorised: a use case finds the row with a viewer-checked read
  // first, or the row is new and mints its own scope.
  "AccountRepo.insert": "a new account and its owners; the use case sets the scope",
  "AccountRepo.update": "the use case found the account with findVisible first",
  "AccountRepo.replaceOwners": "the use case found the account with findVisible first",
  "TransactionRepo.insert": "a new row; the use case checked the account with findVisible",
  "TransactionRepo.updateSplitAmount": "a write on a split the use case read through the viewer",
  "TransactionRepo.replaceSplits": "a write on splits the use case read through the viewer",
  "TransactionRepo.updateSplit": "a write on a split the use case read through the viewer",
  "TransactionRepo.setNeedsReview":
    "a derived flag kept from open review items, set whatever the viewer",
  "TransactionRepo.setTransferGroup":
    "links and unlinks every member of a group, also ones the viewer cannot see (decision 81)",
  "BalanceSnapshotRepo.insert": "a new row; the use case checked the account with findVisible",
  "TransferGroupRepo.insert": "a new group; the use case checked the members with the viewer",
  "TransferGroupRepo.delete":
    "the use case checked every member through members(viewer) before it deletes the group",
  "ReviewItemRepo.raise": "a new item; its scope comes from the raising module",
  "ReviewItemRepo.resolve": "resolution by dedupe key on behalf of the module that raised it",
  "ReviewItemRepo.countOpenForEntity": "a count for the entity's own module, never shown to anyone",
  "ReviewItemRepo.resolveOpenForEntity": "resolution on behalf of the module that raised them",
  "AuditRepo.append": "write-only: the audit row carries its own scope",
  "AuditRepo.scopeToPerson":
    "write-only: narrows the scope of an account's private-era rows to its owner (decision 80)",
  "TagRepo.insert": "a new row; its scope is the creating person's",
  "ActivityRepo.insert": "a new row; its scope is the creating person's",
  "PayeeRepo.insert": "a new row; its scope is the creating person's",
  "PayeeAliasRepo.insert": "a new row; its scope is the creating person's",
  "PayeeRepo.clearDefaultCategory":
    "a household-wide cascade of a category delete that reaches every payee, whatever its scope (a known gap in the route manifest)",
  "PayeeAliasRepo.softDeleteForPayee":
    "a cascade of a payee delete that reaches every alias of it, whatever its scope (a known gap in the route manifest)",
  // Reads with no viewer: the only ones.
  "AccountRepo.any": "whether any account exists, for first-run setup; returns no row",
  "AccountRepo.owners": "the owners of an account the use case already read with the viewer",
  "AccountRepo.hasSplitForOthers":
    "a yes or no on an account the use case already read with the viewer (AD-7)",
  "AccountRepo.scopedReferences":
    "names the owner's own scoped rows, in a refusal only the owner can read (AD-18)",
  "TransferGroupRepo.upkeepMembers":
    "unlinks the survivor of a deleted transfer even in the other partner's private account; a use-case read on the port, never behind SystemViewer (decision 81, AD-6)",
};

// ------------------------------------------------------------------------------ the parser

/** Source with block and whole-line comments removed (the port's own are the only ones). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The text between the braces of `export interface <name>`, or undefined. */
function interfaceBody(source: string, name: string): string | undefined {
  const start = source.search(new RegExp(String.raw`export interface ${name}\b`));
  if (start < 0) return undefined;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return undefined;
}

/** The top-level members of an interface body, split on `;` outside any brackets. */
function statements(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === ";" && depth === 0) {
      out.push(body.slice(from, i).trim());
      from = i + 1;
    }
  }
  const rest = body.slice(from).trim();
  if (rest !== "") out.push(rest);
  return out.filter((statement) => statement !== "");
}

/** The text of the parameter list that opens at `open` (a `(`). */
function parameterList(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return "";
}

interface Method {
  readonly name: string;
  /** The first parameter's name, or null for none. */
  readonly first: string | null;
}

/** The methods of a repository interface: `name(args): R` and `name: (args) => R` members. */
function methodsOf(body: string): Method[] {
  return statements(body).flatMap((statement) => {
    const head = /^(?:readonly\s+)?(\w+)\s*(?:<[^(]*>)?\s*(:\s*)?\(/.exec(statement);
    if (head === null) return [];
    const open = head[0].length - 1;
    const first = /^\s*(\w+)\??\s*[:,)]/.exec(parameterList(statement, open));
    return [{ name: head[1] as string, first: first === null ? null : (first[1] as string) }];
  });
}

/** `TxRepos`' keys and the interface each names. */
function txRepoTypes(source: string): Map<string, string> {
  const body = interfaceBody(source, "TxRepos") ?? "";
  return new Map(
    [...body.matchAll(/readonly\s+(\w+)\s*:\s*(\w+)\s*;/g)].map((m): [string, string] => [
      m[1] as string,
      m[2] as string,
    ]),
  );
}

/**
 * The repository methods that take no viewer first and are not in `allowed`, as `Repo.method`;
 * and the `TxRepos` keys that are neither scoped nor listed as unscoped.
 */
function problemsIn(
  source: string,
  allowed: Readonly<Record<string, string>> = VIEWERLESS,
): string[] {
  const text = stripComments(source);
  const types = txRepoTypes(text);
  const problems: string[] = [];
  // A member the key/type pattern did not match (no `readonly`, generic, `Pick<>`) would be
  // neither classified nor checked, so it is a problem in itself.
  for (const statement of statements(interfaceBody(text, "TxRepos") ?? "")) {
    if (!/^readonly\s+\w+\s*:\s*\w+$/.test(statement)) {
      problems.push(
        `TxRepos member \`${statement.replace(/\s+/g, " ")}\` is not written \`readonly name: Type;\`, so it is not checked`,
      );
    }
  }
  for (const key of types.keys()) {
    if (!(SCOPED_REPOS as readonly string[]).includes(key) && !(key in UNSCOPED_REPOS)) {
      problems.push(
        `TxRepos.${key} is neither a scoped repository nor an unscoped one with a reason`,
      );
    }
  }
  for (const key of SCOPED_REPOS) {
    const type = types.get(key);
    const body = type === undefined ? undefined : interfaceBody(text, type);
    if (type === undefined || body === undefined) {
      problems.push(`TxRepos.${key} is missing or has no interface`);
      continue;
    }
    for (const method of methodsOf(body)) {
      if (method.first !== "viewer" && !(`${type}.${method.name}` in allowed)) {
        problems.push(`${type}.${method.name} takes no viewer first and is not allow-listed`);
      }
    }
  }
  return problems;
}

// -------------------------------------------------------------------------------------- tests

describe("repositories take the viewer first (AD-3)", () => {
  const source = readFileSync(portFile, "utf8");

  it("has no scoped method without a viewer outside the allow-list", () => {
    expect(problemsIn(source)).toEqual([]);
  });

  it("reads the port: it finds the scoped repositories and their methods", () => {
    const text = stripComments(source);
    const types = txRepoTypes(text);
    expect(types.get("accounts")).toBe("AccountRepo");
    const accounts = methodsOf(interfaceBody(text, "AccountRepo") ?? "");
    expect(accounts).toEqual(
      expect.arrayContaining([
        { name: "findVisible", first: "viewer" },
        { name: "list", first: "viewer" },
        { name: "owners", first: "accountId" },
        { name: "any", first: null },
      ]),
    );
    const transactions = methodsOf(interfaceBody(text, "TransactionRepo") ?? "");
    expect(transactions.find((m) => m.name === "update")).toEqual({
      name: "update",
      first: "viewer",
    });
    // Every repository is classified, and every allow-list entry names a method that exists.
    for (const key of types.keys()) {
      expect(SCOPED_REPOS.includes(key as never) || key in UNSCOPED_REPOS, key).toBe(true);
    }
    for (const entry of Object.keys(VIEWERLESS)) {
      const [type, name] = entry.split(".") as [string, string];
      const methods = methodsOf(interfaceBody(text, type) ?? "");
      const found = methods.find((m) => m.name === name);
      expect(found, `${entry} no longer exists: drop it`).toBeDefined();
      expect(found?.first, `${entry} takes a viewer now: drop it`).not.toBe("viewer");
    }
  });

  it("gives every allow-list entry a reason", () => {
    for (const [entry, reason] of Object.entries({ ...VIEWERLESS, ...UNSCOPED_REPOS })) {
      expect(reason.trim(), entry).not.toBe("");
    }
  });

  it("fails naming a method planted without a viewer", () => {
    const planted = source.replace(
      "export interface TransferGroupRepo {",
      "export interface TransferGroupRepo {\n  allRaw(): TransactionRow[];",
    );
    expect(planted).not.toBe(source);
    expect(problemsIn(planted)).toEqual([
      "TransferGroupRepo.allRaw takes no viewer first and is not allow-listed",
    ]);
    const writes = source.replace(
      "export interface AuditRepo {",
      "export interface AuditRepo {\n  purge(accountId: string): void;",
    );
    expect(problemsIn(writes)).toEqual([
      "AuditRepo.purge takes no viewer first and is not allow-listed",
    ]);
  });

  it("fails on a viewerless method that is not allow-listed, and on a repository added to TxRepos", () => {
    const without = { ...VIEWERLESS };
    delete without["AccountRepo.owners"];
    expect(problemsIn(source, without)).toEqual([
      "AccountRepo.owners takes no viewer first and is not allow-listed",
    ]);
    const added = source.replace(
      "export interface TxRepos {",
      "export interface TxRepos {\n  readonly splits: AccountRepo;",
    );
    const odd = source.replace(
      "export interface TxRepos {",
      'export interface TxRepos {\n  splits: Pick<AccountRepo, "owners">;',
    );
    expect(problemsIn(odd)).toEqual([
      'TxRepos member `splits: Pick<AccountRepo, "owners">` is not written `readonly name: Type;`, so it is not checked',
    ]);
    expect(problemsIn(added)).toEqual([
      "TxRepos.splits is neither a scoped repository nor an unscoped one with a reason",
    ]);
  });
});
