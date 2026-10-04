import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAccount,
  createIdGenerator,
  createPayee,
  createPerson,
  createTag,
  createTransaction,
  fixedClockAt,
  personViewer,
  systemClock,
  type UnitOfWork,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import {
  createSystemHealthRepo,
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeTokens, recoveryCodeHasher } from "../auth/secret.ts";
import { type AppDeps, createApp } from "./app.ts";
import type { AuthGateway, Authn } from "./session.ts";

let dir: string;
let dbPath: string;
let webRoot: string;
const open: Db[] = [];

const ORIGIN = "http://localhost:3000";
const SESSION_COOKIE = "session=user-a";

function openDb(readonly = false): Db {
  const db = openDatabase(dbPath, { readonly });
  open.push(db);
  return db;
}

/**
 * A gateway whose only session is `user-a`, created at `createdAt`, sent as `SESSION_COOKIE`.
 * `setCookies` stand for a refreshed session cookie.
 */
function fakeGateway(createdAt = new Date(), setCookies: string[] = []): AuthGateway {
  return {
    handler: async (request) => new Response(`auth:${new URL(request.url).pathname}`),
    getSession: async (headers) => ({
      session: headers.get("cookie") === SESSION_COOKIE ? { userId: "user-a", createdAt } : null,
      setCookies,
    }),
    signUp: async () => {
      throw new Error("not used");
    },
    recover: async () => {
      throw new Error("not used");
    },
    reEnrol: async () => {
      throw new Error("not used");
    },
  };
}

function deps(db: Db, authn: Authn = { kind: "live", gateway: fakeGateway() }): AppDeps {
  const uow: UnitOfWork = createUnitOfWork(db);
  return {
    systemHealth: createSystemHealthRepo(db),
    uow,
    clock: fixedClockAt("2026-09-27"),
    newId: createIdGenerator(),
    tokens: nodeTokens,
    codes: recoveryCodeHasher("test-secret"),
    publicUrl: ORIGIN,
    authn,
    healthz: { expectedSchemaVersion: MIGRATIONS, runner: () => ticking },
  };
}

const MIGRATIONS = loadMigrations(packageMigrationsDir).length;
/** A runner that ticked just now, by the fixed clock `deps` uses. */
const ticking = {
  running: true,
  lastTickAt: fixedClockAt("2026-09-27").now().epochMilliseconds,
  pollMs: 1000,
};

/**
 * Links `user-a` to a person, with TOTP and a passkey enrolled, so the fake session resolves to
 * a viewer that may use the app.
 */
function addPerson(db: Db): void {
  db.prepare(
    `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
     VALUES ('user-a', 'Alex', 'alex@example.com', 0, 1, 'x', 'x')`,
  ).run();
  db.prepare(
    `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
     VALUES ('pk', 'user-a', 'k', 'c', 0, 'singleDevice', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at)
     VALUES ('01J0000000000000000000000A', 'user-a', 'Alex', '#2563eb', 'x', 'x')`,
  ).run();
}

const signedIn = { headers: { Cookie: SESSION_COOKIE } };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-http-"));
  dbPath = join(dir, "pangolin.sqlite");
  migrate(openDb(), loadMigrations(packageMigrationsDir));
  webRoot = join(dir, "public");
  mkdirSync(join(webRoot, "assets"), { recursive: true });
  writeFileSync(
    join(webRoot, "index.html"),
    '<!doctype html><title>Pangolin</title><meta property="csp-nonce" nonce="__CSP_NONCE__" />',
  );
  writeFileSync(join(webRoot, "assets", "app-abc123.js"), "console.log(1)");
});

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/system/health", () => {
  it("returns 200 ok on a writable, migrated database, with no session", async () => {
    const app = createApp(deps(openDb()));
    const res = await app.request("/api/system/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", schemaVersion: 10, writable: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 503 with writable:false on a read-only database", async () => {
    const app = createApp(deps(openDb(true)));
    const res = await app.request("/api/system/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "unhealthy",
      schemaVersion: MIGRATIONS,
      writable: false,
    });
  });
});

