// Verification test for forecast assumptions on the default seed: the demo world carries each
// seeded person's editable rates (savings 45%, returns 3/5/7%, super 12%) and one mortgage
// selection (the joint home loan, offsets counted), applied through the same use case the
// dashboard's PUT takes. A third login owns nothing: its GET answers neutral zeros and creates
// no row. PUT partial-merges scalars, replaces the mortgage list, appends one audit row, and
// every cross-person or non-`home_loan` reference answers 404 without touching storage.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdGenerator, fixedClockAt } from "@pangolin/app";
import { fakeAttachmentStore } from "@pangolin/app/testing/attachment-store";
import {
  createSystemHealthRepo,
  createUnitOfWork,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeedFile } from "../../scripts/demo-seed.ts";
import { linkSeed } from "../admin/seed.ts";
import { nodeTokens, recoveryCodeHasher } from "../auth/secret.ts";
import { createApp } from "./app.ts";
import type { AuthGateway } from "./session.ts";

let dir: string;
let db: ReturnType<typeof openDatabase>;
let seed: { today: string; expectations: Record<string, any> };
let app: ReturnType<typeof createApp>;

const DEMO = {
  savingsRateBps: 4500,
  returnLowBps: 300,
  returnMidBps: 500,
  returnHighBps: 700,
  superRateBps: 1200,
};

