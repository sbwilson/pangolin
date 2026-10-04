import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  createIdGenerator,
  listTransactions,
  personViewer,
  systemClock,
} from "@pangolin/app";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateSeedFile } from "../../scripts/demo-seed.ts";
import { type AdminDeps, seedCommand } from "./commands.ts";
import { applySeed, linkSeed, parseSeed } from "./seed.ts";

let seedDir: string;
let seedJson: string;
let seed: {
  events: { type: string; key?: string; displayName?: string; colour?: string }[];
  expectations: Record<string, unknown>;
};

beforeAll(() => {
  seedDir = mkdtempSync(join(tmpdir(), "pangolin-seed-apply-"));
  const file = join(seedDir, "seed.json");
  generateSeedFile(file);
  seedJson = readFileSync(file, "utf8");
  seed = JSON.parse(seedJson);
});

afterAll(() => {
  rmSync(seedDir, { recursive: true, force: true });
});

let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
});

const deps = () => ({ clock: systemClock("UTC"), newId: createIdGenerator() });
const expected = (key: string) => seed.expectations[`people-and-household.${key}`];
const count = (table: string) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();

function withEvents(events: unknown[]): string {
  return JSON.stringify({ ...seed, events });
}

function rejection(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}

describe("applySeed", () => {
  it("applies the default seed: people and settings match its expectations", () => {
    const result = applySeed(createUnitOfWork(db), deps(), seedJson);

    const people = db.prepare("SELECT id, display_name, colour FROM person ORDER BY id").all() as {
      id: string;
      display_name: string;
      colour: string;
    }[];
    expect(people).toHaveLength(expected("peopleCount") as number);
    expect(people.map((p) => p.display_name)).toEqual(expected("peopleNames"));
    expect(people.map((p) => p.colour)).toEqual(expected("peopleColours"));
    expect(Object.values(result.people).sort()).toEqual(people.map((p) => p.id).sort());

    const settings = db.prepare("SELECT * FROM household_settings").get() as Record<
      string,
      unknown
    >;
    expect(settings).toMatchObject({
      timezone: expected("timezone"),
      base_currency: expected("baseCurrency"),
      shared_attribution: expected("sharedAttribution"),
    });
    expect(result).toMatchObject({ seed: "pangolin-v1", today: "2026-07-15" });
  });

  it("audits every write as cli:seed", () => {
    applySeed(createUnitOfWork(db), deps(), seedJson);
    const audit = db.prepare("SELECT actor, entity, action FROM audit_log").all() as {
      actor: string;
      entity: string;
      action: string;
    }[];
    // The default settings already match the seed, so only people, accounts and transactions.
    const entities = (entity: string) => audit.filter((row) => row.entity === entity);
    expect(entities("person")).toHaveLength(count("person") as number);
    expect(entities("account")).toHaveLength(count("account") as number);
    expect(entities("transaction")).toHaveLength(count('"transaction"') as number);
    expect(audit).toHaveLength(
      (count("person") as number) +
        (count("account") as number) +
        (count('"transaction"') as number),
    );
    for (const row of audit) {
      expect(row).toMatchObject({ actor: "cli:seed", action: "create" });
    }
  });

  it("applies the seed's accounts: one shared and one private per person, owners attached", () => {
    applySeed(createUnitOfWork(db), deps(), seedJson);
    const rows = db
      .prepare(
        `SELECT a.name, a.is_private, group_concat(o.person_id) AS owners, count(*) AS n
         FROM account a JOIN account_owner o ON o.account_id = a.id GROUP BY a.id ORDER BY a.name`,
      )
      .all() as { name: string; is_private: number; owners: string; n: number }[];
    expect(rows.map((r) => [r.name, r.is_private, r.n])).toEqual([
      ["Joint everyday", 0, 2],
      ["Person A private", 1, 1],
      ["Person B private", 1, 1],
    ]);
  });

  it("audits a settings change too", () => {
    const events = seed.events.map((e) =>
      e.type === "household.settings" ? { ...e, timezone: "Australia/Perth" } : e,
    );
    applySeed(createUnitOfWork(db), deps(), withEvents(events));
    const rows = db
      .prepare("SELECT actor FROM audit_log WHERE entity = 'household_settings'")
      .all();
    expect(rows).toEqual([{ actor: "cli:seed" }]);
    expect(db.prepare("SELECT timezone FROM household_settings").pluck().get()).toBe(
      "Australia/Perth",
    );
  });

  it.each([
    ["malformed JSON", "{ not json", /not valid JSON/],
    [
      "a missing field",
      JSON.stringify({ seed: "s", today: "2026-07-15", events: [] }),
      /expectations/,
    ],
    [
      "a bad today",
      JSON.stringify({ ...{ seed: "s", events: [], expectations: {} }, today: "15/07/2026" }),
      /today: Expected YYYY-MM-DD/,
    ],
    [
      "a today that does not exist",
      JSON.stringify({ seed: "s", today: "2026-02-30", events: [], expectations: {} }),
      /today: Expected a real calendar date/,
    ],
  ])("rejects %s before writing anything", (_name, text, message) => {
    const error = rejection(() => applySeed(createUnitOfWork(db), deps(), text));
    expect(error.code).toBe("Validation");
    expect(error.message).toMatch(message);
    expect([count("person"), count("audit_log")]).toEqual([0, 0]);
  });

  it("rejects an unknown event type, naming it, after valid events and before any write", () => {
    const events = [...seed.events, { type: "budget.created", module: "budgets", key: "x" }];
    const error = rejection(() => applySeed(createUnitOfWork(db), deps(), withEvents(events)));
    expect(error.message).toContain(
      `events.${seed.events.length}: unknown event type "budget.created"`,
    );
    expect([count("person"), count("audit_log")]).toEqual([0, 0]);
  });

  it("rejects an event the use case would reject, and a reused person key", () => {
    const [first] = seed.events;
    const events = [first, { ...first, colour: "red" }, first];
    const error = rejection(() => applySeed(createUnitOfWork(db), deps(), withEvents(events)));
    expect(error.message).toContain("events.1.colour: Expected a #RRGGBB colour");
    expect(error.message).toContain('events.2: person key "person-a" is used twice');
    expect(count("person")).toBe(0);
  });

  it("rejects unknown fields on an event", () => {
    const [first] = seed.events;
    expect(() => parseSeed(withEvents([{ ...first, extra: 1 }]))).toThrow(/events\.0/);
  });
});

