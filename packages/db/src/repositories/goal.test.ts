import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Id, Viewer } from "@pangolin/app";
import { personViewer } from "@pangolin/app";
import { Temporal } from "@pangolin/shared/temporal";
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

  it("persists drawdowns and adjustments, enforces pool privacy and handles undo", () => {
    const uow = createUnitOfWork(db);
    const personA = "01J0000000000000000000000A" as any;
    const personB = "01J0000000000000000000000B" as any;

    const now = Temporal.Instant.from("2026-09-27T00:00:00Z");
    const viewerA: Viewer = personViewer(personA, now);
    const viewerB: Viewer = personViewer(personB, now);

    const ddId = "01J00000000000000000000DD1" as any;
    const adjId = "01J0000000000000000000ADJ1" as any;

    uow.transaction((tx) => {
      tx.person.insert({
        id: personA,
        userId: "userA",
        displayName: "Person A",
        colour: "#111111",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      });
      tx.person.insert({
        id: personB,
        userId: "userB",
        displayName: "Person B",
        colour: "#222222",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      });

      // Goals
      tx.goals.insert({
        id: "01J000000000000000000GOAL1" as any,
        personId: null,
        name: "Shared Goal",
        targetCents: 100000,
        targetDate: null,
        priority: 0,
        kind: "flexible",
        isEmergencyFund: false,
        completedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      tx.goalDrawdowns.insert({
        id: ddId,
        personId: null,
        reason: "large_purchase",
        label: "Furniture",
        amountCents: 20000,
        transactionId: null,
        createdBy: personA,
        createdAt: "2026-01-10T00:00:00Z",
        undoneAt: null,
      });

      tx.goalAdjustments.insert({
        id: adjId,
        drawdownId: ddId,
        goalId: "01J000000000000000000GOAL1" as any,
        amountCents: 20000,
      });
    });

    uow.read((r) => {
      expect(r.goalDrawdowns.findById(viewerA, ddId)?.amountCents).toBe(20000);
      expect(r.goalDrawdowns.findById(viewerB, ddId)?.amountCents).toBe(20000);

      const activeDrawdowns = r.goalDrawdowns.listActiveForPool(viewerA, "shared");
      expect(activeDrawdowns).toHaveLength(1);
      expect(activeDrawdowns[0]?.id).toBe(ddId);

      const adjs = r.goalAdjustments.listForDrawdown(viewerA, ddId);
      expect(adjs).toHaveLength(1);
      expect(adjs[0]?.amountCents).toBe(20000);

      expect(r.goalAdjustments.sumActiveForGoal(viewerA, "01J000000000000000000GOAL1" as any)).toBe(
        20000,
      );
      expect(r.goalAdjustments.sumActiveForGoal(viewerB, "01J000000000000000000GOAL1" as any)).toBe(
        20000,
      );
    });

    // Mark undone
    uow.transaction((tx) => {
      const undone = tx.goalDrawdowns.markUndone(ddId, "2026-01-11T00:00:00Z");
      expect(undone).toBe(true);
    });

    uow.read((r) => {
      expect(r.goalDrawdowns.findById(viewerA, ddId)?.undoneAt).toBe("2026-01-11T00:00:00Z");
      expect(r.goalDrawdowns.listActiveForPool(viewerA, "shared")).toHaveLength(0);
      expect(r.goalAdjustments.sumActiveForGoal(viewerA, "01J000000000000000000GOAL1" as any)).toBe(
        0,
      );
    });
  });
});