describe("GET /healthz", () => {
  it("returns 200 ok with no session, Origin or detail", async () => {
    const res = await createApp({ ...deps(openDb()), webRoot }).request("/healthz", {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 503 naming a read-only database", async () => {
    const res = await createApp(deps(openDb(true))).request("/healthz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, failing: ["database"] });
  });

  it("returns 503 naming a stopped, stale or absent runner", async () => {
    const db = openDb();
    for (const runner of [
      () => ({ ...ticking, running: false }),
      () => ({ ...ticking, lastTickAt: ticking.lastTickAt - 3001 }),
      () => undefined,
    ]) {
      const app = createApp({
        ...deps(db),
        healthz: { expectedSchemaVersion: MIGRATIONS, runner },
      });
      const res = await app.request("/healthz");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, failing: ["jobs"] });
    }
  });

  it("returns 503 naming unapplied migrations", async () => {
    const app = createApp({
      ...deps(openDb()),
      healthz: { expectedSchemaVersion: MIGRATIONS + 1, runner: () => ticking },
    });
    const res = await app.request("/healthz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, failing: ["migrations"] });
  });

  it("probes the database at most once a second", async () => {
    const db = openDb();
    const real = createSystemHealthRepo(db);
    let probes = 0;
    const systemHealth = {
      schemaVersion: () => real.schemaVersion(),
      probeWrite: () => {
        probes++;
        return real.probeWrite();
      },
    };
    let now = fixedClockAt("2026-09-27").now();
    const clock = systemClock("UTC", () => now);
    const app = createApp({
      ...deps(db),
      systemHealth,
      clock,
      healthz: {
        expectedSchemaVersion: MIGRATIONS,
        runner: () => ({ ...ticking, lastTickAt: now.epochMilliseconds }),
      },
    });
    expect((await app.request("/healthz")).status).toBe(200);
    now = now.add({ milliseconds: 999 });
    expect((await app.request("/healthz")).status).toBe(200);
    expect(probes).toBe(1);
    now = now.add({ milliseconds: 1 });
    await app.request("/healthz");
    expect(probes).toBe(2);
  });

  it("skips the runner check in demo mode", async () => {
    const app = createApp({
      ...deps(openDb(), { kind: "demo" }),
      healthz: { expectedSchemaVersion: MIGRATIONS, runner: "skip" },
    });
    expect((await app.request("/healthz")).status).toBe(200);
  });
});

describe("GET /api/ledger/transactions", () => {
  const alex = "01J0000000000000000000000A";

  /** A shared account and each person's private one, one transaction in each. */
  function seedLedger(db: Db): void {
    addPerson(db);
    const d = deps(db);
    const ctx: UseCaseContext = {
      viewer: systemViewer("cli:test"),
      clock: d.clock,
      newId: d.newId,
      uow: d.uow,
    };
    const sam = createPerson(ctx, { displayName: "Sam", colour: "#000000" });
    const account = (name: string, isPrivate: boolean, owners: [string, number][]) =>
      createAccount(ctx, {
        name,
        type: "transaction",
        currency: "AUD",
        isPrivate,
        owners: owners.map(([personId, shareBp]) => ({ personId, shareBp })),
      });
    const joint = account("Joint", false, [
      [alex, 5000],
      [sam, 5000],
    ]);
    const mine = account("Alex private", true, [[alex, 10000]]);
    const theirs = account("Sam private", true, [[sam, 10000]]);
    for (const [accountId, description] of [
      [joint, "joint"],
      [mine, "mine"],
      [theirs, "theirs"],
    ] as const) {
      createTransaction(ctx, { accountId, postedOn: "2026-09-01", amountCents: -100, description });
    }
  }

  it("needs a session", async () => {
    const res = await createApp(deps(openDb())).request("/api/ledger/transactions");
    expect(res.status).toBe(401);
  });

  it("returns the shared account's transactions and the viewer's own private ones, uncached", async () => {
    const db = openDb();
    seedLedger(db);
    const res = await createApp(deps(db)).request("/api/ledger/transactions", signedIn);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      transactions: { descriptionRaw: string; splits: { beneficiary: string }[] }[];
    };
    expect(body.transactions.map((t) => t.descriptionRaw).sort()).toEqual(["joint", "mine"]);
    const mine = body.transactions.find((t) => t.descriptionRaw === "mine");
    expect(mine?.splits.map((s) => s.beneficiary)).toEqual([alex]);
  });
});

describe("/api/accounts", () => {
  const alex = "01J0000000000000000000000A";
  const json = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: SESSION_COOKIE };

  /** Alex is the signed-in login. Sam's private account must not exist for Alex. */
  function seed(db: Db) {
    addPerson(db);
    const d = deps(db);
    const sys: UseCaseContext = {
      viewer: systemViewer("cli:test"),
      clock: d.clock,
      newId: d.newId,
      uow: d.uow,
    };
    const sam = createPerson(sys, { displayName: "Sam", colour: "#000000" });
    const make = (name: string, isPrivate: boolean, owners: [string, number][]) =>
      createAccount(sys, {
        name,
        type: "transaction",
        currency: "AUD",
        isPrivate,
        owners: owners.map(([personId, shareBp]) => ({ personId, shareBp })),
      });
    const joint = make("Joint", false, [
      [alex, 5000],
      [sam, 5000],
    ]);
    const mine = make("Alex private", true, [[alex, 10000]]);
    const theirs = make("Sam private", true, [[sam, 10000]]);
    createTransaction(sys, {
      accountId: joint,
      postedOn: "2026-09-01",
      amountCents: -100,
      description: "j",
    });
    return { sam, joint, mine, theirs, sys };
  }

  const send = (db: Db, method: string, path: string, body?: unknown, authn?: Authn) =>
    createApp(deps(db, authn)).request(path, {
      method,
      headers: json,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it("needs a session", async () => {
    const res = await createApp(deps(openDb())).request("/api/accounts");
    expect(res.status).toBe(401);
  });

  it("answers 404 to the partner for every read and write of a private account", async () => {
    const db = openDb();
    const { theirs } = seed(db);
    const base = `/api/accounts/${theirs}`;
    const calls: [string, string, unknown?][] = [
      ["GET", base],
      ["PATCH", base, { name: "x" }],
      ["POST", `${base}/close`, {}],
      ["POST", `${base}/privacy`, { isPrivate: false }],
      ["GET", `${base}/balance?asOf=2026-09-27`],
      ["GET", `${base}/snapshots`],
      ["POST", `${base}/snapshots`, { asOf: "2026-09-01", balanceCents: 5 }],
    ];
    for (const [method, path, body] of calls) {
      const res = await send(db, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({
        error: { code: "NotFound", message: "Account not found" },
      });
    }
    // Indistinguishable from an account that does not exist.
    expect((await send(db, "GET", "/api/accounts/01JNOSUCHACCOUNT")).status).toBe(404);
    const list = (await (await send(db, "GET", "/api/accounts")).json()) as {
      accounts: { name: string }[];
    };
    expect(list.accounts.map((a) => a.name).sort()).toEqual(["Alex private", "Joint"]);
    expect(
      db.prepare("SELECT count(*) FROM audit_log WHERE account_id = ?").pluck().get(theirs),
    ).toBe(1);
  });

  it("creates, edits, closes, snapshots and reports a balance", async () => {
    const db = openDb();
    const { sam } = seed(db);
    const inst = await send(db, "POST", "/api/accounts/institutions", {
      name: "Bank",
      kind: "bank",
    });
    expect(inst.status).toBe(201);
    const { institution } = (await inst.json()) as { institution: { id: string } };
    const renamed = await send(db, "PATCH", `/api/accounts/institutions/${institution.id}`, {
      name: "Bank 2",
    });
    expect(((await renamed.json()) as { institution: { name: string } }).institution.name).toBe(
      "Bank 2",
    );
    expect(
      (
        (await (await send(db, "GET", "/api/accounts/institutions")).json()) as {
          institutions: unknown[];
        }
      ).institutions,
    ).toHaveLength(1);

    const created = await send(db, "POST", "/api/accounts", {
      name: "Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      isSavings: true,
      institutionId: institution.id,
      owners: [
        { personId: alex, shareBp: 5000 },
        { personId: sam, shareBp: 5000 },
      ],
    });
    expect(created.status).toBe(201);
    const { account } = (await created.json()) as { account: { id: string; pool: string } };
    expect(account.pool).toBe("shared");
    const path = `/api/accounts/${account.id}`;

    expect((await send(db, "PATCH", path, { name: "Rainy day" })).status).toBe(200);
    expect((await send(db, "PATCH", path, { currency: "USD" })).status).toBe(400);
    expect((await send(db, "POST", `${path}/privacy`, { isPrivate: true })).status).toBe(400);

    const snap = await send(db, "POST", `${path}/snapshots`, {
      asOf: "2026-09-01",
      balanceCents: 1000,
      source: "statement",
    });
    expect(snap.status).toBe(201);
    expect(((await snap.json()) as { snapshot: { source: string } }).snapshot.source).toBe(
      "manual",
    );
    const listed = (await (await send(db, "GET", `${path}/snapshots`)).json()) as {
      snapshots: unknown[];
    };
    expect(listed.snapshots).toHaveLength(1);
    const balance = await send(db, "GET", `${path}/balance?asOf=2026-09-27`);
    expect(await balance.json()).toEqual({ asOf: "2026-09-27", balanceCents: 1000 });

    const closed = await send(db, "POST", `${path}/close`);
    expect(((await closed.json()) as { account: { closedOn: string } }).account.closedOn).toBe(
      "2026-09-27",
    );
    expect((await send(db, "POST", `${path}/close`)).status).toBe(409);
  });

  it("refuses an id or unknown field in a create body, and a bad balance query", async () => {
    const db = openDb();
    const { joint } = seed(db);
    const body = {
      id: "mine",
      name: "X",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: alex, shareBp: 10000 }],
    };
    expect((await send(db, "POST", "/api/accounts", body)).status).toBe(400);
    expect((await send(db, "GET", `/api/accounts/${joint}/balance?asOf=soon`)).status).toBe(400);
    expect((await send(db, "POST", "/api/accounts", undefined)).status).toBe(400);
  });

  it("lets the path id win over an id in the body", async () => {
    const db = openDb();
    const { joint, mine } = seed(db);
    const audits = (id: string) =>
      db.prepare("SELECT count(*) FROM audit_log WHERE account_id = ?").pluck().get(id);
    const mineAudits = audits(mine);
    const patched = await send(db, "PATCH", `/api/accounts/${joint}`, { id: mine, name: "z" });
    expect(patched.status).toBe(200);
    const name = (id: string) =>
      db.prepare("SELECT name FROM account WHERE id = ?").pluck().get(id);
    expect(name(joint)).toBe("z");
    expect(name(mine)).toBe("Alex private");
    const closed = await send(db, "POST", `/api/accounts/${joint}/snapshots`, {
      accountId: mine,
      asOf: "2026-09-01",
      balanceCents: 5,
    });
    expect(closed.status).toBe(201);
    expect(db.prepare("SELECT account_id FROM balance_snapshot").pluck().all()).toEqual([joint]);
    expect(audits(mine)).toBe(mineAudits);
  });

  it("answers 400 for a non-cash account's balance and for an empty asOf", async () => {
    const db = openDb();
    const { joint, sys } = seed(db);
    const brokerage = createAccount(sys, {
      name: "Broker",
      type: "brokerage",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: alex, shareBp: 10000 }],
    });
    expect(
      (await send(db, "GET", `/api/accounts/${brokerage}/balance?asOf=2026-09-27`)).status,
    ).toBe(400);
    expect((await send(db, "GET", `/api/accounts/${joint}/balance?asOf=`)).status).toBe(400);
  });

  it("makes an account private only when no live split is shared", async () => {
    const db = openDb();
    const { joint, mine } = seed(db);
    expect(
      (
        await send(db, "PATCH", `/api/accounts/${joint}`, {
          owners: [{ personId: alex, shareBp: 10000 }],
        })
      ).status,
    ).toBe(200);
    expect(
      (await send(db, "POST", `/api/accounts/${joint}/privacy`, { isPrivate: true })).status,
    ).toBe(409);
    expect(
      (await send(db, "POST", `/api/accounts/${mine}/privacy`, { isPrivate: false })).status,
    ).toBe(200);
  });

  it("is read-only in demo mode", async () => {
    const db = openDb();
    const { joint } = seed(db);
    const demo: Authn = { kind: "demo" };
    const writes: [string, string, unknown][] = [
      ["POST", "/api/accounts", {}],
      ["PATCH", `/api/accounts/${joint}`, { name: "x" }],
      ["POST", `/api/accounts/${joint}/close`, {}],
      ["POST", `/api/accounts/${joint}/privacy`, { isPrivate: false }],
      ["POST", `/api/accounts/${joint}/snapshots`, { asOf: "2026-09-01", balanceCents: 1 }],
      ["POST", "/api/accounts/institutions", { name: "x", kind: "bank" }],
    ];
    for (const [method, path, body] of writes) {
      expect((await send(db, method, path, body, demo)).status, path).toBe(409);
    }
    expect((await send(db, "GET", "/api/accounts", undefined, demo)).status).toBe(200);
  });
});

