import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { createApp } from "./app.ts";

let dir: string;
let dbPath: string;
let webRoot: string;
const open: Db[] = [];

function openDb(readonly = false): Db {
  const db = openDatabase(dbPath, { readonly });
  open.push(db);
  return db;
}

function deps(db: Db) {
  return { systemHealth: createSystemHealthRepo(db), uow: createUnitOfWork(db) };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-http-"));
  dbPath = join(dir, "pangolin.sqlite");
  migrate(openDb(), loadMigrations(packageMigrationsDir));
  webRoot = join(dir, "public");
  mkdirSync(join(webRoot, "assets"), { recursive: true });
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Pangolin</title>");
  writeFileSync(join(webRoot, "assets", "app-abc123.js"), "console.log(1)");
});

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/system/health", () => {
  it("returns 200 ok on a writable, migrated database", async () => {
    const app = createApp(deps(openDb()));
    const res = await app.request("/api/system/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", schemaVersion: 3, writable: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 503 with writable:false on a read-only database", async () => {
    const app = createApp(deps(openDb(true)));
    const res = await app.request("/api/system/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unhealthy", schemaVersion: 3, writable: false });
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

  it("returns an empty list when no job is dead", async () => {
    const res = await createApp(deps(openDb())).request("/api/system/jobs");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dead: [] });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("lists dead jobs by kind and failure time only, newest first", async () => {
    const db = openDb();
    insertJob(db, "01JOB0000000000000000000A1", "price-fetch", "dead", "2026-09-27T01:00:00.000Z");
    insertJob(db, "01JOB0000000000000000000A2", "backup-push", "dead", "2026-09-27T02:00:00.000Z");
    insertJob(db, "01JOB0000000000000000000A3", "price-fetch", "done", "2026-09-27T03:00:00.000Z");
    const res = await createApp(deps(db)).request("/api/system/jobs");
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
    for (let i = 0; i < 55; i++) {
      const at = `2026-09-27T00:00:${String(i).padStart(2, "0")}.000Z`;
      insertJob(db, `01JOB00000000000000000${String(i).padStart(4, "0")}`, "k", "dead", at);
    }
    const body = (await (await createApp(deps(db)).request("/api/system/jobs")).json()) as {
      dead: unknown[];
    };
    expect(body.dead).toHaveLength(50);
  });
});

describe("errors", () => {
  it("answers a throwing route with 500 Internal, without its message", async () => {
    const logged: unknown[] = [];
    const app = createApp({
      uow: createUnitOfWork(openDb()),
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

  it("serves index.html at / without long-term caching", async () => {
    const res = await app().request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>Pangolin</title>");
    expect(res.headers.get("cache-control")).toBe("no-cache");
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

  it("falls back to index.html for client routes", async () => {
    const res = await app().request("/budgets/2026");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>Pangolin</title>");
  });

  it("does not fall back for unknown API routes", async () => {
    const res = await app().request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NotFound", message: "Not found" } });
  });
});
