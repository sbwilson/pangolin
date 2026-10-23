import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeedFile } from "../../scripts/demo-seed.ts";
import { applySeed } from "../admin/seed.ts";
import { nodeTokens, recoveryCodeHasher } from "../auth/secret.ts";
import { type AppDeps, createApp } from "./app.ts";
import type { AuthGateway, Authn } from "./session.ts";

const SESSION_COOKIE = "session=user-perf-a";
const ORIGIN = "http://localhost:3000";
const BUDGET_MS = 300;

function fakeGateway(createdAt = new Date()): AuthGateway {
  return {
    handler: async (request) => new Response(`auth:${new URL(request.url).pathname}`),
    getSession: async (headers) => ({
      session:
        headers.get("cookie") === SESSION_COOKIE ? { userId: "user-perf-a", createdAt } : null,
      setCookies: [],
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
const clock = fixedClockAt("2026-09-27");
const ticking = {
  running: true,
  lastTickAt: clock.now().epochMilliseconds,
  pollMs: 1000,
};

function makeDeps(db: Db): AppDeps {
  const uow: UnitOfWork = createUnitOfWork(db);
  const authn: Authn = { kind: "live", gateway: fakeGateway() };
  return {
    systemHealth: createSystemHealthRepo(db),
    uow,
    clock,
    newId: createIdGenerator(),
    tokens: nodeTokens,
    codes: recoveryCodeHasher("test-secret"),
    attachments: fakeAttachmentStore(),
    publicUrl: ORIGIN,
    authn,
    healthz: { expectedSchemaVersion: MIGRATIONS, runner: () => ticking },
  };
}

describe("50,000-row ledger performance", () => {
  let tmpDir: string;
  let db: Db;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pangolin-perf-"));
    const seedFile = join(tmpDir, "seed.json");
    generateSeedFile(seedFile, ["--profile", "perf"]);
    const seedJson = readFileSync(seedFile, "utf8");

    db = openDatabase(":memory:");
    migrate(db, loadMigrations(packageMigrationsDir));

    const uow = createUnitOfWork(db);
    const deps = { clock, newId: createIdGenerator() };
    const applied = applySeed(uow, deps, seedJson);

    const alexId = applied.people["person-a"];
    if (alexId === undefined) throw new Error("Expected person-a in applied seed");

    db.prepare(`
      INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
      VALUES ('user-perf-a', 'Alex', 'alex@example.com', 0, 1, 'x', 'x')
    `).run();
    db.prepare(`
      INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
      VALUES ('pk', 'user-perf-a', 'k', 'c', 0, 'singleDevice', 0)
    `).run();
    db.prepare(`
      UPDATE person SET user_id = 'user-perf-a' WHERE id = ?
    `).run(alexId);

    app = createApp(makeDeps(db));
  }, 120_000);

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves first page with summary, total, and dayNets in <= 300 ms", async () => {
    const start = performance.now();
    const res = await app.request("/api/ledger/transactions", {
      headers: { Cookie: SESSION_COOKIE },
    });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      transactions: unknown[];
      page: {
        page: number;
        total: number;
        pageCount: number;
        next: string | null;
        prev: string | null;
      };
      summary: { count: number; inCents: number; outCents: number };
      dayNets: Record<string, number>;
    };

    expect(body.transactions).toHaveLength(50);
    expect(body.page.page).toBe(1);
    expect(body.page.total).toBeGreaterThan(40_000);
    expect(body.summary.count).toBe(body.page.total);
    expect(typeof body.summary.inCents).toBe("number");
    expect(typeof body.summary.outCents).toBe("number");
    expect(Object.keys(body.dayNets).length).toBeGreaterThan(0);
    expect(body.page.next).toBeTruthy();
    expect(body.page.prev).toBeNull();

    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
  });

  it("serves last-page jump with summary, dayNets, and prev cursor in <= 300 ms", async () => {
    // Determine pageCount from first request
    const firstRes = await app.request("/api/ledger/transactions", {
      headers: { Cookie: SESSION_COOKIE },
    });
    const firstBody = (await firstRes.json()) as {
      page: { pageCount: number };
    };
    const pageCount = firstBody.page.pageCount;
    expect(pageCount).toBeGreaterThan(1);

    const start = performance.now();
    const res = await app.request(`/api/ledger/transactions?page=${pageCount}`, {
      headers: { Cookie: SESSION_COOKIE },
    });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      transactions: unknown[];
      page: {
        page: number;
        pageCount: number;
        total: number;
        next: string | null;
        prev: string | null;
      };
      summary: { count: number; inCents: number; outCents: number };
      dayNets: Record<string, number>;
    };

    expect(body.transactions.length).toBeGreaterThan(0);
    expect(body.transactions.length).toBeLessThanOrEqual(50);
    expect(body.page.page).toBe(pageCount);
    expect(body.page.next).toBeNull();
    expect(body.page.prev).toBeTruthy();
    expect(body.summary.count).toBeGreaterThan(40_000);
    expect(Object.keys(body.dayNets).length).toBeGreaterThan(0);

    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
  });

  it("serves cash-flow totals over the full seeded range in <= 300 ms", async () => {
    const days = db
      .prepare('SELECT min(posted_on) AS first, max(posted_on) AS last FROM "transaction"')
      .get() as { first: string; last: string };
    const start = performance.now();
    const res = await app.request(`/api/reports/cash-flow?from=${days.first}&to=${days.last}`, {
      headers: { Cookie: SESSION_COOKIE },
    });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      moneyInCents: number;
      moneyOutCents: number;
      keptCents: number;
    };
    expect(body.moneyInCents).toBeGreaterThan(0);
    expect(body.moneyOutCents).toBeGreaterThan(0);
    expect(body.keptCents).toBe(body.moneyInCents - body.moneyOutCents);

    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
  });
});