describe("/api/classify", () => {
  const alex = "01J0000000000000000000000A";
  const json = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: SESSION_COOKIE };

  /** Alex is the signed-in login; Sam (the partner) owns a private account with scoped rows. */
  function seed(db: Db) {
    addPerson(db);
    const d = deps(db);
    const sys: UseCaseContext = {
      viewer: systemViewer("cli:test"),
      clock: d.clock,
      newId: d.newId,
      uow: d.uow,
    };
    const sam = createPerson(sys, { displayName: "Sam", colour: "#000000" });
    const account = (name: string, isPrivate: boolean, owners: [string, number][]) =>
      createAccount(sys, {
        name,
        type: "transaction",
        currency: "AUD",
        isPrivate,
        owners: owners.map(([personId, shareBp]) => ({ personId, shareBp })),
      });
    const joint = account("Joint", false, [
      [alex, 5000],
      [sam, 5000],
    ]);
    const mine = account("Alex private", true, [[alex, 10000]]);
    const theirs = account("Sam private", true, [[sam, 10000]]);
    return { sam, joint, mine, theirs, sys };
  }

  const send = (db: Db, method: string, path: string, body?: unknown, authn?: Authn) =>
    createApp(deps(db, authn)).request(path, {
      method,
      headers: json,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it("needs a session", async () => {
    expect((await createApp(deps(openDb())).request("/api/classify/payees")).status).toBe(401);
  });

  it("creates, lists, edits and deletes household-wide rows", async () => {
    const db = openDb();
    seed(db);
    const group = (await (
      await send(db, "POST", "/api/classify/category-groups", { name: "Pets", kind: "expense" })
    ).json()) as { categoryGroup: { id: string; sort: number } };
    expect(group.categoryGroup.sort).toBe(1);
    expect(
      (await send(db, "POST", "/api/classify/category-groups", { name: "Pets", kind: "expense" }))
        .status,
    ).toBe(409);
    expect(
      (
        await send(db, "PATCH", `/api/classify/category-groups/${group.categoryGroup.id}`, {
          sort: 5,
        })
      ).status,
    ).toBe(200);
    const created = await send(db, "POST", "/api/classify/categories", {
      groupId: group.categoryGroup.id,
      name: "Food",
    });
    expect(created.status).toBe(201);
    const { category } = (await created.json()) as { category: { id: string } };
    expect(
      (await send(db, "PATCH", `/api/classify/categories/${category.id}`, { isFixedCost: true }))
        .status,
    ).toBe(200);
    const tax = await send(db, "POST", "/api/classify/tax-categories", { code: "X1", label: "X" });
    expect(tax.status).toBe(201);
    const { taxCategory } = (await tax.json()) as { taxCategory: { id: string } };
    expect(
      (
        await send(db, "PATCH", `/api/classify/tax-categories/${taxCategory.id}`, {
          defaultDeductibleBp: 100,
        })
      ).status,
    ).toBe(200);
    const deleted = await send(db, "DELETE", `/api/classify/categories/${category.id}`);
    expect(deleted.status).toBe(200);
    expect(
      (
        (await (await send(db, "GET", "/api/classify/categories")).json()) as {
          categories: unknown[];
        }
      ).categories,
    ).toEqual([]);
    expect((await send(db, "DELETE", `/api/classify/categories/${category.id}`)).status).toBe(404);
    // Groups and tax categories have no delete route.
    expect(
      (await send(db, "DELETE", `/api/classify/category-groups/${group.categoryGroup.id}`)).status,
    ).toBe(404);
  });

  it("answers 404 to the partner's scoped rows for every read and write", async () => {
    const db = openDb();
    const { sam, sys, theirs } = seed(db);
    const samCtx: UseCaseContext = {
      ...sys,
      viewer: personViewer(sam as never, sys.clock.now()),
    };
    const payee = createPayee(samCtx, { name: "Secret", originAccountId: theirs });
    const tag = createTag(samCtx, { name: "secret", originAccountId: theirs });
    const calls: [string, string, unknown?][] = [
      ["GET", `/api/classify/payees/${payee.id}`],
      ["PATCH", `/api/classify/payees/${payee.id}`, { name: "x" }],
      ["DELETE", `/api/classify/payees/${payee.id}`],
      ["GET", `/api/classify/tags/${tag.id}`],
      ["PATCH", `/api/classify/tags/${tag.id}`, { name: "x" }],
      ["DELETE", `/api/classify/tags/${tag.id}`],
    ];
    for (const [method, path, body] of calls) {
      const res = await send(db, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(
      ((await (await send(db, "GET", "/api/classify/payees")).json()) as { payees: unknown[] })
        .payees,
    ).toEqual([]);
    // Passing the partner's private account as an origin is a 404, like an unknown account.
    for (const [path, body] of [
      ["/api/classify/payees", { name: "P", originAccountId: theirs }],
      ["/api/classify/tags", { name: "T", originAccountId: theirs }],
      ["/api/classify/activities", { name: "A", originAccountId: theirs }],
    ] as const) {
      expect((await send(db, "POST", path, body)).status, path).toBe(404);
    }
    // A client cannot name a scope.
    expect(
      (await send(db, "POST", "/api/classify/payees", { name: "P", scopePersonId: sam })).status,
    ).toBe(400);
  });

  it("creates a same-name shared payee beside the partner's hidden scoped one", async () => {
    const db = openDb();
    const { sam, sys, theirs, mine } = seed(db);
    const samCtx: UseCaseContext = {
      ...sys,
      viewer: personViewer(sam as never, sys.clock.now()),
    };
    createPayee(samCtx, { name: "Woolworths", originAccountId: theirs });
    const shared = await send(db, "POST", "/api/classify/payees", { name: "Woolworths" });
    expect(shared.status).toBe(201);
    const again = await send(db, "POST", "/api/classify/payees", { name: "Woolworths" });
    expect(again.status).toBe(409);
    expect(JSON.stringify(await again.json())).not.toMatch(/scope|private/i);
    // Alex's own private origin gives an Alex-scoped row, never returned with its origin.
    const own = await send(db, "POST", "/api/classify/payees", {
      name: "Woolworths",
      originAccountId: mine,
    });
    expect(own.status).toBe(201);
    expect(JSON.stringify(await own.json())).not.toContain(mine);
  });

  it("covers aliases and activities", async () => {
    const db = openDb();
    const { mine } = seed(db);
    const payee = (await (
      await send(db, "POST", "/api/classify/payees", { name: "P" })
    ).json()) as {
      payee: { id: string };
    };
    const alias = await send(db, "POST", "/api/classify/payees/aliases", {
      payeeId: payee.payee.id,
      pattern: "^P",
      matchKind: "regex",
    });
    expect(alias.status).toBe(201);
    const { alias: made } = (await alias.json()) as { alias: { id: string } };
    expect(
      (
        await send(db, "POST", "/api/classify/payees/aliases", {
          payeeId: payee.payee.id,
          pattern: "(",
          matchKind: "regex",
        })
      ).status,
    ).toBe(400);
    expect((await send(db, "GET", `/api/classify/payees/aliases/${made.id}`)).status).toBe(200);
    expect(
      (await send(db, "PATCH", `/api/classify/payees/aliases/${made.id}`, { matchKind: "prefix" }))
        .status,
    ).toBe(200);
    expect((await send(db, "GET", "/api/classify/payees/aliases")).status).toBe(200);
    expect((await send(db, "DELETE", `/api/classify/payees/aliases/${made.id}`)).status).toBe(200);

    const act = await send(db, "POST", "/api/classify/activities", {
      name: "Japan",
      startsOn: "2026-10-01",
      endsOn: "2026-10-02",
      budgetCents: 100,
      originAccountId: mine,
    });
    expect(act.status).toBe(201);
    const { activity } = (await act.json()) as { activity: { id: string; scopePersonId: string } };
    expect(activity.scopePersonId).toBe(alex);
    expect(
      (await send(db, "PATCH", `/api/classify/activities/${activity.id}`, { endsOn: "2026-09-01" }))
        .status,
    ).toBe(400);
    expect((await send(db, "DELETE", `/api/classify/activities/${activity.id}`)).status).toBe(200);
    expect((await send(db, "DELETE", `/api/classify/payees/${payee.payee.id}`)).status).toBe(200);
  });

  it("is read-only in demo mode", async () => {
    const db = openDb();
    seed(db);
    const demo: Authn = { kind: "demo" };
    const writes: [string, string, unknown][] = [
      ["POST", "/api/classify/category-groups", { name: "x", kind: "expense" }],
      ["PATCH", "/api/classify/category-groups/x", {}],
      ["POST", "/api/classify/categories", {}],
      ["PATCH", "/api/classify/categories/x", {}],
      ["DELETE", "/api/classify/categories/x", undefined],
      ["POST", "/api/classify/tax-categories", {}],
      ["PATCH", "/api/classify/tax-categories/x", {}],
      ["POST", "/api/classify/tags", {}],
      ["PATCH", "/api/classify/tags/x", {}],
      ["DELETE", "/api/classify/tags/x", undefined],
      ["POST", "/api/classify/payees", {}],
      ["PATCH", "/api/classify/payees/x", {}],
      ["DELETE", "/api/classify/payees/x", undefined],
      ["POST", "/api/classify/payees/aliases", {}],
      ["PATCH", "/api/classify/payees/aliases/x", {}],
      ["DELETE", "/api/classify/payees/aliases/x", undefined],
      ["POST", "/api/classify/activities", {}],
      ["PATCH", "/api/classify/activities/x", {}],
      ["DELETE", "/api/classify/activities/x", undefined],
    ];
    for (const [method, path, body] of writes) {
      expect((await send(db, method, path, body, demo)).status, `${method} ${path}`).toBe(409);
    }
    expect((await send(db, "GET", "/api/classify/payees", undefined, demo)).status).toBe(200);
  });
});

describe("GET /api/ledger/transactions hidden names", () => {
  // The only login in the helpers is Alex's, so Alex is the partner here: Sam hides one name
  // (Alex sees the placeholder) and Alex hides another (Alex sees the real name).
  it("shows the partner 'Hidden until <date>' and no payee, and the hider the real name", async () => {
    const db = openDb();
    const alex = "01J0000000000000000000000A";
    addPerson(db);
    const d = deps(db);
    const ctx: UseCaseContext = {
      viewer: systemViewer("cli:test"),
      clock: d.clock,
      newId: d.newId,
      uow: d.uow,
    };
    const sam = createPerson(ctx, { displayName: "Sam", colour: "#000000" });
    const joint = createAccount(ctx, {
      name: "Joint",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      owners: [
        { personId: alex, shareBp: 5000 },
        { personId: sam, shareBp: 5000 },
      ],
    });
    const add = (description: string) =>
      createTransaction(ctx, {
        accountId: joint,
        postedOn: "2026-09-01",
        amountCents: -100,
        description,
      });
    const samsSecret = add("Sam surprise gift");
    const alexsSecret = add("Alex surprise gift");
    db.prepare(
      "INSERT INTO payee (id, name, created_at, updated_at) VALUES ('PY1','Secret Shop','t','t')",
    ).run();
    const hide = (id: string, by: string) =>
      db
        .prepare(
          "UPDATE \"transaction\" SET name_hidden_until = '2999-03-12', name_hidden_by = ?, payee_id = 'PY1' WHERE id = ?",
        )
        .run(by, id);
    hide(samsSecret, sam);
    hide(alexsSecret, alex);
    const res = await createApp(deps(db)).request("/api/ledger/transactions", signedIn);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      transactions: { id: string; descriptionRaw: string; payeeId: string | null }[];
    };
    const sams = body.transactions.find((t) => t.id === samsSecret);
    expect(sams?.descriptionRaw).toBe("Hidden until 12 Mar 2999");
    expect(sams?.payeeId).toBeNull();
    expect(body.transactions.find((t) => t.id === alexsSecret)?.descriptionRaw).toBe(
      "Alex surprise gift",
    );
    expect(text).not.toContain("Sam surprise gift");
    expect(JSON.stringify(sams)).not.toContain("Secret Shop");
  });
});

describe("GET /api/system/jobs", () => {
  function insertJob(db: Db, id: string, kind: string, status: string, finishedAt: string | null) {
    db.prepare(
      `INSERT INTO job (id, kind, lane, payload, status, attempts, max_attempts, run_at,
         last_error, created_at, updated_at, finished_at)
       VALUES (?, ?, 'net', '{"account":"secret-payload"}', ?, 3, 3, 'x',
         'Error: secret-error-text', 'x', 'x', ?)`,
    ).run(id, kind, status, finishedAt);
  }

  it("answers 401 Unauthenticated without a session", async () => {
    const db = openDb();
    addPerson(db);
    const res = await createApp(deps(db)).request("/api/system/jobs");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "Unauthenticated", message: "Sign in first" },
    });
  });

  it("answers 401 for a session whose user has no person", async () => {
    const res = await createApp(deps(openDb())).request("/api/system/jobs", signedIn);
    expect(res.status).toBe(401);
  });

  it("returns an empty list when no job is dead", async () => {
    const db = openDb();
    addPerson(db);
    const res = await createApp(deps(db)).request("/api/system/jobs", signedIn);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dead: [] });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("lists dead jobs by kind and failure time only, newest first", async () => {
    const db = openDb();
    addPerson(db);
    insertJob(db, "01JOB0000000000000000000A1", "price-fetch", "dead", "2026-09-27T01:00:00.000Z");
    insertJob(db, "01JOB0000000000000000000A2", "backup-push", "dead", "2026-09-27T02:00:00.000Z");
    insertJob(db, "01JOB0000000000000000000A3", "price-fetch", "done", "2026-09-27T03:00:00.000Z");
    const res = await createApp(deps(db)).request("/api/system/jobs", signedIn);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      dead: [
        { kind: "backup-push", failedAt: "2026-09-27T02:00:00.000Z" },
        { kind: "price-fetch", failedAt: "2026-09-27T01:00:00.000Z" },
      ],
    });
    expect(text).not.toContain("secret");
    expect(text).not.toContain("01JOB");
  });

  it("lists at most 50", async () => {
    const db = openDb();
    addPerson(db);
    for (let i = 0; i < 55; i++) {
      const at = `2026-09-27T00:00:${String(i).padStart(2, "0")}.000Z`;
      insertJob(db, `01JOB00000000000000000${String(i).padStart(4, "0")}`, "k", "dead", at);
    }
    const res = await createApp(deps(db)).request("/api/system/jobs", signedIn);
    const body = (await res.json()) as { dead: unknown[] };
    expect(body.dead).toHaveLength(50);
  });
});

