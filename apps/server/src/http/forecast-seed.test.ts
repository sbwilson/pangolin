// Verification test for the planning forecast on the default seed:
// GET /api/planning/forecast projects each viewer's visible `transaction` accounts with day 0
// carrying today's actual balance and projections from tomorrow through `today + horizon
// months`. Every projected day-delta equals the movement map the seed module derives from the
// same arithmetic (deposits, confirmed series, funding-account proration, covered-category
// exclusions and virtual period-close allocation debits), and the joint everyday account — whose
// low-balance threshold sits above the balance it holds today — produces a dip warning that
// matches the expectation the seed module derives. The other partner never sees Person A's
// private account, an unknown horizon falls back to 3 months, and every warning names the first
// day below its account's threshold, not the lowest point of the series.

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

const ORIGIN = "http://localhost:3000";

function fakeGateway(): AuthGateway {
  return {
    handler: async (request) => new Response(`auth:${new URL(request.url).pathname}`),
    getSession: async (headers) => {
      const cookie = headers.get("cookie") ?? "";
      if (cookie.includes("session=user-a")) {
        return { session: { userId: "user-a", createdAt: new Date() }, setCookies: [] };
      }
      if (cookie.includes("session=user-b")) {
        return { session: { userId: "user-b", createdAt: new Date() }, setCookies: [] };
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

function addLogins(target: ReturnType<typeof openDatabase>): void {
  for (const [user, name, at] of [
    ["user-a", "Alex", "2026-01-01T00:00:00.000Z"],
    ["user-b", "Sam", "2026-01-02T00:00:00.000Z"],
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
      .run(`01J00000000000000000000${user === "user-a" ? "00A" : "00B"}`, user, name, at, at);
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-forecast-seed-"));
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
    publicUrl: ORIGIN,
    authn: { kind: "live", gateway: fakeGateway() },
    healthz: { expectedSchemaVersion: loadMigrations(packageMigrationsDir).length, runner: "skip" },
  });
}, 120_000);

afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

interface ForecastBody {
  from: string;
  through: string;
  horizonMonths: number;
  missingDepositSource: boolean;
  accounts: {
    accountId: string;
    name: string;
    lowBalanceThresholdCents: number;
    points: { date: string; balanceCents: number }[];
  }[];
  warnings: { accountId: string; accountName: string; cents: number; date: string }[];
}

async function forecast(horizon?: string): Promise<ForecastBody> {
  const url =
    horizon === undefined ? "/api/planning/forecast" : `/api/planning/forecast?horizon=${horizon}`;
  const res = await app.request(url, { headers: { Cookie: "session=user-a" } });
  expect(res.status).toBe(200);
  return (await res.json()) as ForecastBody;
}

function expectedWarnings(person: string): { account: string; cents: number; dateOn: string }[] {
  return seed.expectations["budgets-and-bills.forecast"].warnings[person];
}

function forecastMirror(person: string): {
  day0: Record<string, number>;
  byDay: Record<string, Record<string, number>>;
  allocationDebits: Record<string, { date: string; parts: number[] }[]>;
} {
  return seed.expectations["budgets-and-bills.forecast"].perViewer[person];
}

const ACCOUNT_NAMES: Record<string, string> = {
  "joint-everyday": "Joint everyday",
  "person-a-private": "Person A private",
};

const NAME_KEYS: Record<string, string> = {
  "Joint everyday": "joint-everyday",
  "Person A private": "person-a-private",
};

/**
 * Every projected point of every account must equal the seed mirror's day-0 balance plus the
 * mirror's movements up to that day — the whole model (deposits, bills, funding accounts,
 * exclusions, allocation debits) checked day by day.
 */
function expectMatchesMirror(body: ForecastBody, person: string): void {
  const mirror = forecastMirror(person);
  for (const account of body.accounts) {
    const key = NAME_KEYS[account.name]!;
    const day0 = mirror.day0[key];
    expect(day0).toBeDefined();
    expect(account.points[0]!.balanceCents).toBe(day0!);
    let balance = day0!;
    for (const point of account.points) {
      balance += mirror.byDay[key]?.[point.date] ?? 0;
      expect([point.date, point.balanceCents]).toEqual([point.date, balance]);
    }
  }
}

describe("Cash-flow forecast on default seed (planning-forecast tracer)", () => {
  it("warns for Person A's joint everyday dip, matching the seed's derived expectation", async () => {
    const body = await forecast("3");
    expect(body.from).toBe(seed.today);
    expect(body.horizonMonths).toBe(3);
    expect(body.missingDepositSource).toBe(false);

    // Exactly the accounts Person A may see: the joint everyday plus their own private account.
    const names = body.accounts.map((a) => a.name).sort();
    expect(names).toEqual(["Joint everyday", "Person A private"]);

    const everyday = body.accounts.find((a) => a.name === "Joint everyday")!;
    expect(everyday.lowBalanceThresholdCents).toBe(6_000_000);
    expect(everyday.points.length).toBe(
      Math.round((new Date(body.through).getTime() - new Date(body.from).getTime()) / 86_400_000) +
        1,
    );

    const expected = expectedWarnings("person-a");
    expect(expected.length).toBeGreaterThan(0);
    const byName = (w: { accountName: string }) => w.accountName;
    const got = [...body.warnings]
      .sort((x, y) => byName(x).localeCompare(byName(y)))
      .map(({ accountName, cents, date }) => ({ accountName, cents, date }));
    const want = [...expected]
      .map((w) => ({
        accountName: ACCOUNT_NAMES[w.account] ?? w.account,
        cents: w.cents,
        date: w.dateOn,
      }))
      .sort((x, y) => x.accountName.localeCompare(y.accountName));
    expect(got).toEqual(want);

    // The warning names the first day below the threshold and its projected cents.
    for (const warning of body.warnings) {
      const account = body.accounts.find((a) => a.accountId === warning.accountId)!;
      const below = account.points.filter((p) => p.balanceCents < account.lowBalanceThresholdCents);
      expect(below[0]?.date).toBe(warning.date);
      expect(warning.cents).toBe(below[0]?.balanceCents);
      expect(warning.cents).toBeLessThan(account.lowBalanceThresholdCents);
    }
  });

  it("shows Person B only the joint everyday, with B's own deposits and budgets walked in", async () => {
    const res = await app.request("/api/planning/forecast?horizon=3", {
      headers: { Cookie: "session=user-b" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ForecastBody;
    expect(body.accounts.map((a) => a.name)).toEqual(["Joint everyday"]);

    const expected = expectedWarnings("person-b");
    expect(body.warnings.length).toBe(expected.length);
    for (const w of expected) {
      const got = body.warnings.find((x) => x.accountName === ACCOUNT_NAMES[w.account]);
      expect(got).toBeDefined();
      expect(got?.cents).toBe(w.cents);
      expect(got?.date).toBe(w.dateOn);
    }
    // Day 0 is today's actual snapshot: Telstra paid today is already inside it, and B's
    // mobile budget is covered by the confirmed series, so nothing is re-projected on day 0.
    const everyday = body.accounts[0]!;
    const opening = seed.expectations["balance-snapshots.closingCents"]["joint-everyday"];
    expect(everyday.points[0]?.balanceCents).toBe(opening);
  });

  it("walks exactly the movements the seed mirror derives, both viewers", async () => {
    expectMatchesMirror(await forecast("3"), "person-a");

    const res = await app.request("/api/planning/forecast?horizon=3", {
      headers: { Cookie: "session=user-b" },
    });
    expect(res.status).toBe(200);
    expectMatchesMirror((await res.json()) as ForecastBody, "person-b");

    // The joint account's closes carry the stage-one (80/10/10) allocation debits derived from
    // each period's projected savings — and the current period, with no projected savings yet,
    // carries none.
    for (const person of ["person-a", "person-b"]) {
      const debits = forecastMirror(person).allocationDebits["joint-everyday"];
      expect(debits).toBeDefined();
      expect(debits!.length).toBeGreaterThan(0);
      for (const debit of debits!) {
        expect(debit.parts).toHaveLength(3);
        expect(debit.parts.reduce((sum, part) => sum + part, 0)).toBeGreaterThan(0);
      }
    }
  });

  it("defaults an unknown or missing horizon to 3 months, and honours 6 and 12", async () => {
    const missing = await forecast();
    const bogus = await forecast("bogus");
    const three = await forecast("3");
    expect(missing.horizonMonths).toBe(3);
    expect(bogus.horizonMonths).toBe(3);
    expect(bogus.accounts).toEqual(three.accounts);
    expect(missing.accounts).toEqual(three.accounts);

    const six = await forecast("6");
    expect(six.horizonMonths).toBe(6);
    expect(six.accounts[0]!.points.length).toBeGreaterThan(three.accounts[0]!.points.length);
    const twelve = await forecast("12");
    expect(twelve.horizonMonths).toBe(12);
    expect(twelve.accounts[0]!.points.length).toBeGreaterThan(six.accounts[0]!.points.length);
  });
});
