// Verification test for the net-worth projection on the default seed: each seeded person gets
// three monthly series (returns 3/5/7% bps from the seeded assumptions) whose point 0 is exactly
// `/api/reports/net-worth` for that person. The seeded joint home loan carries demo terms
// ("6.175", $4,200/mo) with its offset counted, so every line climbs month over month — pot
// contributions plus compounding above a paying-down loan. A third login with no stored
// assumptions stays flat at its own net worth. Horizons 1/2/5/10 answer 13/25/61/121 points; `horizon=3` and `horizon=abc` are 400s.
// One person's PUT moves only their own lines — the partner's report stays byte-identical.

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
  dir = mkdtempSync(join(tmpdir(), "pangolin-forecast-networth-seed-"));
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

async function get(path: string, user: string): Promise<{ status: number; body: any }> {
  const res = await app.request(`http://localhost:3000${path}`, {
    headers: { cookie: `session=${user}` },
  });
  return { status: res.status, body: await res.json() };
}

async function put(user: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request("http://localhost:3000/api/planning/forecast-assumptions", {
    method: "PUT",
    headers: {
      cookie: `session=${user}`,
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function forecast(user: string, horizon?: string) {
  return get(
    `/api/planning/forecast-net-worth${horizon !== undefined ? `?horizon=${horizon}` : ""}`,
    user,
  );
}

/** `seed.today + months` months, the calendar-clamped way the projection dates its points. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

describe("GET /api/planning/forecast-net-worth on the default seed", () => {
  it("answers the seeded people with three 25-point lines starting at today's net worth", async () => {
    for (const user of ["user-a", "user-b"]) {
      const [report, today] = await Promise.all([
        forecast(user),
        get("/api/reports/net-worth", user),
      ]);
      expect(report.status).toBe(200);
      expect(today.status).toBe(200);
      const { body } = report;
      expect(body.asOf).toBe(seed.today);
      expect(body.horizonYears).toBe(2);
      expect(body.lines.low.returnBps).toBe(300);
      expect(body.lines.mid.returnBps).toBe(500);
      expect(body.lines.high.returnBps).toBe(700);
      expect(body.lines.low.annualReturnPercent).toBe("3");
      expect(body.lines.mid.annualReturnPercent).toBe("5");
      expect(body.lines.high.annualReturnPercent).toBe("7");
      for (const line of [body.lines.low, body.lines.mid, body.lines.high]) {
        expect(line.points).toHaveLength(25);
        expect(line.points[0].netWorthCents).toBe(today.body.netWorthCents);
        // Months and dates march: point m is `seed.today + m` months.
        expect(line.points.map((p: any) => p.month)).toEqual([...Array(25).keys()]);
        expect(line.points[24].date).toBe(addMonths(seed.today, 24));
      }
      // low ≤ mid ≤ high at every point, and the seeded contributions plus loan paydown
      // (demo terms on the joint loan, offset counted) only lift the lines.
      for (let m = 0; m < 25; m++) {
        const low = body.lines.low.points[m].netWorthCents;
        const mid = body.lines.mid.points[m].netWorthCents;
        const high = body.lines.high.points[m].netWorthCents;
        expect(low).toBeLessThanOrEqual(mid);
        expect(mid).toBeLessThanOrEqual(high);
      }
      // Strictly rising on mid: every month adds the seeded savings+super share (475_475 on
      // A's 385_000 fortnightly anchor, 395_200 on B's 320_000), and the
      // loan's principal paydown (above its interest once netted of the offset) compounds it.
      for (let m = 1; m < 25; m++) {
        expect(body.lines.mid.points[m].netWorthCents).toBeGreaterThan(
          body.lines.mid.points[m - 1].netWorthCents,
        );
      }
    }
  });

  it("takes 13 / 61 / 121 points for horizons 1 / 5 / 10", async () => {
    for (const [horizon, points] of [
      ["1", 13],
      ["5", 61],
      ["10", 121],
    ] as const) {
      const { status, body } = await forecast("user-a", horizon);
      expect(status).toBe(200);
      expect(body.horizonYears).toBe(Number(horizon));
      expect(body.lines.low.points).toHaveLength(points);
      expect(body.lines.mid.points).toHaveLength(points);
      expect(body.lines.high.points).toHaveLength(points);
      expect(body.lines.high.points[points - 1].month).toBe(points - 1);
    }
  });

  it("400s every horizon outside 1 / 2 / 5 / 10", async () => {
    for (const horizon of ["3", "0", "11", "abc", ""]) {
      const { status } = await forecast("user-a", horizon);
      expect(status).toBe(400);
    }
  });

  it("holds a person with no assumptions flat at their own net worth", async () => {
    // user-c owns nothing but still sees the shared non-private accounts (AD-3), and has no
    // stored assumptions: zero bps and no selected loans means every line stays flat at
    // today's net worth for the whole horizon.
    const [report, today] = await Promise.all([
      forecast("user-c", "10"),
      get("/api/reports/net-worth", "user-c"),
    ]);
    expect(report.status).toBe(200);
    const { body } = report;
    const flat = today.body.netWorthCents;
    for (const line of [body.lines.low, body.lines.mid, body.lines.high]) {
      expect(line.points.every((p: any) => p.netWorthCents === flat)).toBe(true);
    }
  });

  it("moves one person's lines without touching the partner's report", async () => {
    const beforeA = await forecast("user-a");
    const beforeB = await forecast("user-b");
    expect(beforeA.status).toBe(200);
    expect(beforeB.status).toBe(200);

    const putRes = await put("user-a", { savingsRateBps: 5000 });
    expect(putRes.status).toBe(200);

    const afterA = await forecast("user-a");
    const afterB = await forecast("user-b");
    // B's report is byte-identical: A's assumption never appears in it.
    expect(afterB.body).toEqual(beforeB.body);
    // A's lines lifted from month 1: 50% of the same fortnightly income, on every line.
    for (const key of ["low", "mid", "high"] as const) {
      expect(afterA.body.lines[key].points[1].netWorthCents).toBeGreaterThan(
        beforeA.body.lines[key].points[1].netWorthCents,
      );
    }
  });
});