describe("GET /api/system/backup", () => {
  function insertBackup(db: Db, id: string, resticId: string | null, pushedAt: string | null) {
    db.prepare(
      `INSERT INTO backup_snapshot (id, taken_at, schema_version, table_count, row_count,
         manifest_sha256, push_job_id, restic_snapshot_id, pushed_at, created_at, updated_at)
       VALUES (?, '2026-09-27T00:00:00.000Z', 6, 10, 100, 'x', 'j', ?, ?, 'x', 'x')`,
    ).run(id, resticId, pushedAt);
  }

  it("answers 401 without a session", async () => {
    const db = openDb();
    addPerson(db);
    const res = await createApp({ ...deps(db), backupConfigured: true }).request(
      "/api/system/backup",
    );
    expect(res.status).toBe(401);
  });

  it("says when backups are not configured", async () => {
    const db = openDb();
    addPerson(db);
    insertBackup(db, "A", "1".repeat(64), "2026-09-27T00:05:00.000Z");
    const res = await createApp(deps(db)).request("/api/system/backup", signedIn);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      configured: false,
      last: null,
      stale: false,
      check: null,
      drill: null,
    });
  });

  it("shows the last pushed backup's times and restic snapshot ID", async () => {
    const db = openDb();
    addPerson(db);
    const app = createApp({ ...deps(db), backupConfigured: true });
    expect(await (await app.request("/api/system/backup", signedIn)).json()).toEqual({
      configured: true,
      last: null,
      stale: false,
      check: null,
      drill: null,
    });
    insertBackup(db, "A", "1".repeat(64), "2026-09-27T00:05:00.000Z");
    insertBackup(db, "B", "2".repeat(64), "2026-09-28T00:05:00.000Z");
    insertBackup(db, "C", null, null);
    expect(await (await app.request("/api/system/backup", signedIn)).json()).toEqual({
      configured: true,
      last: {
        snapshotId: "2".repeat(64),
        takenAt: "2026-09-27T00:00:00.000Z",
        pushedAt: "2026-09-28T00:05:00.000Z",
      },
      // The fixed clock is 2026-09-27: the last good backup is newer than that.
      stale: false,
      check: null,
      drill: null,
    });
  });

  it("warns when the last good backup is over 48 hours old, and shows the check and drill", async () => {
    const db = openDb();
    addPerson(db);
    insertBackup(db, "A", "1".repeat(64), "2026-09-27T00:05:00.000Z");
    const later = { ...deps(db), backupConfigured: true, clock: fixedClockAt("2026-09-30") };
    db.prepare(
      "INSERT INTO backup_verification (id, kind, at, ok, summary) VALUES ('V1', 'check', '2026-09-28T03:30:00.000Z', 0, 'restic check exited with 1')",
    ).run();
    db.prepare(
      "INSERT INTO backup_verification (id, kind, at, ok, summary) VALUES ('V2', 'drill', '2026-09-01T04:00:00.000Z', 1, 'restored and verified')",
    ).run();
    const body = await (await createApp(later).request("/api/system/backup", signedIn)).json();
    expect(body).toMatchObject({
      configured: true,
      stale: true,
      check: { ok: false, summary: "restic check exited with 1" },
      drill: { ok: true, summary: "restored and verified" },
    });
  });
});