function fakeGateway(): AuthGateway {
  return {
    handler: async (request) => new Response(`auth:${new URL(request.url).pathname}`),
    getSession: async (headers) => {
      const cookie = headers.get("cookie") ?? "";
      for (const user of ["user-a", "user-b", "user-c"]) {
        if (cookie.includes(`session=${user}`)) {
          return { session: { userId: user, createdAt: new Date() }, setCookies: [] };
        }
      }
      return { session: null, setCookies: [] };
    },
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

/** The two seeded people plus a third login the seed never touches (the zero-state person). */
function addLogins(target: ReturnType<typeof openDatabase>): void {
  for (const [user, name, at] of [
    ["user-a", "Alex", "2026-01-01T00:00:00.000Z"],
    ["user-b", "Sam", "2026-01-02T00:00:00.000Z"],
    ["user-c", "Caz", "2026-01-03T00:00:00.000Z"],
  ] as const) {
    target
      .prepare(
        `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
         VALUES (?, ?, ?, 0, 1, 'x', 'x')`,
      )
      .run(user, name, `${user}@example.com`);
    target
      .prepare(
        `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
         VALUES (?, ?, 'k', ?, 0, 'singleDevice', 0)`,
      )
      .run(`pk-${user}`, user, `c-${user}`);
    target
      .prepare(
        `INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at)
         VALUES (?, ?, ?, '#2563eb', ?, ?)`,
      )
      .run(
        `01J00000000000000000000${user === "user-a" ? "00A" : user === "user-b" ? "00B" : "00C"}`,
        user,
        name,
        at,
        at,
      );
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-forecast-assumptions-seed-"));
  const file = join(dir, "seed.json");
  generateSeedFile(file);
  const seedJson = readFileSync(file, "utf8");
  seed = JSON.parse(seedJson);
  db = openDatabase(join(dir, "pangolin.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  addLogins(db);
  const clock = fixedClockAt(seed.today);
  linkSeed(createUnitOfWork(db), { clock, newId: createIdGenerator() }, seedJson);

  app = createApp({
    systemHealth: createSystemHealthRepo(db),
    uow: createUnitOfWork(db),
    clock,
    newId: createIdGenerator(),
    tokens: nodeTokens,
    codes: recoveryCodeHasher("test-secret"),
    authSecret: "test-secret",
    attachments: fakeAttachmentStore(),
    publicUrl: "http://localhost:3000",
    authn: { kind: "live", gateway: fakeGateway() },
    healthz: { expectedSchemaVersion: loadMigrations(packageMigrationsDir).length, runner: "skip" },
  });
}, 120_000);

afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function request(
  user: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  const res = await app.request("http://localhost:3000/api/planning/forecast-assumptions", {
    method: init?.method ?? "GET",
    headers: {
      cookie: `session=${user}`,
      ...(init?.body !== undefined
        ? { "content-type": "application/json", origin: "http://localhost:3000" }
        : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  return { status: res.status, body: await res.json() };
}

function personId(user: string): string {
  const row = db.prepare("SELECT id FROM person WHERE user_id = ?").get(user) as {
    id: string;
  };
  return row.id;
}

/** The id of the named account owned (or co-owned) by `user`, or undefined. */
function accountId(user: string, name: string): string | undefined {
  const row = db
    .prepare(
      `SELECT a.id FROM account a
       JOIN account_owner o ON o.account_id = a.id
       JOIN person p ON p.id = o.person_id
       WHERE p.user_id = ? AND a.name = ?`,
    )
    .get(user, name) as { id: string } | undefined;
  return row?.id;
}

function auditCount(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity = 'forecast_assumption'")
    .get() as { count: number };
  return row.count;
}

function assumptionRowCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM forecast_assumption").get() as {
    count: number;
  };
  return row.count;
}

describe("Forecast assumptions on default seed", () => {
  it("returns the demo assumptions seeded for each person", async () => {
    for (const user of ["user-a", "user-b"]) {
      const loan = accountId(user, "Joint home loan");
      expect(loan).toBeDefined();
      const { status, body } = await request(user);
      expect(status).toBe(200);
      expect(body).toEqual({
        ...DEMO,
        mortgages: [{ accountId: loan, countOffset: true }],
      });
    }
  });

  it("answers zeros and an empty list for a person with nothing stored — and writes nothing", async () => {
    const before = assumptionRowCount();
    const { status, body } = await request("user-c");
    expect(status).toBe(200);
    expect(body).toEqual({
      savingsRateBps: 0,
      returnLowBps: 0,
      returnMidBps: 0,
      returnHighBps: 0,
      superRateBps: 0,
      mortgages: [],
    });
    expect(assumptionRowCount()).toBe(before);
  });

  it("PUT partial-merges scalars, replaces the mortgage list and appends one audit row", async () => {
    const before = auditCount();

    const put = await request("user-a", {
      method: "PUT",
      body: { returnMidBps: 650, savingsRateBps: 5000, mortgages: [] },
    });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({
      ...DEMO,
      savingsRateBps: 5000,
      returnMidBps: 650,
      mortgages: [],
    });

    const get = await request("user-a");
    expect(get.body).toEqual(put.body);
    expect(auditCount()).toBe(before + 1);

    // Person B keeps the seeded demo values untouched.
    const other = await request("user-b");
    expect(other.status).toBe(200);
    expect(other.body).toEqual({
      ...DEMO,
      mortgages: [{ accountId: accountId("user-b", "Joint home loan"), countOffset: true }],
    });
  });

  it("404s a mortgage account not visible to the caller, and another person's row", async () => {
    // Person A's private account is invisible to B — same answer as an unknown key.
    const privateId = accountId("user-a", "Person A private");
    expect(privateId).toBeDefined();

    const asB = await request("user-b", {
      method: "PUT",
      body: { mortgages: [{ accountId: privateId, countOffset: true }] },
    });
    expect(asB.status).toBe(404);
    expect(asB.body.error.code).toBe("NotFound");

    // B cannot write A's assumptions either — and B's own row stays untouched.
    const crossWrite = await request("user-b", {
      method: "PUT",
      body: { personId: personId("user-a"), savingsRateBps: 1 },
    });
    expect(crossWrite.status).toBe(404);
    expect(crossWrite.body.error.code).toBe("NotFound");
    const b = await request("user-b");
    expect(b.body.savingsRateBps).toBe(DEMO.savingsRateBps);
  });

  it("404s a visible account that is not a home loan", async () => {
    const everyday = accountId("user-a", "Joint everyday");
    expect(everyday).toBeDefined();

    const { status, body } = await request("user-a", {
      method: "PUT",
      body: { mortgages: [{ accountId: everyday, countOffset: false }] },
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe("NotFound");
  });

  it("400s out-of-range rates and duplicate mortgage accounts", async () => {
    const outOfRange = await request("user-a", { method: "PUT", body: { savingsRateBps: 10001 } });
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.body.error.code).toBe("Validation");

    const loan = accountId("user-a", "Joint home loan")!;
    const duplicate = await request("user-a", {
      method: "PUT",
      body: {
        mortgages: [
          { accountId: loan, countOffset: true },
          { accountId: loan, countOffset: true },
        ],
      },
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe("Validation");
  });
});
