import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Id } from "@pangolin/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "../migrate.ts";
import { type Db, openDatabase } from "../open.ts";
import { createUnitOfWork } from "../unit-of-work.ts";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-goal-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Goal repos", () => {
  it("enforces unique emergency fund per pool in sqlite", () => {
    const uow = createUnitOfWork(db);

    uow.transaction((tx) => {
      // Insert first shared emergency fund
      tx.goals.insert({
        id: "01J000000000000000000GOAL1" as Id<"Goal">,
        personId: null,
        name: "Rainy day",
        targetCents: 100000,
        targetDate: null,
        priority: 1,
        kind: "protected",
        isEmergencyFund: true,
        completedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      // Attempt to insert second shared emergency fund -> must fail unique index constraint
      expect(() => {
        tx.goals.insert({
          id: "01J000000000000000000GOAL2" as Id<"Goal">,
          personId: null,
          name: "Second emergency fund",
          targetCents: 200000,
          targetDate: null,
          priority: 2,
          kind: "protected",
          isEmergencyFund: true,
          completedAt: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        });
      }).toThrow();
    });
  });
});