describe("GET /healthz with a stale backup", () => {
  it("stays 200 and ready, with a warning in the body only when the backup is stale", async () => {
    const db = openDb();
    db.prepare(
      `INSERT INTO backup_snapshot (id, taken_at, schema_version, table_count, row_count,
         manifest_sha256, push_job_id, restic_snapshot_id, pushed_at, created_at, updated_at)
       VALUES ('A', '2026-09-27T00:00:00.000Z', 6, 10, 100, 'x', 'j', ?, '2026-09-27T00:05:00.000Z', 'x', 'x')`,
    ).run("1".repeat(64));
    const at = (day: string) => ({
      ...deps(db),
      backupConfigured: true,
      clock: fixedClockAt(day),
      healthz: {
        expectedSchemaVersion: MIGRATIONS,
        // The runner ticked just now by whichever fixed clock is used.
        runner: () => ({ ...ticking, lastTickAt: fixedClockAt(day).now().epochMilliseconds }),
      },
    });
    const fresh = await createApp(at("2026-09-28")).request("/healthz");
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ ok: true });
    const stale = await createApp(at("2026-09-30")).request("/healthz");
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ ok: true, warnings: ["backup-stale"] });
    // Not configured: never a warning.
    const off = await createApp({ ...at("2026-09-30"), backupConfigured: false }).request(
      "/healthz",
    );
    expect(await off.json()).toEqual({ ok: true });
  });
});

