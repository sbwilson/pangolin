import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  assertLoginAllowed,
  checkSignUp,
  completeSignUp,
  createIdGenerator,
  createPerson,
  ensureFirstSetupLink,
  firstPerson,
  fixedClock,
  type IdentityContext,
  personForUser,
  recordLoginAttempt,
  type TokenPort,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

let dir: string;
let db: Db;
let now: Temporal.Instant;

const tokens: TokenPort = {
  generate: (() => {
    let n = 0;
    return () => `token-${++n}`;
  })(),
  hash: (token) => createHash("sha256").update(token).digest("hex"),
};

function ctx(): IdentityContext {
  return {
    clock: {
      now: () => now,
      today: () => parseDate(now.toString().slice(0, 10)),
    },
    newId: createIdGenerator(),
    uow: createUnitOfWork(db),
    tokens,
  };
}

function insertUser(id: string, email: string): void {
  db.prepare(
    `INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 0, '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z')`,
  ).run(id, email, email);
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return undefined;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-identity-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  now = Temporal.Instant.from("2026-09-27T00:00:00Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function firstLink() {
  const first = ensureFirstSetupLink({ ...ctx(), viewer: systemViewer("cli:setup-link") });
  if (first.status !== "issued") throw new Error("no link issued");
  return first.link;
}

describe("setup links and sign-up on SQLite", () => {
  it("stores only the SHA-256 of the token and completes a sign-up once", () => {
    const link = firstLink();
    const stored = db.prepare("SELECT * FROM setup_link").get() as Record<string, unknown>;
    expect(stored).toMatchObject({
      token_hash: createHash("sha256").update(link.token).digest("hex"),
      issued_by: "cli",
      created_at: "2026-09-27T00:00:00.000Z",
      expires_at: "2026-09-28T00:00:00.000Z",
      used_at: null,
    });
    expect(JSON.stringify(stored)).not.toContain(link.token);

    checkSignUp(ctx(), { token: link.token });
    insertUser("user-a", "alex@example.com");
    const personId = completeSignUp(ctx(), {
      token: link.token,
      userId: "user-a",
      email: "alex@example.com",
      displayName: "Alex",
      colour: "#2563eb",
    });
    expect(personForUser(ctx(), "user-a")).toBe(personId);
    expect(personForUser(ctx(), "user-x")).toBeUndefined();
    expect(firstPerson(ctx())).toBe(personId);
    expect(db.prepare("SELECT used_at FROM setup_link").pluck().get()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
    const audit = db.prepare("SELECT actor, entity, action FROM audit_log ORDER BY id").all();
    expect(audit).toEqual([
      { actor: "cli:setup-link", entity: "setup_link", action: "create" },
      { actor: `person:${personId}`, entity: "user", action: "create" },
      { actor: `person:${personId}`, entity: "person", action: "create" },
      { actor: `person:${personId}`, entity: "setup_link", action: "use" },
    ]);
    expect(errorCode(() => checkSignUp(ctx(), { token: link.token }))).toBe("Validation");
  });

  it("refuses an expired link", () => {
    const link = firstLink();
    now = now.add({ hours: 24 });
    expect(errorCode(() => checkSignUp(ctx(), { token: link.token }))).toBe("Validation");
  });

  it("closes registration after two users, without touching the link", () => {
    const link = firstLink();
    insertUser("user-a", "a@example.com");
    insertUser("user-b", "b@example.com");
    expect(errorCode(() => checkSignUp(ctx(), { token: link.token }))).toBe("Conflict");
    insertUser("user-c", "c@example.com");
    expect(
      errorCode(() =>
        completeSignUp(ctx(), {
          token: link.token,
          userId: "user-c",
          email: "c@example.com",
          displayName: "C",
          colour: "#000000",
        }),
      ),
    ).toBe("Conflict");
    expect(db.prepare("SELECT used_at FROM setup_link").pluck().get()).toBeNull();
    expect(db.prepare("SELECT count(*) FROM person").pluck().get()).toBe(0);
  });

  it("issues no first link while one is live or once a user exists", () => {
    firstLink();
    const system = () => ({ ...ctx(), viewer: systemViewer("cli:setup-link") });
    expect(ensureFirstSetupLink(system())).toEqual({ status: "live" });
    expect(ensureFirstSetupLink(system(), { reissue: true }).status).toBe("issued");
    expect(
      db
        .prepare("SELECT count(*) FROM setup_link WHERE expires_at > ?")
        .pluck()
        .get("2026-09-27T00:00:00.000Z"),
    ).toBe(1);
    now = now.add({ hours: 25 });
    insertUser("user-a", "a@example.com");
    expect(ensureFirstSetupLink(system())).toEqual({ status: "closed" });
  });

  it("lists active people oldest first, skipping deleted ones", () => {
    const system = { ...ctx(), viewer: systemViewer("cli:test") };
    const first = createPerson(system, { displayName: "One", colour: "#000000" });
    now = now.add({ seconds: 1 });
    createPerson(
      { ...system, clock: fixedClock(parseDate("2026-09-27"), now) },
      {
        displayName: "Two",
        colour: "#000000",
      },
    );
    expect(firstPerson(ctx())).toBe(first);
    db.prepare("UPDATE person SET deleted_at = 'x' WHERE id = ?").run(first);
    expect(firstPerson(ctx())).not.toBe(first);
  });
});

describe("enrolment on SQLite", () => {
  it("reads the TOTP flag and counts passkeys", () => {
    const uow = createUnitOfWork(db);
    insertUser("user-a", "a@example.com");
    expect(uow.read((r) => r.users.enrolment("user-a"))).toEqual({ totp: false, passkeys: 0 });
    expect(uow.read((r) => r.users.enrolment("nobody"))).toBeUndefined();
    db.prepare("UPDATE auth_user SET two_factor_enabled = 1").run();
    db.prepare(
      `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
       VALUES ('pk', 'user-a', 'k', 'c', 0, 'singleDevice', 0)`,
    ).run();
    expect(uow.read((r) => r.users.enrolment("user-a"))).toEqual({ totp: true, passkeys: 1 });
  });
});

describe("login attempts on SQLite", () => {
  it("locks after five failures and prunes old rows", () => {
    for (let i = 0; i < 5; i++) recordLoginAttempt(ctx(), { email: "A@example.com", ok: false });
    expect(errorCode(() => assertLoginAllowed(ctx(), { email: "a@example.com" }))).toBe(
      "RateLimited",
    );
    expect(db.prepare("SELECT DISTINCT email, ok FROM login_attempt").all()).toEqual([
      { email: "a@example.com", ok: 0 },
    ]);
    now = now.add({ minutes: 31 });
    recordLoginAttempt(ctx(), { email: "b@example.com", ok: true });
    expect(db.prepare("SELECT email FROM login_attempt").pluck().all()).toEqual(["b@example.com"]);
    expect(db.prepare("SELECT count(*) FROM audit_log").pluck().get()).toBe(0);
  });
});
