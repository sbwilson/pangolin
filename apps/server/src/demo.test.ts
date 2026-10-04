import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, listTransactions, personViewer } from "@pangolin/app";
import { packageMigrationsDir } from "@pangolin/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeedFile } from "../scripts/demo-seed.ts";
import { openDemoDatabase, readOnlyUnitOfWork } from "./demo.ts";

let dir: string;
let seedFile: string;
let expectations: Record<string, unknown>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-demo-"));
  seedFile = join(dir, "demo-seed.json");
  generateSeedFile(seedFile);
  expectations = JSON.parse(readFileSync(seedFile, "utf8")).expectations;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openDemoDatabase", () => {
  it("holds the seeded people and refuses writes", () => {
    const demo = openDemoDatabase({ migrationsDir: packageMigrationsDir, seedFile });
    try {
      const names = demo.db.prepare("SELECT display_name FROM person ORDER BY id").pluck().all();
      expect(names).toEqual(expectations["people-and-household.peopleNames"]);
      expect(demo.db.name).toBe(":memory:");
      expect(() => demo.uow.transaction(() => 1)).toThrow(AppError);
      expect(demo.uow.read((repos) => repos.householdSettings.get().baseCurrency)).toBe(
        expectations["people-and-household.baseCurrency"],
      );
      // Hidden names and transfers are applied as the account's owner, so the audit log also
      // names the seeded people.
      const people = demo.db.prepare("SELECT 'person:' || id FROM person").pluck().all();
      const actors = demo.db
        .prepare("SELECT DISTINCT actor FROM audit_log ORDER BY actor")
        .pluck()
        .all();
      expect(actors.filter((a) => !people.includes(a))).toEqual(["cli:seed", "job:seed-defaults"]);
      // The demo household has the default categories (story 2.5).
      expect(demo.db.prepare("SELECT count(*) FROM category_group").pluck().get()).toBe(13);
      // Every run uses the seed's fixed today (AD-15), never the real clock.
      const today = JSON.parse(readFileSync(seedFile, "utf8")).today as string;
      const stamps = demo.db.prepare("SELECT at FROM audit_log").pluck().all() as string[];
      expect(stamps.length).toBeGreaterThan(0);
      for (const at of stamps) expect(at.startsWith(`${today}T`)).toBe(true);
      expect(demo.clock.now().toString()).toBe(`${today}T00:00:00Z`);
    } finally {
      demo.db.close();
    }
  });
});

describe("the demo ledger", () => {
  it("holds the seeded ledger, each person sees their own view, and names are hidden to the 12-month limit", () => {
    const demo = openDemoDatabase({ migrationsDir: packageMigrationsDir, seedFile });
    try {
      const count = (table: string) =>
        demo.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();
      expect(count("account")).toBe(
        (expectations["institutions-and-accounts.accountKeys"] as string[]).length,
      );
      expect(count('"transaction"')).toBe(expectations["transfers-and-privacy.transactionCount"]);
      expect(count("balance_snapshot")).toBe(expectations["balance-snapshots.snapshotCount"]);
      const [a, b] = demo.db.prepare("SELECT id FROM person ORDER BY id").pluck().all() as string[];
      const view = (id: string) => ({
        viewer: personViewer(id as never, demo.clock.now()),
        clock: demo.clock,
        newId: () => "x" as never,
        uow: demo.uow,
      });
      const counts = expectations["transfers-and-privacy.visibleCounts"] as Record<string, number>;
      // Person IDs are minted at random, so match each person to their private account.
      const ownerOfA = demo.db
        .prepare(
          "SELECT o.person_id FROM account a JOIN account_owner o ON o.account_id = a.id WHERE a.name = 'Person A private'",
        )
        .pluck()
        .get() as string;
      const [personA, personB] = ownerOfA === a ? [a, b] : [b, a];
      expect(listTransactions(view(personA as string))).toHaveLength(counts["person-a"] as number);
      const seen = listTransactions(view(personB as string));
      expect(seen).toHaveLength(counts["person-b"] as number);
      // Fixed today 2026-07-15 plus 12 months.
      expect(
        seen.filter((t) => t.descriptionRaw === "Hidden until 15 Jul 2027").length,
      ).toBeGreaterThan(0);
    } finally {
      demo.db.close();
    }
  });
});

describe("readOnlyUnitOfWork", () => {
  it("throws Conflict for a write without calling the inner transaction", () => {
    let called = false;
    const uow = readOnlyUnitOfWork({
      transaction: () => {
        called = true;
        return undefined as never;
      },
      read: (fn) => fn({} as never),
    });
    expect(() => uow.transaction(() => 1)).toThrow(
      expect.objectContaining({ code: "Conflict", message: "Demo mode is read-only" }),
    );
    expect(called).toBe(false);
    expect(uow.read(() => "ok")).toBe("ok");
  });
});