describe("the recovery bundle warning", () => {
  const A = "20261003T010203Z-a1b2";
  const B = "20261104T050607Z-c3d4";
  const confirm = (db: Db, bundleId: string) =>
    db
      .prepare(
        "INSERT OR REPLACE INTO recovery_bundle (id, bundle_id, confirmed_at) VALUES (1, ?, 'x')",
      )
      .run(bundleId);

  it("warns in /healthz while the bundle is unconfirmed, staying 200 and ok", async () => {
    const db = openDb();
    const res = await createApp({ ...deps(db), bundleId: A }).request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, warnings: ["recovery-bundle-unconfirmed"] });
  });

  it("stops warning once that id is confirmed, and warns again for a new bundle", async () => {
    const db = openDb();
    confirm(db, A);
    const confirmed = await createApp({ ...deps(db), bundleId: A }).request("/healthz");
    expect(await confirmed.json()).toEqual({ ok: true });
    const fresh = await createApp({ ...deps(db), bundleId: B }).request("/healthz");
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ ok: true, warnings: ["recovery-bundle-unconfirmed"] });
  });

  it("never warns without a bundle id (dev, CI)", async () => {
    const db = openDb();
    expect(await (await createApp(deps(db)).request("/healthz")).json()).toEqual({ ok: true });
  });

  it("keeps a failing check failing, with the warning beside it", async () => {
    const db = openDb();
    const app = createApp({
      ...deps(db),
      bundleId: A,
      healthz: { expectedSchemaVersion: MIGRATIONS, runner: () => undefined },
    });
    const res = await app.request("/healthz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      failing: ["jobs"],
      warnings: ["recovery-bundle-unconfirmed"],
    });
  });

  it("counts a failed read as unconfirmed", async () => {
    const db = openDb();
    const broken: UnitOfWork = {
      transaction: () => {
        throw new Error("SQLITE_IOERR");
      },
      read: () => {
        throw new Error("SQLITE_IOERR");
      },
    };
    const res = await createApp({ ...deps(db), uow: broken, bundleId: A }).request("/healthz");
    expect(await res.json()).toMatchObject({ warnings: ["recovery-bundle-unconfirmed"] });
  });

  it("GET /api/system/recovery-bundle needs a session", async () => {
    const db = openDb();
    addPerson(db);
    const res = await createApp({ ...deps(db), bundleId: A }).request(
      "/api/system/recovery-bundle",
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/system/recovery-bundle says whether the current id is confirmed", async () => {
    const db = openDb();
    addPerson(db);
    const app = createApp({ ...deps(db), bundleId: A });
    const before = await app.request("/api/system/recovery-bundle", signedIn);
    expect(before.status).toBe(200);
    expect(before.headers.get("cache-control")).toBe("no-store");
    expect(await before.json()).toEqual({ confirmed: false, bundleId: A });
    confirm(db, A);
    expect(await (await app.request("/api/system/recovery-bundle", signedIn)).json()).toEqual({
      confirmed: true,
      bundleId: A,
    });
    const none = await createApp(deps(db)).request("/api/system/recovery-bundle", signedIn);
    expect(await none.json()).toEqual({ confirmed: true });
  });
});

