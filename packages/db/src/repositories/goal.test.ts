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

  it("inserts and queries goal allocations with privacy scoping", () => {
    const uow = createUnitOfWork(db);
    const viewerA = { kind: "person", personId: "01J0000000000000000000000A", authAt: 0 } as any;
    const viewerB = { kind: "person", personId: "01J0000000000000000000000B", authAt: 0 } as any;

    uow.transaction((tx) => {
      // Create person records first
      tx.person.insert({
        id: "01J0000000000000000000000A" as any,
        userId: "userA",
        displayName: "Person A",
        colour: "#111111",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      });
      tx.person.insert({
        id: "01J0000000000000000000000B" as any,
        userId: "userB",
        displayName: "Person B",
        colour: "#222222",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      });

      // Create shared goal
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

      // Create personal goal for A
      tx.goals.insert({
        id: "01J000000000000000000GOAL2" as Id<"Goal">,
        personId: "01J0000000000000000000000A" as any,
        name: "A's Hobby",
        targetCents: 50000,
        targetDate: null,
        priority: 2,
        kind: "flexible",
        isEmergencyFund: false,
        completedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      // Insert allocations
      tx.goalAllocations.insertMany([
        {
          id: "01J00000000000000000ALLOC1" as any,
          goalId: "01J000000000000000000GOAL1" as any,
          periodStart: "2026-01-01",
          allocatedCents: 20000,
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "01J00000000000000000ALLOC2" as any,
          goalId: "01J000000000000000000GOAL1" as any,
          periodStart: "2026-01-15",
          allocatedCents: 30000,
          createdAt: "2026-01-15T00:00:00Z",
        },
        {
          id: "01J00000000000000000ALLOC3" as any,
          goalId: "01J000000000000000000GOAL2" as any,
          periodStart: "2026-01-15",
          allocatedCents: 15000,
          createdAt: "2026-01-15T00:00:00Z",
        },
      ]);
    });

    uow.read((r) => {
      // Both viewers can see shared allocations
      expect(r.goalAllocations.sumForGoal(viewerA, "01J000000000000000000GOAL1" as any)).toBe(
        50000,
      );
      expect(r.goalAllocations.sumForGoal(viewerB, "01J000000000000000000GOAL1" as any)).toBe(
        50000,
      );

      // Viewer A can see A's allocations; viewer B cannot
      expect(r.goalAllocations.sumForGoal(viewerA, "01J000000000000000000GOAL2" as any)).toBe(
        15000,
      );
      expect(r.goalAllocations.sumForGoal(viewerB, "01J000000000000000000GOAL2" as any)).toBe(0);

      // Period query
      const allocsPeriodA = r.goalAllocations.listForPeriod(viewerA, "2026-01-15");
      expect(allocsPeriodA).toHaveLength(2);

      const allocsPeriodB = r.goalAllocations.listForPeriod(viewerB, "2026-01-15");
      expect(allocsPeriodB).toHaveLength(1);
      expect(allocsPeriodB[0]?.goalId).toBe("01J000000000000000000GOAL1");
    });
  });
});
