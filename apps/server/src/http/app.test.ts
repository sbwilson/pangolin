import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAccount,
  createActivity,
  createCategory,
  createCategoryGroup,
  createIdGenerator,
  createPayee,
  createPayeeAlias,
  createPerson,
  createTag,
  createTransaction,
  createTransferGroup,
  deleteTransaction,
  fixedClockAt,
  hideTransactionName,
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
    expect(await res.json()).toEqual({ status: "ok", schemaVersion: 12, writable: true });
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

describe("/api/ledger/transactions/:id", () => {
  const alex = "01J0000000000000000000000A";
  const json = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: SESSION_COOKIE };

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
    const theirs = make("Sam private", true, [[sam, 10000]]);
    const theirTxn = createTransaction(sys, {
      accountId: theirs,
      postedOn: "2026-09-01",
      amountCents: -100,
      description: "sam only",
    });
    return { joint, theirs, theirTxn };
  }

  const send = (db: Db, method: string, path: string, body?: unknown, authn?: Authn) =>
    createApp(deps(db, authn)).request(path, {
      method,
      headers: json,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const line = (accountId: string) => ({
    accountId,
    postedOn: "2026-09-01",
    amountCents: -450,
    description: "Coffee",
  });

  it("creates, reads, edits and deletes a transaction", async () => {
    const db = openDb();
    const { joint } = seed(db);
    const first = await send(db, "POST", "/api/ledger/transactions", line(joint));
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const { transaction } = (await first.json()) as { transaction: { id: string } };
    // An identical manual line is allowed.
    expect((await send(db, "POST", "/api/ledger/transactions", line(joint))).status).toBe(201);
    const path = `/api/ledger/transactions/${transaction.id}`;
    const got = await send(db, "GET", path);
    expect(got.status).toBe(200);
    expect(got.headers.get("cache-control")).toBe("no-store");
    // The path id wins over a body id.
    const patched = await send(db, "PATCH", path, { id: "other", amountCents: -500, notes: "n" });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as {
      transaction: {
        id: string;
        amountCents: number;
        notes: string;
        splits: { amountCents: number }[];
      };
    };
    expect(body.transaction).toMatchObject({ id: transaction.id, amountCents: -500, notes: "n" });
    expect(body.transaction.splits[0]?.amountCents).toBe(-500);
    expect((await send(db, "PATCH", path, { bogus: 1 })).status).toBe(400);
    const del = await send(db, "DELETE", path);
    expect(del.status).toBe(204);
    expect(del.headers.get("cache-control")).toBe("no-store");
    expect((await send(db, "GET", path)).status).toBe(404);
    expect((await send(db, "DELETE", path)).status).toBe(404);
  });

  it("refuses line edits of an imported row, bad notes, and any use of a deleted row", async () => {
    const db = openDb();
    const { joint } = seed(db);
    const created = await send(db, "POST", "/api/ledger/transactions", line(joint));
    const { transaction } = (await created.json()) as { transaction: { id: string } };
    const path = `/api/ledger/transactions/${transaction.id}`;
    db.prepare("UPDATE \"transaction\" SET import_id = 'IMP' WHERE id = ?").run(transaction.id);
    expect((await send(db, "PATCH", path, { postedOn: "2026-09-02" })).status).toBe(409);
    expect((await send(db, "PATCH", path, { amountCents: -1 })).status).toBe(409);
    expect((await send(db, "PATCH", path, { notes: "fine" })).status).toBe(200);
    expect((await send(db, "PATCH", path, { notes: "x".repeat(1001) })).status).toBe(400);
    expect((await send(db, "DELETE", path)).status).toBe(204);
    expect((await send(db, "GET", path)).status).toBe(404);
    expect((await send(db, "PATCH", path, { notes: "again" })).status).toBe(404);
  });

  it("answers 404 to the partner on every route for a private-account transaction", async () => {
    const db = openDb();
    const { theirs, theirTxn } = seed(db);
    const path = `/api/ledger/transactions/${theirTxn}`;
    expect((await send(db, "GET", path)).status).toBe(404);
    expect((await send(db, "PATCH", path, { notes: "x" })).status).toBe(404);
    expect((await send(db, "DELETE", path)).status).toBe(404);
    expect((await send(db, "POST", "/api/ledger/transactions", line(theirs))).status).toBe(404);
    const row = db
      .prepare('SELECT deleted_at, notes FROM "transaction" WHERE id = ?')
      .get(theirTxn);
    expect(row).toEqual({ deleted_at: null, notes: null });
  });

  it("answers 403 and changes nothing when the session is older than the window", async () => {
    const db = openDb();
    const { joint } = seed(db);
    const created = await send(db, "POST", "/api/ledger/transactions", line(joint));
    const { transaction } = (await created.json()) as { transaction: { id: string } };
    const stale: Authn = {
      kind: "live",
      gateway: fakeGateway(new Date("2026-09-26T00:00:00Z")),
    };
    const res = await send(
      db,
      "DELETE",
      `/api/ledger/transactions/${transaction.id}`,
      undefined,
      stale,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ReauthRequired");
    expect(
      db.prepare('SELECT deleted_at FROM "transaction" WHERE id = ?').pluck().get(transaction.id),
    ).toBeNull();
  });

  it("is read-only in demo mode", async () => {
    const db = openDb();
    const { joint, theirTxn } = seed(db);
    const demo: Authn = { kind: "demo" };
    const writes: [string, string, unknown][] = [
      ["POST", "/api/ledger/transactions", line(joint)],
      ["PATCH", `/api/ledger/transactions/${theirTxn}`, { notes: "x" }],
      ["DELETE", `/api/ledger/transactions/${theirTxn}`, undefined],
    ];
    for (const [method, path, body] of writes) {
      expect((await send(db, method, path, body, demo)).status, `${method} ${path}`).toBe(409);
    }
  });
});

describe("name hiding and transfer groups", () => {
  const alex = "01J0000000000000000000000A";
  const json = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: SESSION_COOKIE };
  const send = (db: Db, method: string, path: string, body?: unknown, authn?: Authn) =>
    createApp(deps(db, authn)).request(path, {
      method,
      headers: json,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

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
    const joint2 = make("Joint 2", false, [
      [alex, 5000],
      [sam, 5000],
    ]);
    const theirs = make("Sam private", true, [[sam, 10000]]);
    const line = (accountId: string, amountCents: number, description: string) =>
      createTransaction(sys, { accountId, postedOn: "2026-09-01", amountCents, description });
    return {
      sys,
      sam,
      mine: line(joint, -500, "Mine"),
      other: line(joint2, 500, "Other"),
      theirTxn: line(theirs, -100, "sam only"),
    };
  }

  it("hides and unhides a name, validating the day", async () => {
    const db = openDb();
    const { mine } = seed(db);
    const path = `/api/ledger/transactions/${mine}/name-hidden`;
    const put = await send(db, "PUT", path, { until: "2026-12-01" });
    expect(put.status).toBe(200);
    expect(put.headers.get("cache-control")).toBe("no-store");
    expect(
      db.prepare('SELECT name_hidden_until FROM "transaction" WHERE id = ?').pluck().get(mine),
    ).toBe("2026-12-01");
    expect((await send(db, "PUT", path, { until: "2028-01-01" })).status).toBe(400);
    expect((await send(db, "PUT", path, { until: "2026-09-27" })).status).toBe(400);
    expect((await send(db, "PUT", path, { bogus: 1 })).status).toBe(400);
    expect((await send(db, "PUT", path)).status).toBe(200);
    const del = await send(db, "DELETE", path);
    expect(del.status).toBe(200);
    expect(
      db.prepare('SELECT name_hidden_by FROM "transaction" WHERE id = ?').pluck().get(mine),
    ).toBeNull();
  });

  it("refuses the viewer while the partner's hiding is active, and 404s a partner-private row", async () => {
    const db = openDb();
    const { mine, sam, theirTxn } = seed(db);
    db.prepare(
      'UPDATE "transaction" SET name_hidden_by = ?, name_hidden_until = ? WHERE id = ?',
    ).run(sam, "2027-01-01", mine);
    const path = `/api/ledger/transactions/${mine}/name-hidden`;
    expect((await send(db, "PUT", path, {})).status).toBe(409);
    expect((await send(db, "DELETE", path)).status).toBe(409);
    const theirs = `/api/ledger/transactions/${theirTxn}/name-hidden`;
    expect((await send(db, "PUT", theirs, {})).status).toBe(404);
    expect((await send(db, "DELETE", theirs)).status).toBe(404);
  });

  it("creates and deletes a transfer group", async () => {
    const db = openDb();
    const { mine, other, theirTxn } = seed(db);
    expect(
      (await send(db, "POST", "/api/ledger/transfer-groups", { transactionIds: [mine] })).status,
    ).toBe(400);
    expect(
      (await send(db, "POST", "/api/ledger/transfer-groups", { transactionIds: [mine, theirTxn] }))
        .status,
    ).toBe(404);
    const made = await send(db, "POST", "/api/ledger/transfer-groups", {
      transactionIds: [mine, other],
    });
    expect(made.status).toBe(201);
    expect(made.headers.get("cache-control")).toBe("no-store");
    const { transactions } = (await made.json()) as { transactions: { transferGroupId: string }[] };
    expect(transactions).toHaveLength(2);
    expect(
      (await send(db, "POST", "/api/ledger/transfer-groups", { transactionIds: [mine, other] }))
        .status,
    ).toBe(409);
    const id = transactions[0]?.transferGroupId;
    const del = await send(db, "DELETE", `/api/ledger/transfer-groups/${id}`);
    expect(del.status).toBe(204);
    expect(del.headers.get("cache-control")).toBe("no-store");
    expect((await send(db, "DELETE", `/api/ledger/transfer-groups/${id}`)).status).toBe(404);
  });

  it("shows the viewer the partner's hidden name and transfer label only", async () => {
    const db = openDb();
    const { sys, sam, mine, other } = seed(db);
    const d = deps(db);
    const asSam: UseCaseContext = {
      viewer: personViewer(sam, d.clock.now()),
      clock: d.clock,
      newId: d.newId,
      uow: d.uow,
    };
    const samPrivate = createAccount(asSam, {
      name: "Sam savings",
      type: "savings",
      currency: "AUD",
      isPrivate: true,
      owners: [{ personId: sam, shareBp: 10000 }],
    });
    const secret = createTransaction(asSam, {
      accountId: samPrivate,
      postedOn: "2026-09-01",
      amountCents: -500,
      description: "Secret savings",
    });
    expect(sys).toBeDefined();
    hideTransactionName(asSam, { id: mine });
    createTransferGroup(asSam, { transactionIds: [other, secret] });
    const hidden = await send(db, "GET", `/api/ledger/transactions/${mine}`);
    const hiddenBody = (await hidden.json()) as { transaction: { descriptionRaw: string } };
    expect(hiddenBody.transaction.descriptionRaw).toBe("Hidden until 27 Sep 2027");
    const linked = await send(db, "GET", `/api/ledger/transactions/${other}`);
    const linkedBody = (await linked.json()) as { transaction: { transferLabel: string } };
    expect(linkedBody.transaction.transferLabel).toBe("Transfer from Sam");
    const list = JSON.stringify(await (await send(db, "GET", "/api/ledger/transactions")).json());
    expect(list).not.toContain("Secret savings");
    expect(list).not.toContain("Sam savings");
    expect(list).not.toContain(secret);
    expect(list).not.toContain("Mine");
    expect((await send(db, "GET", `/api/ledger/transactions/${secret}`)).status).toBe(404);
    // Unhide on a transaction with no hiding is a 200 no-op.
    const noop = await send(db, "DELETE", `/api/ledger/transactions/${other}/name-hidden`);
    expect(noop.status).toBe(200);
  });

  it("answers 404 to a group delete that reaches the partner's private row, and leaves it linked", async () => {
    const db = openDb();
    const { sys, sam, mine, other } = seed(db);
    const d = deps(db);
    const asSam: UseCaseContext = { ...sys, viewer: personViewer(sam, d.clock.now()) };
    const samPrivate = createAccount(asSam, {
      name: "Sam savings",
      type: "savings",
      currency: "AUD",
      isPrivate: true,
      owners: [{ personId: sam, shareBp: 10000 }],
    });
    const secret = createTransaction(asSam, {
      accountId: samPrivate,
      postedOn: "2026-09-01",
      amountCents: -500,
      description: "Secret savings",
    });
    const [first] = createTransferGroup(asSam, { transactionIds: [other, secret] });
    const groupId = first.transferGroupId as string;
    const res = await send(db, "DELETE", `/api/ledger/transfer-groups/${groupId}`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("NotFound");
    expect(body).not.toContain("Secret savings");
    expect(body).not.toContain(secret);
    const missing = await send(db, "DELETE", "/api/ledger/transfer-groups/nope");
    expect(await missing.text()).toBe(body);
    expect(
      db.prepare('SELECT transfer_group_id FROM "transaction" WHERE id = ?').pluck().get(secret),
    ).toBe(groupId);
    expect(mine).toBeDefined();
  });

  it("answers 400 to a hide by a non-owner of a public account", async () => {
    const db = openDb();
    const { sys, sam } = seed(db);
    const samPublic = createAccount(sys, {
      name: "Sam only, public",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: sam, shareBp: 10000 }],
    });
    const id = createTransaction(sys, {
      accountId: samPublic,
      postedOn: "2026-09-01",
      amountCents: -500,
      description: "Gift",
    });
    const res = await send(db, "PUT", `/api/ledger/transactions/${id}/name-hidden`, {});
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Only an owner of the account can hide a name");
    expect(
      db.prepare('SELECT name_hidden_by FROM "transaction" WHERE id = ?').pluck().get(id),
    ).toBeNull();
  });

  it("answers 409 to a scoped activity on a shared split, and 400 to a property", async () => {
    const db = openDb();
    const { sys, mine } = seed(db);
    const d = deps(db);
    const asAlex: UseCaseContext = { ...sys, viewer: personViewer(alex as never, d.clock.now()) };
    const alexPrivate = createAccount(asAlex, {
      name: "Alex private",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      owners: [{ personId: alex, shareBp: 10000 }],
    });
    const activity = createActivity(asAlex, { name: "Trip", originAccountId: alexPrivate }).id;
    const splitId = db
      .prepare("SELECT id FROM split WHERE transaction_id = ?")
      .pluck()
      .get(mine) as string;
    const audits = db.prepare("SELECT count(*) FROM audit_log").pluck().get();
    const patch = await send(db, "PATCH", `/api/ledger/transactions/${mine}/splits/${splitId}`, {
      field: "activity",
      value: activity,
    });
    expect(patch.status).toBe(409);
    expect(await patch.text()).toContain("This activity cannot be used on a shared account yet");
    const put = await send(db, "PUT", `/api/ledger/transactions/${mine}/splits`, {
      splits: [{ amountCents: -500, activityId: activity }],
    });
    expect(put.status).toBe(409);
    const prop = await send(db, "PUT", `/api/ledger/transactions/${mine}/splits`, {
      splits: [{ amountCents: -500, propertyId: "01J0000000000000000000PROP" }],
    });
    expect(prop.status).toBe(400);
    expect(db.prepare("SELECT count(*) FROM audit_log").pluck().get()).toBe(audits);
    expect(
      db.prepare("SELECT count(*) FROM split WHERE activity_id IS NOT NULL").pluck().get(),
    ).toBe(0);
  });

  it("is read-only in demo mode", async () => {
    const db = openDb();
    const { mine, other } = seed(db);
    const demo: Authn = { kind: "demo" };
    const writes: [string, string, unknown][] = [
      ["PUT", `/api/ledger/transactions/${mine}/name-hidden`, {}],
      ["DELETE", `/api/ledger/transactions/${mine}/name-hidden`, undefined],
      ["POST", "/api/ledger/transfer-groups", { transactionIds: [mine, other] }],
      ["DELETE", "/api/ledger/transfer-groups/x", undefined],
    ];
    for (const [method, path, body] of writes) {
      expect((await send(db, method, path, body, demo)).status, `${method} ${path}`).toBe(409);
    }
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

  it("lets either person share a public account and change who is on it (the I/O matrix)", async () => {
    const db = openDb();
    const { joint, sam, mine, sys } = seed(db);
    type Body = { error: { code: string; message: string } };
    type Account = {
      owners: { personId: string; shareBp: number }[];
      pool: string;
      removal?: { by: string; at: string; previousOwners: { personId: string; shareBp: number }[] };
    };
    const owners = (id: string) =>
      db
        .prepare("SELECT person_id FROM account_owner WHERE account_id = ? ORDER BY person_id")
        .pluck()
        .all(id);
    const make = (name: string, who: string) =>
      createAccount(sys, {
        name,
        type: "transaction",
        currency: "AUD",
        isPrivate: false,
        owners: [{ personId: who, shareBp: 10000 }],
      });
    const two = (first: string, second: string) => [
      { personId: first, shareBp: 5000 },
      { personId: second, shareBp: 5000 },
    ];
    const get = async (id: string) =>
      ((await (await send(db, "GET", `/api/accounts/${id}`)).json()) as { account: Account })
        .account;

    // Share: an owner adds the other person; the audit row carries both lists.
    const own = make("Alex only", alex);
    const share = await send(db, "PATCH", `/api/accounts/${own}`, { owners: two(alex, sam) });
    expect(share.status).toBe(200);
    expect(owners(own)).toEqual([alex, sam]);
    const row = db
      .prepare(
        "SELECT before, after FROM audit_log WHERE account_id = ? AND action = 'update' ORDER BY at DESC, id DESC",
      )
      .get(own) as { before: string; after: string };
    const listed = (json: string) =>
      (JSON.parse(json) as Account).owners.map((o) => ({
        personId: o.personId,
        shareBp: o.shareBp,
      }));
    expect(listed(row.before)).toEqual([{ personId: alex, shareBp: 10000 }]);
    expect(listed(row.after)).toEqual(two(alex, sam));

    // Join: a non-owner adds themself to a sole-owner public account.
    const theirs = make("Sam only", sam);
    expect(
      (await send(db, "PATCH", `/api/accounts/${theirs}`, { owners: two(sam, alex) })).status,
    ).toBe(200);
    expect(owners(theirs)).toEqual([alex, sam]);

    // Takeover try: a non-owner who drops the owner, or who adds only themself, is refused.
    const target = make("Sam again", sam);
    const takeover = await send(db, "PATCH", `/api/accounts/${target}`, {
      owners: [{ personId: alex, shareBp: 10000 }],
    });
    expect(takeover.status).toBe(400);
    expect((await takeover.json()) as Body).toEqual({
      error: {
        code: "Validation",
        message: "Add yourself to the current owners: you cannot change who else owns this account",
      },
    });
    expect(owners(target)).toEqual([sam]);

    // Remove other: an owner drops the other person from a shared account.
    expect(
      (
        await send(db, "PATCH", `/api/accounts/${joint}`, {
          owners: [{ personId: alex, shareBp: 10000 }],
        })
      ).status,
    ).toBe(200);
    expect(owners(joint)).toEqual([alex]);

    // Leave, then read the marker and rejoin (Alex was on `theirs` at 50%).
    const leave = await send(db, "PATCH", `/api/accounts/${theirs}`, {
      owners: [{ personId: sam, shareBp: 10000 }],
    });
    expect(leave.status).toBe(200);
    const left = await get(theirs);
    expect(left.owners).toEqual([{ personId: sam, shareBp: 10000 }]);
    expect(left.removal).toMatchObject({
      by: alex,
      previousOwners: expect.arrayContaining(two(sam, alex)),
    });
    expect(
      (
        (await (await send(db, "GET", "/api/accounts")).json()) as {
          accounts: (Account & { id: string })[];
        }
      ).accounts.find((a) => a.id === theirs)?.removal?.by,
    ).toBe(alex);
    const back = await send(db, "POST", `/api/accounts/${theirs}/rejoin`);
    expect(back.status).toBe(200);
    const rejoined = ((await back.json()) as { account: Account }).account;
    expect(rejoined.owners).toHaveLength(2);
    expect(rejoined.owners).toEqual(expect.arrayContaining(two(sam, alex)));
    expect(rejoined.removal).toBeUndefined();
    expect((await get(theirs)).removal).toBeUndefined();

    // Rejoin when already an owner, and for an account the person was never removed from.
    for (const id of [theirs, own]) {
      const again = await send(db, "POST", `/api/accounts/${id}/rejoin`);
      expect(again.status).toBe(400);
    }
    const never = await send(db, "POST", `/api/accounts/${make("Sam third", sam)}/rejoin`);
    expect(never.status).toBe(400);
    expect((await never.json()) as Body).toEqual({
      error: { code: "Validation", message: "You were not removed from this account" },
    });

    // Empty, and a private account's owners.
    expect((await send(db, "PATCH", `/api/accounts/${own}`, { owners: [] })).status).toBe(400);
    expect(
      (await send(db, "PATCH", `/api/accounts/${mine}`, { owners: two(alex, sam) })).status,
    ).toBe(400);
    expect(
      (
        await send(db, "PATCH", `/api/accounts/${mine}`, {
          owners: [{ personId: sam, shareBp: 10000 }],
        })
      ).status,
    ).toBe(400);
  });

  it("guards both privacy switches with Conflict bodies", async () => {
    const db = openDb();
    const { mine, sys } = seed(db);
    type Body = { error: { code: string; message: string; details?: unknown } };
    const solo = createAccount(sys, {
      name: "Solo",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: alex, shareBp: 10000 }],
    });
    createTransaction(sys, {
      accountId: solo,
      postedOn: "2026-09-01",
      amountCents: -1,
      description: "s",
    });
    const toPrivate = await send(db, "POST", `/api/accounts/${solo}/privacy`, { isPrivate: true });
    expect(toPrivate.status).toBe(409);
    expect(((await toPrivate.json()) as Body).error.code).toBe("Conflict");

    const payee = createPayee(sys, { name: "Chemist", originAccountId: mine });
    const used = createTransaction(sys, {
      accountId: mine,
      postedOn: "2026-09-01",
      amountCents: -1,
      description: "p",
      payeeId: payee.id,
    });
    const toPublic = await send(db, "POST", `/api/accounts/${mine}/privacy`, { isPrivate: false });
    expect(toPublic.status).toBe(409);
    const body = (await toPublic.json()) as Body;
    expect(body.error.code).toBe("Conflict");
    expect(body.error.message).toContain('payee "Chemist"');
    expect(body.error.details).toEqual({
      payees: [{ id: payee.id, name: "Chemist" }],
      tags: [],
      activities: [],
      owners: [{ personId: alex, displayName: "Alex" }],
    });
    deleteTransaction(sys, { id: used });
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
      viewer: personViewer(sam, sys.clock.now()),
    };
    const payee = createPayee(samCtx, { name: "Secret", originAccountId: theirs });
    const tag = createTag(samCtx, { name: "secret", originAccountId: theirs });
    const alias = createPayeeAlias(samCtx, {
      payeeId: payee.id,
      pattern: "secret",
      matchKind: "prefix",
      originAccountId: theirs,
    });
    const activity = createActivity(samCtx, { name: "Secret trip", originAccountId: theirs });
    const calls: [string, string, unknown?][] = [
      ["GET", `/api/classify/payees/${payee.id}`],
      ["PATCH", `/api/classify/payees/${payee.id}`, { name: "x" }],
      ["DELETE", `/api/classify/payees/${payee.id}`],
      ["GET", `/api/classify/tags/${tag.id}`],
      ["PATCH", `/api/classify/tags/${tag.id}`, { name: "x" }],
      ["DELETE", `/api/classify/tags/${tag.id}`],
      ["GET", `/api/classify/payees/aliases/${alias.id}`],
      ["PATCH", `/api/classify/payees/aliases/${alias.id}`, { matchKind: "exact" }],
      ["DELETE", `/api/classify/payees/aliases/${alias.id}`],
      ["GET", `/api/classify/activities/${activity.id}`],
      ["PATCH", `/api/classify/activities/${activity.id}`, { name: "x" }],
      ["DELETE", `/api/classify/activities/${activity.id}`],
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
      viewer: personViewer(sam, sys.clock.now()),
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
      `INSERT INTO backup_snapshot (id, taken_at, schema_version, push_job_id,
         restic_snapshot_id, pushed_at, created_at, updated_at)
       VALUES (?, '2026-09-27T00:00:00.000Z', 6, 'j', ?, ?, 'x', 'x')`,
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
      `INSERT INTO backup_snapshot (id, taken_at, schema_version, push_job_id,
         restic_snapshot_id, pushed_at, created_at, updated_at)
       VALUES ('A', '2026-09-27T00:00:00.000Z', 6, 'j', ?, '2026-09-27T00:05:00.000Z', 'x', 'x')`,
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

describe("Cache-Control on every /api response", () => {
  const routes: [string, string, number][] = [
    ["person data", "/api/identity/me", 200],
    ["person data", "/api/ledger/transactions", 200],
    ["person data", "/api/accounts", 200],
    ["person data", "/api/classify/payees", 200],
    ["person data", "/api/identity/notices", 200],
    ["an error (404)", "/api/ledger/transactions/missing", 404],
    ["an unknown route (404)", "/api/nothing-here", 404],
    ["better-auth's passthrough", "/api/auth/get-session", 200],
  ];
  it.each(routes)("%s: GET %s answers %i with no-store", async (_what, path, status) => {
    const db = openDb();
    addPerson(db);
    const res = await createApp(deps(db)).request(path, {
      headers: { Origin: ORIGIN, Cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a malformed write (400) with no-store", async () => {
    const db = openDb();
    addPerson(db);
    const res = await createApp(deps(db)).request("/api/ledger/transactions", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: SESSION_COOKIE, "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
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

describe("/api/ledger/transactions/:id/splits", () => {
  const alex = "01J0000000000000000000000A";
  const json = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: SESSION_COOKIE };

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
    const theirs = make("Sam private", true, [[sam, 10000]]);
    const alexPrivate = make("Alex private", true, [[alex, 10000]]);
    const txn = (accountId: string, amountCents: number) =>
      createTransaction(sys, {
        accountId,
        postedOn: "2026-09-01",
        amountCents,
        description: "shop",
      });
    const group = createCategoryGroup(sys, { name: "Living", kind: "expense" });
    const category = createCategory(sys, { groupId: group.id, name: "Food" }).id;
    const tag = createTag(sys, { name: "holiday" }).id;
    const scopedTag = createTag(sys, { name: "alex only", originAccountId: alexPrivate }).id;
    return {
      joint,
      theirs,
      sam,
      mine: txn(joint, -1000),
      myPrivate: txn(alexPrivate, -300),
      theirTxn: txn(theirs, -100),
      category,
      tag,
      scopedTag,
    };
  }

  const send = (db: Db, method: string, path: string, body?: unknown, authn?: Authn) =>
    createApp(deps(db, authn)).request(path, {
      method,
      headers: json,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  type Body = {
    transaction: {
      remainingCents: number;
      splits: { id: string; amountCents: number; categorySource: string | null; tags: unknown[] }[];
    };
    remainingCents?: number;
    applied?: boolean;
    error?: { code: string; details?: unknown };
  };

  it("replaces splits and answers Validation with remainingCents when they do not add up", async () => {
    const db = openDb();
    const { mine } = seed(db);
    const path = `/api/ledger/transactions/${mine}/splits`;
    const ok = await send(db, "PUT", path, {
      splits: [{ amountCents: -600 }, { amountCents: -400 }],
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = (await ok.json()) as Body;
    expect(body.transaction.remainingCents).toBe(0);
    expect(body).not.toHaveProperty("remainingCents");
    expect(body.transaction.splits).toHaveLength(2);
    const bad = await send(db, "PUT", path, { splits: [{ amountCents: -600 }] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Body).error).toMatchObject({
      code: "Validation",
      details: { remainingCents: -400 },
    });
    expect(
      db.prepare("SELECT count(*) FROM split WHERE transaction_id = ?").pluck().get(mine),
    ).toBe(2);
    // The path id wins over a body id, and unknown keys are refused.
    expect(
      (await send(db, "PUT", path, { transactionId: "x", splits: [{ amountCents: -1000 }] }))
        .status,
    ).toBe(200);
    expect(
      (await send(db, "PUT", path, { splits: [{ amountCents: -1000, bogus: 1 }] })).status,
    ).toBe(400);
    const got = (await (await send(db, "GET", `/api/ledger/transactions/${mine}`)).json()) as Body;
    expect(got.transaction.remainingCents).toBe(0);
  });

  it("sets a field as user, forcing the source and refusing a client-supplied one", async () => {
    const db = openDb();
    const { mine, category } = seed(db);
    const read = (await (await send(db, "GET", `/api/ledger/transactions/${mine}`)).json()) as Body;
    const split = read.transaction.splits[0]?.id as string;
    const path = `/api/ledger/transactions/${mine}/splits/${split}`;
    const ok = await send(db, "PATCH", path, { field: "category", value: category });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Body).applied).toBe(true);
    expect(db.prepare("SELECT category_source FROM split WHERE id = ?").pluck().get(split)).toBe(
      "user",
    );
    for (const source of ["rule", "user", "llm"]) {
      const res = await send(db, "PATCH", path, { field: "category", value: null, source });
      expect(res.status, source).toBe(400);
    }
    expect(db.prepare("SELECT category_id FROM split WHERE id = ?").pluck().get(split)).toBe(
      category,
    );
    expect((await send(db, "PATCH", path, { field: "category", value: null })).status).toBe(200);
    expect((await send(db, "PATCH", path, { field: "category", value: "nope" })).status).toBe(404);
    expect((await send(db, "PATCH", path, { field: "bogus", value: 1 })).status).toBe(400);
  });

  it("lists remainingCents and per-split tags", async () => {
    const db = openDb();
    const { mine, tag } = seed(db);
    const read = (await (await send(db, "GET", `/api/ledger/transactions/${mine}`)).json()) as Body;
    const split = read.transaction.splits[0]?.id as string;
    await send(db, "PUT", `/api/ledger/transactions/${mine}/splits/${split}/tags`, {
      tagIds: [tag],
    });
    const list = (await (await send(db, "GET", "/api/ledger/transactions")).json()) as {
      transactions: (Body["transaction"] & { id: string })[];
    };
    const row = list.transactions.find((x) => x.id === mine);
    expect(row?.remainingCents).toBe(0);
    expect(row?.splits[0]?.tags).toHaveLength(1);
  });

  it("sets a beneficiary, refuses a non-owner in a private account, and refuses clearing it", async () => {
    const db = openDb();
    const { mine, myPrivate, sam } = seed(db);
    const splitOf = (id: string) =>
      db.prepare("SELECT id FROM split WHERE transaction_id = ?").pluck().get(id);
    const shared = `/api/ledger/transactions/${mine}/splits/${splitOf(mine)}`;
    const ok = await send(db, "PATCH", shared, { field: "beneficiary", value: sam });
    expect(ok.status).toBe(200);
    expect(
      db
        .prepare("SELECT beneficiary, beneficiary_source FROM split WHERE id = ?")
        .get(splitOf(mine)),
    ).toEqual({
      beneficiary: sam,
      beneficiary_source: "user",
    });
    expect((await send(db, "PATCH", shared, { field: "beneficiary", value: null })).status).toBe(
      400,
    );
    const priv = `/api/ledger/transactions/${myPrivate}/splits/${splitOf(myPrivate)}`;
    expect((await send(db, "PATCH", priv, { field: "beneficiary", value: sam })).status).toBe(400);
    expect((await send(db, "PATCH", priv, { field: "beneficiary", value: "shared" })).status).toBe(
      400,
    );
    expect((await send(db, "PATCH", priv, { field: "beneficiary", value: alex })).status).toBe(200);
  });

  it("answers 409 for an owner-scoped tag on a split in a public account", async () => {
    const db = openDb();
    const { mine, myPrivate, scopedTag } = seed(db);
    const splitOf = (id: string) =>
      db.prepare("SELECT id FROM split WHERE transaction_id = ?").pluck().get(id);
    const res = await send(
      db,
      "PUT",
      `/api/ledger/transactions/${mine}/splits/${splitOf(mine)}/tags`,
      {
        tagIds: [scopedTag],
      },
    );
    expect(res.status).toBe(409);
    expect(db.prepare("SELECT count(*) FROM split_tag").pluck().get()).toBe(0);
    const ok = await send(
      db,
      "PUT",
      `/api/ledger/transactions/${myPrivate}/splits/${splitOf(myPrivate)}/tags`,
      {
        tagIds: [scopedTag],
      },
    );
    expect(ok.status).toBe(200);
  });

  it("replaces a split's tags", async () => {
    const db = openDb();
    const { mine, tag } = seed(db);
    const read = (await (await send(db, "GET", `/api/ledger/transactions/${mine}`)).json()) as Body;
    const split = read.transaction.splits[0]?.id as string;
    const path = `/api/ledger/transactions/${mine}/splits/${split}/tags`;
    const res = await send(db, "PUT", path, { tagIds: [tag] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).transaction.splits[0]?.tags).toHaveLength(1);
    expect((await send(db, "PUT", path, { tagIds: ["nope"] })).status).toBe(404);
    expect((await send(db, "PUT", path, { tagIds: [] })).status).toBe(200);
    expect(db.prepare("SELECT count(*) FROM split_tag").pluck().get()).toBe(0);
  });

  it("answers 404 to the partner on every new route for a private-account transaction", async () => {
    const db = openDb();
    const { theirTxn, tag } = seed(db);
    const sid = db.prepare("SELECT id FROM split WHERE transaction_id = ?").pluck().get(theirTxn);
    const base = `/api/ledger/transactions/${theirTxn}/splits`;
    expect((await send(db, "PUT", base, { splits: [{ amountCents: -100 }] })).status).toBe(404);
    expect(
      (await send(db, "PATCH", `${base}/${sid}`, { field: "category", value: null })).status,
    ).toBe(404);
    expect((await send(db, "PUT", `${base}/${sid}/tags`, { tagIds: [tag] })).status).toBe(404);
    expect(db.prepare("SELECT count(*) FROM split_tag").pluck().get()).toBe(0);
    expect(
      db.prepare("SELECT category_source FROM split WHERE id = ?").pluck().get(sid),
    ).toBeNull();
  });

  it("is read-only in demo mode", async () => {
    const db = openDb();
    const { mine, tag } = seed(db);
    const sid = db.prepare("SELECT id FROM split WHERE transaction_id = ?").pluck().get(mine);
    const base = `/api/ledger/transactions/${mine}/splits`;
    const demo: Authn = { kind: "demo" };
    const writes: [string, string, unknown][] = [
      ["PUT", base, { splits: [{ amountCents: -1000 }] }],
      ["PATCH", `${base}/${sid}`, { field: "category", value: null }],
      ["PUT", `${base}/${sid}/tags`, { tagIds: [tag] }],
    ];
    for (const [method, path, body] of writes) {
      expect((await send(db, method, path, body, demo)).status, `${method} ${path}`).toBe(409);
    }
  });
});