describe("session cookies", () => {
  const refreshed = "pangolin.session_token=new; Path=/; HttpOnly; Secure; SameSite=Strict";

  it("passes the gateway's refreshed cookie on, on success and on 401", async () => {
    const db = openDb();
    addPerson(db);
    const app = createApp(
      deps(db, { kind: "live", gateway: fakeGateway(new Date(), [refreshed]) }),
    );
    const ok = await app.request("/api/system/jobs", signedIn);
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie()).toEqual([refreshed]);
    db.prepare("DELETE FROM person").run();
    const refused = await app.request("/api/system/jobs", signedIn);
    expect(refused.status).toBe(401);
    expect(refused.headers.getSetCookie()).toEqual([refreshed]);
  });
});

describe("GET /api/identity/me", () => {
  it("describes the signed-in person", async () => {
    const db = openDb();
    addPerson(db);
    const createdAt = new Date("2026-09-27T00:00:00.000Z");
    const app = createApp(deps(db, { kind: "live", gateway: fakeGateway(createdAt) }));
    const res = await app.request("/api/identity/me", signedIn);
    expect(await res.json()).toEqual({
      personId: "01J0000000000000000000000A",
      displayName: "Alex",
      colour: "#2563eb",
      authAt: "2026-09-27T00:00:00.000Z",
      canInvite: true,
      recoveryCodes: { issued: false, remaining: 0 },
      partner: null,
      demo: false,
      enrolment: "complete",
      needs: [],
    });
  });

  it("refuses recovery in demo mode, which is read-only", async () => {
    const db = openDb();
    addPerson(db);
    const app = createApp(deps(db, { kind: "demo" }));
    for (const [path, body] of [
      ["/api/identity/recover", { email: "a@example.com", password: "x", code: "y" }],
      ["/api/identity/re-enrol", { token: "t", newPassword: "a long enough passphrase" }],
    ] as const) {
      const res = await app.request(path, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status, path).toBe(409);
    }
  });

  it("signs demo mode in as the first person, with no session", async () => {
    const db = openDb();
    addPerson(db);
    const res = await createApp(deps(db, { kind: "demo" })).request("/api/identity/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: "Alex", demo: true });
  });

  it("answers 401 in demo mode when nobody is seeded", async () => {
    const res = await createApp(deps(openDb(), { kind: "demo" })).request("/api/identity/me");
    expect(res.status).toBe(401);
  });
});

describe("/api/auth/*", () => {
  it("passes better-auth's routes to it, with no session and no /api 404", async () => {
    const res = await createApp(deps(openDb())).request("/api/auth/get-session");
    expect(await res.text()).toBe("auth:/api/auth/get-session");
  });

  it("refuses better-auth's own sign-up: sign-up needs a setup link", async () => {
    const res = await createApp(deps(openDb())).request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("is not mounted in demo mode", async () => {
    const res = await createApp(deps(openDb(), { kind: "demo" })).request("/api/auth/get-session");
    expect(res.status).toBe(404);
  });
});

describe("errors", () => {
  it("answers a throwing route with 500 Internal, without its message", async () => {
    const logged: unknown[] = [];
    const app = createApp({
      ...deps(openDb()),
      systemHealth: {
        schemaVersion: () => {
          throw new Error("SQLITE_CORRUPT: /data/pangolin.sqlite");
        },
        probeWrite: () => true,
      },
      logInternalError: (err) => logged.push(err),
    });
    const res = await app.request("/api/system/health");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "Internal", message: "Internal error" } });
    expect(text).not.toContain("SQLITE");
    expect(logged).toHaveLength(1);
  });
});

