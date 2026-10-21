import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdGenerator, fixedClockAt, type UnitOfWork } from "@pangolin/app";
import { fakeAttachmentStore } from "@pangolin/app/testing/attachment-store";
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

const MIGRATIONS = loadMigrations(packageMigrationsDir).length;
const ticking = {
  running: true,
  lastTickAt: fixedClockAt("2026-09-27").now().epochMilliseconds,
  pollMs: 1000,
};

function deps(db: Db, authn: Authn = { kind: "live", gateway: fakeGateway() }): AppDeps {
  const uow: UnitOfWork = createUnitOfWork(db);
  return {
    systemHealth: createSystemHealthRepo(db),
    uow,
    clock: fixedClockAt("2026-09-27"),
    newId: createIdGenerator(),
    tokens: nodeTokens,
    codes: recoveryCodeHasher("test-secret"),
    attachments: fakeAttachmentStore(),
    publicUrl: ORIGIN,
    authn,
    healthz: { expectedSchemaVersion: MIGRATIONS, runner: () => ticking },
    webRoot,
  };
}

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
  dir = mkdtempSync(join(tmpdir(), "pangolin-prefs-"));
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

describe("/api/identity/preferences", () => {
  describe("GET /api/identity/preferences", () => {
    it("returns default preferences { theme: 'clay-linen', mode: 'system' } when uninitialized", async () => {
      const db = openDb();
      addPerson(db);
      const app = createApp(deps(db));

      const res = await app.request("/api/identity/preferences", signedIn);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ theme: "clay-linen", mode: "system" });
    });

    it("returns existing preferences when set in database", async () => {
      const db = openDb();
      addPerson(db);
      db.prepare(
        `INSERT INTO person_preference (person_id, theme, mode, created_at, updated_at)
         VALUES ('01J0000000000000000000000A', 'fern-gully', 'dark', '2026-09-27T00:00:00Z', '2026-09-27T00:00:00Z')`,
      ).run();
      const app = createApp(deps(db));

      const res = await app.request("/api/identity/preferences", signedIn);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ theme: "fern-gully", mode: "dark" });
    });

    it("returns 401 Unauthenticated when request is not signed in", async () => {
      const db = openDb();
      addPerson(db);
      const app = createApp(deps(db));

      const res = await app.request("/api/identity/preferences");
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("Unauthenticated");
    });
  });

  describe("PUT /api/identity/preferences", () => {
    it("updates preferences, writes row, and records audit log", async () => {
      const db = openDb();
      addPerson(db);
      const app = createApp(deps(db));

      const res = await app.request("/api/identity/preferences", {
        method: "PUT",
        headers: {
          Cookie: SESSION_COOKIE,
          "Content-Type": "application/json",
          Origin: ORIGIN,
        },
        body: JSON.stringify({ theme: "harbour-morning", mode: "dark" }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ theme: "harbour-morning", mode: "dark" });

      const row = db
        .prepare("SELECT * FROM person_preference WHERE person_id = '01J0000000000000000000000A'")
        .get() as { theme: string; mode: string };
      expect(row.theme).toBe("harbour-morning");
      expect(row.mode).toBe("dark");

      const audit = db
        .prepare(
          "SELECT * FROM audit_log WHERE entity = 'person_preference' AND entity_id = '01J0000000000000000000000A'",
        )
        .get() as { action: string; before: string | null; after: string };
      expect(audit.action).toBe("update");
      expect(audit.before).toBeNull();
      expect(JSON.parse(audit.after)).toEqual({ theme: "harbour-morning", mode: "dark" });
    });

    it("supports partial update keeping previous theme/mode", async () => {
      const db = openDb();
      addPerson(db);
      const app = createApp(deps(db));

      // First set harbour-morning dark
      await app.request("/api/identity/preferences", {
        method: "PUT",
        headers: { Cookie: SESSION_COOKIE, "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ theme: "harbour-morning", mode: "dark" }),
      });

      // Partial update to black-opal without mode
      const res = await app.request("/api/identity/preferences", {
        method: "PUT",
        headers: { Cookie: SESSION_COOKIE, "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ theme: "black-opal" }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ theme: "black-opal", mode: "dark" });

      const row = db
        .prepare("SELECT * FROM person_preference WHERE person_id = '01J0000000000000000000000A'")
        .get() as { theme: string; mode: string };
      expect(row.theme).toBe("black-opal");
      expect(row.mode).toBe("dark");
    });

    it("returns 400 Bad Request on invalid theme", async () => {
      const db = openDb();
      addPerson(db);
      const app = createApp(deps(db));

      const res = await app.request("/api/identity/preferences", {
        method: "PUT",
        headers: { Cookie: SESSION_COOKIE, "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ theme: "neon-pink" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("Validation");
    });

    it("returns 400 Bad Request on invalid mode", async () => {
      const db = openDb();
      addPerson(db);
      const app = createApp(deps(db));

      const res = await app.request("/api/identity/preferences", {
        method: "PUT",
        headers: { Cookie: SESSION_COOKIE, "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ mode: "sunset" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("Validation");
    });

    it("returns 401 Unauthenticated for unauthenticated PUT", async () => {
      const db = openDb();
      addPerson(db);
      const app = createApp(deps(db));

      const res = await app.request("/api/identity/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ theme: "harbour-morning", mode: "light" }),
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("Unauthenticated");
    });
  });
});
