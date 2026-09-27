import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, createIdGenerator, systemClock } from "@pangolin/app";
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
import { applySeed, parseSeed } from "./seed.ts";

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
    // The default settings already match the seed, so only the people are written.
    expect(audit).toHaveLength(count("person") as number);
    for (const row of audit)
      expect(row).toEqual({ actor: "cli:seed", entity: "person", action: "create" });
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
    const events = [...seed.events, { type: "account.created", module: "accounts", key: "x" }];
    const error = rejection(() => applySeed(createUnitOfWork(db), deps(), withEvents(events)));
    expect(error.message).toContain(
      `events.${seed.events.length}: unknown event type "account.created"`,
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