describe("static PWA", () => {
  function app() {
    return createApp({ ...deps(openDb()), webRoot });
  }

  function nonceOf(res: Response): string {
    const csp = res.headers.get("content-security-policy") ?? "";
    const match = /'nonce-([^']+)'/.exec(csp);
    if (match?.[1] === undefined) throw new Error(`no nonce in ${csp}`);
    return match[1];
  }

  it("serves index.html at / with a fresh CSP nonce, never cached", async () => {
    const first = await app().request("/");
    expect(first.status).toBe(200);
    const html = await first.text();
    expect(html).toContain("<title>Pangolin</title>");
    expect(html).not.toContain("__CSP_NONCE__");
    expect(html).toContain(`nonce="${nonceOf(first)}"`);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const second = await app().request("/");
    expect(nonceOf(second)).not.toBe(nonceOf(first));
  });

  it("serves /index.html the same way", async () => {
    const res = await app().request("/index.html");
    expect(await res.text()).toContain(`nonce="${nonceOf(res)}"`);
  });

  it("serves hashed assets as immutable", async () => {
    const res = await app().request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("returns 404, not the page shell, for a missing asset", async () => {
    const res = await app().request("/assets/gone-000000.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("falls back to index.html, with the CSP, for client routes", async () => {
    const res = await app().request("/setup?token=abc");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`nonce="${nonceOf(res)}"`);
  });

  it("does not fall back for unknown API routes", async () => {
    const res = await app().request("/api/nope", signedIn);
    expect(res.status).toBe(401);
    const db = openDb();
    addPerson(db);
    const authed = await createApp({ ...deps(db), webRoot }).request("/api/nope", signedIn);
    expect(authed.status).toBe(404);
    expect(await authed.json()).toEqual({ error: { code: "NotFound", message: "Not found" } });
  });
});
