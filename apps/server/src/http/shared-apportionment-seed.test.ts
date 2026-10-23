// The apportionment ticket's verify: apply the default seed, run `reports.sharedApportionment` as
// each partner, and compare with the percentages the seed documents in its own expectations (the
// monthly private-to-joint contributions and their ratio), never with figures typed in here.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIdGenerator,
  fixedClockAt,
  personViewer,
  type SharedApportionment,
  sharedApportionment,
  type UseCaseContext,
} from "@pangolin/app";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeedFile } from "../../scripts/demo-seed.ts";
import { linkSeed } from "../admin/seed.ts";

interface Contribution {
  monthlyCents: Record<string, number>;
  totalCents: Record<string, number>;
  permille: Record<string, number>;
  noContributionRange: { from: string; to: string } | null;
}

let dir: string;
let db: Db;
let seed: { today: string; expectations: Record<string, unknown> };
let people: Record<string, string>;
let contribution: Contribution;

/** Two logins, `user-a` and `user-b`, each enrolled, sent as `session=<user>`. */
function addLogins(target: Db): void {
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
  dir = mkdtempSync(join(tmpdir(), "pangolin-apportion-seed-"));
  const file = join(dir, "seed.json");
  generateSeedFile(file);
  const seedJson = readFileSync(file, "utf8");
  seed = JSON.parse(seedJson);
  contribution = seed.expectations["transfers-and-privacy.contribution"] as Contribution;
  db = openDatabase(join(dir, "pangolin.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  addLogins(db);
  people = linkSeed(
    createUnitOfWork(db),
    { clock: fixedClockAt(seed.today), newId: createIdGenerator() },
    seedJson,
  ).people;
}, 120_000);

afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

function run(personKey: string, range: { from: string; to: string }): SharedApportionment {
  const clock = fixedClockAt(seed.today);
  const ctx: UseCaseContext = {
    viewer: personViewer(people[personKey] as never, clock.now()),
    clock,
    newId: createIdGenerator(),
    uow: createUnitOfWork(db),
  };
  return sharedApportionment(ctx, range);
}

function setAttribution(value: "contribution" | "even"): void {
  createUnitOfWork(db).transaction((r) => {
    r.householdSettings.update({ ...r.householdSettings.get(), sharedAttribution: value });
  });
}

const keys = () => Object.keys(people);
const shareOf = (r: SharedApportionment, personKey: string) =>
  r.people.find((p) => p.personId === people[personKey])?.shareCents;

describe("reports.sharedApportionment on the default seed", () => {
  it("apportions by the documented contribution ratio, identically for both partners", () => {
    setAttribution("contribution");
    const whole = {
      from: (contribution.noContributionRange as { from: string }).from,
      to: seed.today,
    };
    const [one, two] = keys() as [string, string];
    const asOne = run(one, whole);
    const asTwo = run(two, whole);
    expect(JSON.stringify(asOne)).toBe(JSON.stringify(asTwo));
    expect(asOne.basis).toBe("contribution");
    expect(asOne.sharedCents).toBeGreaterThan(0);
    for (const personKey of keys()) {
      const row = asOne.people.find((p) => p.personId === people[personKey]);
      expect(row?.contributionCents, personKey).toBe(contribution.totalCents[personKey]);
    }
    // The documented percentages: each share is the shared total times the documented permille,
    // to within the one cent rounding can move it.
    for (const k of keys()) {
      const exact = (asOne.sharedCents * (contribution.permille[k] as number)) / 1000;
      const share = shareOf(asOne, k) as number;
      expect(share, k).toBeGreaterThanOrEqual(Math.floor(exact));
      expect(share, k).toBeLessThanOrEqual(Math.ceil(exact));
    }
    expect(asOne.people.reduce((n, p) => n + p.shareCents, 0)).toBe(asOne.sharedCents);
  });

  it("splits in half under the even setting, exact to the cent", () => {
    setAttribution("even");
    try {
      const range = {
        from: (contribution.noContributionRange as { from: string }).from,
        to: seed.today,
      };
      const r = run(keys()[0] as string, range);
      expect(r.setting).toBe("even");
      const [x, y] = r.people.map((p) => p.shareCents) as [number, number];
      expect(x + y).toBe(r.sharedCents);
      expect(x - y).toBe(r.sharedCents % 2);
      expect(JSON.stringify(run(keys()[1] as string, range))).toBe(JSON.stringify(r));
    } finally {
      setAttribution("contribution");
    }
  });

  it("falls back to halves in a range with spending but no contribution", () => {
    const range = contribution.noContributionRange as { from: string; to: string };
    const r = run(keys()[0] as string, range);
    expect(r.sharedCents).toBeGreaterThan(0);
    expect(r.people.map((p) => p.contributionCents)).toEqual([0, 0]);
    expect(r.basis).toBe("even-fallback");
    const [x, y] = r.people.map((p) => p.shareCents) as [number, number];
    expect(x + y).toBe(r.sharedCents);
    expect(x - y).toBe(r.sharedCents % 2);
    expect(JSON.stringify(run(keys()[1] as string, range))).toBe(JSON.stringify(r));
  });
});