describe("linkSeed", () => {
  /** A person with a login, as sign-up leaves them; `n` orders them by creation time. */
  function signUp(n: number, name: string): string {
    const id = `01J000000000000000000000${n}A`;
    db.prepare(
      `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
       VALUES (?, ?, ?, 0, 1, 'x', 'x')`,
    ).run(`user-${n}`, name, `${name}@example.com`);
    db.prepare(
      `INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at)
       VALUES (?, ?, ?, '#2563eb', ?, ?)`,
    ).run(id, `user-${n}`, name, `2026-09-0${n}T00:00:00.000Z`, `2026-09-0${n}T00:00:00.000Z`);
    return id;
  }

  it("attaches the seed's accounts to the signed-up people by sign-up order, creating nobody", () => {
    const alex = signUp(1, "Alex");
    const sam = signUp(2, "Sam");
    const result = linkSeed(createUnitOfWork(db), deps(), seedJson);
    expect(result).toMatchObject({ accounts: 3, people: { "person-a": alex, "person-b": sam } });
    expect(count("person")).toBe(2);
    const owners = db
      .prepare(
        `SELECT a.name, o.person_id FROM account a JOIN account_owner o ON o.account_id = a.id
         WHERE a.is_private = 1 ORDER BY a.name`,
      )
      .all();
    expect(owners).toEqual([
      { name: "Person A private", person_id: alex },
      { name: "Person B private", person_id: sam },
    ]);
    const as = (id: string) => ({
      viewer: personViewer(id as never, systemClock("UTC").now()),
      clock: systemClock("UTC"),
      newId: createIdGenerator(),
      uow: createUnitOfWork(db),
    });
    const seen = (id: string) => listTransactions(as(id)).map((t) => t.descriptionRaw);
    expect(seen(alex).some((d) => d.startsWith("Joint:"))).toBe(true);
    expect(seen(alex).some((d) => d.startsWith("Person A private:"))).toBe(true);
    expect(seen(alex).some((d) => d.startsWith("Person B private:"))).toBe(false);
    expect(seen(sam).some((d) => d.startsWith("Person B private:"))).toBe(true);
    expect(seen(sam).some((d) => d.startsWith("Person A private:"))).toBe(false);
  });

  it("leaves the household settings alone", () => {
    signUp(1, "Alex");
    signUp(2, "Sam");
    // Differs from the seed's timezone, so applying the seed's settings event would change it.
    db.prepare("UPDATE household_settings SET timezone = 'Australia/Perth'").run();
    const before = db.prepare("SELECT * FROM household_settings").get();
    linkSeed(createUnitOfWork(db), deps(), seedJson);
    expect(db.prepare("SELECT * FROM household_settings").get()).toEqual(before);
    expect(db.prepare("SELECT timezone FROM household_settings").pluck().get()).toBe(
      "Australia/Perth",
    );
  });

  it("asks for both partners to sign up first, writing nothing", () => {
    signUp(1, "Alex");
    expect(() => linkSeed(createUnitOfWork(db), deps(), seedJson)).toThrow(/sign up both partners/);
    expect(count("account")).toBe(0);
  });

  it("refuses a ledger that has an account but no transactions, writing nothing", () => {
    signUp(1, "Alex");
    signUp(2, "Sam");
    db.prepare(
      "INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at) VALUES ('01J0000000000000000000009A','x','other','AUD',0,'t','t')",
    ).run();
    const error = rejection(() => linkSeed(createUnitOfWork(db), deps(), seedJson));
    expect(error.code).toBe("Conflict");
    expect(count("account")).toBe(1);
  });

  it("refuses a second run on a ledger that already has transactions", () => {
    signUp(1, "Alex");
    signUp(2, "Sam");
    linkSeed(createUnitOfWork(db), deps(), seedJson);
    const error = rejection(() => linkSeed(createUnitOfWork(db), deps(), seedJson));
    expect(error.code).toBe("Conflict");
    expect(count("account")).toBe(3);
  });
});

describe("seedCommand", () => {
  const adminDeps = (seedFile?: string) =>
    ({
      uow: createUnitOfWork(db),
      ...deps(),
      ...(seedFile === undefined ? {} : { seedFile }),
    }) as AdminDeps;

  it("refuses without a readable seed file", () => {
    expect(() => seedCommand(adminDeps())).toThrow(/no seed file/);
    expect(() => seedCommand(adminDeps(join(seedDir, "missing.json")))).toThrow(
      /could not be read/,
    );
  });

  it("takes no arguments", () => {
    expect(() => seedCommand(adminDeps(join(seedDir, "seed.json")), { path: "x" })).toThrow(
      /Invalid arguments/,
    );
  });
});
