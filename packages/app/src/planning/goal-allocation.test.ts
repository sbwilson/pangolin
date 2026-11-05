import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock.ts";
import type {
  AllocationStageRow,
  GoalAllocationRow,
  GoalRow,
  GoalRuleRow,
} from "../ports/unit-of-work.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import type { UseCaseContext } from "../write.ts";
import {
  allocatePeriodSavings,
  calculateGoalBalances,
  executeSavingsAllocation,
  rescaleGoalRules,
  resolveActiveStage,
} from "./goal-allocation.ts";

describe("planning/goal-allocation", () => {
  const clock = fixedClock(parseDate("2026-07-15"));
  let idCounter = 1;
  const newId = () => `01J000000000000000000000${String(idCounter++).padStart(2, "0")}` as any;

  it("calculates goal balances from allocations and adjustments", () => {
    const goalId1 = "01J000000000000000000GOAL1" as any;
    const goalId2 = "01J000000000000000000GOAL2" as any;

    const allocations: GoalAllocationRow[] = [
      {
        id: "ALLOC1" as any,
        goalId: goalId1,
        periodStart: "2026-01-01",
        allocatedCents: 50_000,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "ALLOC2" as any,
        goalId: goalId1,
        periodStart: "2026-01-15",
        allocatedCents: 30_000,
        createdAt: "2026-01-15T00:00:00Z",
      },
      {
        id: "ALLOC3" as any,
        goalId: goalId2,
        periodStart: "2026-01-15",
        allocatedCents: 10_000,
        createdAt: "2026-01-15T00:00:00Z",
      },
    ];

    const adjustments = [{ goalId: goalId1, amountCents: 15_000 }];

    const balances = calculateGoalBalances(allocations, adjustments);

    expect(balances.get(goalId1)?.allocatedCents).toBe(80_000);
    expect(balances.get(goalId1)?.adjustedCents).toBe(15_000);
    expect(balances.get(goalId1)?.currentBalance).toBe(65_000);

    expect(balances.get(goalId2)?.allocatedCents).toBe(10_000);
    expect(balances.get(goalId2)?.adjustedCents).toBe(0);
    expect(balances.get(goalId2)?.currentBalance).toBe(10_000);
  });

  it("resolves active stage: advances when exit goal completed, falls back when emergency fund below threshold", () => {
    const efGoal: GoalRow = {
      id: "EF" as any,
      personId: null,
      name: "Emergency Fund",
      targetCents: 20_000_00, // $20,000
      targetDate: null,
      priority: 1,
      kind: "protected",
      isEmergencyFund: true,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const houseGoal: GoalRow = {
      id: "HOUSE" as any,
      personId: null,
      name: "House Deposit",
      targetCents: 100_000_00, // $100,000
      targetDate: null,
      priority: 2,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const stage1: AllocationStageRow = {
      id: "STAGE1" as any,
      personId: null,
      name: "Stage 1",
      sort: 1,
      exitGoalId: "EF" as any,
      fallbackThresholdBp: 8000, // 80% = $16,000
      completedSharePolicy: "rescale",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const stage2: AllocationStageRow = {
      id: "STAGE2" as any,
      personId: null,
      name: "Stage 2",
      sort: 2,
      exitGoalId: null,
      fallbackThresholdBp: 8000,
      completedSharePolicy: "rescale",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const stages = [stage1, stage2];
    const goals = [efGoal, houseGoal];

    // Case 1: EF not reached ($10,000 of $20,000) -> Stage 1 active
    const balances1 = calculateGoalBalances([
      {
        id: "A1" as any,
        goalId: "EF" as any,
        periodStart: "2026-01-01",
        allocatedCents: 10_000_00,
        createdAt: "",
      },
    ]);
    const res1 = resolveActiveStage(stages, goals, balances1);
    expect(res1.activeStage?.id).toBe("STAGE1");
    expect(res1.isFallback).toBe(false);

    // Case 2: EF reached ($20,000) -> Stage 2 active
    const balances2 = calculateGoalBalances([
      {
        id: "A1" as any,
        goalId: "EF" as any,
        periodStart: "2026-01-01",
        allocatedCents: 20_000_00,
        createdAt: "",
      },
    ]);
    const res2 = resolveActiveStage(stages, goals, balances2);
    expect(res2.activeStage?.id).toBe("STAGE2");
    expect(res2.isFallback).toBe(false);

    // Case 3: EF dropped below 80% ($15,500 < $16,000 fallback threshold) -> Stage 1 reactivates (fallback!)
    const balances3 = calculateGoalBalances(
      [
        {
          id: "A1" as any,
          goalId: "EF" as any,
          periodStart: "2026-01-01",
          allocatedCents: 20_000_00,
          createdAt: "",
        },
      ],
      [{ goalId: "EF" as any, amountCents: 4_500_00 }], // $20,000 - $4,500 = $15,500
    );
    const res3 = resolveActiveStage(stages, goals, balances3);
    expect(res3.activeStage?.id).toBe("STAGE1");
    expect(res3.isFallback).toBe(true);

    // Case 4: EF dropped slightly to $17,000 (> $16,000 threshold) -> does NOT fall back, Stage 2 remains active
    const balances4 = calculateGoalBalances(
      [
        {
          id: "A1" as any,
          goalId: "EF" as any,
          periodStart: "2026-01-01",
          allocatedCents: 20_000_00,
          createdAt: "",
        },
      ],
      [{ goalId: "EF" as any, amountCents: 3_000_00 }], // $17,000
    );
    const res4 = resolveActiveStage(stages, goals, balances4);
    expect(res4.activeStage?.id).toBe("STAGE2");
    expect(res4.isFallback).toBe(false);

    // Case 5: EF never reached 100% (only $18,000 allocated, no drawdowns) -> Stage 1 remains active
    const balances5 = calculateGoalBalances([
      {
        id: "A1" as any,
        goalId: "EF" as any,
        periodStart: "2026-01-01",
        allocatedCents: 18_000_00,
        createdAt: "",
      },
    ]);
    const res5 = resolveActiveStage(stages, goals, balances5);
    expect(res5.activeStage?.id).toBe("STAGE1");
    expect(res5.isFallback).toBe(false);
  });

  it("rescales rules when intermediate goal completes", () => {
    const houseGoal: GoalRow = {
      id: "HOUSE" as any,
      personId: null,
      name: "House",
      targetCents: 50_000_00,
      targetDate: null,
      priority: 1,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "",
      updatedAt: "",
    };

    const holidayGoal: GoalRow = {
      id: "HOLIDAY" as any,
      personId: null,
      name: "Holiday",
      targetCents: 8_000_00,
      targetDate: null,
      priority: 2,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "",
      updatedAt: "",
    };

    const rules: GoalRuleRow[] = [
      {
        id: "R1" as any,
        stageId: "S2" as any,
        goalId: "HOUSE" as any,
        shareBp: 6000,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
        source: "rule",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "R2" as any,
        stageId: "S2" as any,
        goalId: "HOLIDAY" as any,
        shareBp: 4000,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
        source: "rule",
        createdAt: "",
        updatedAt: "",
      },
    ];

    // Holiday goal completed: balance = $8,000
    const balances = calculateGoalBalances([
      {
        id: "A1" as any,
        goalId: "HOUSE" as any,
        periodStart: "2026-01-01",
        allocatedCents: 20_000_00,
        createdAt: "",
      },
      {
        id: "A2" as any,
        goalId: "HOLIDAY" as any,
        periodStart: "2026-01-01",
        allocatedCents: 8_000_00,
        createdAt: "",
      },
    ]);

    // Rescale policy: Holiday gets 0, House gets 100% (10000 bp)
    const rescaled = rescaleGoalRules(rules, [houseGoal, holidayGoal], balances, "rescale");
    const houseRule = rescaled.find((r) => r.goalId === "HOUSE");
    const holidayRule = rescaled.find((r) => r.goalId === "HOLIDAY");

    expect(holidayRule?.rescaledShareBp).toBe(0);
    expect(houseRule?.rescaledShareBp).toBe(10000);

    // Buffer policy: Holiday gets 0, House keeps 60% (6000 bp)
    const bufferRescaled = rescaleGoalRules(rules, [houseGoal, holidayGoal], balances, "buffer");
    expect(bufferRescaled.find((r) => r.goalId === "HOLIDAY")?.rescaledShareBp).toBe(0);
    expect(bufferRescaled.find((r) => r.goalId === "HOUSE")?.rescaledShareBp).toBe(6000);
  });

  it("allocates multi-period savings and handles exit goal overflow cascade into next stage", () => {
    // Stage 1: 80% Emergency Fund (exit goal $20,000), 10% House, 10% Holiday
    // Stage 2: 60% House, 40% Holiday
    const efGoal: GoalRow = {
      id: "EF" as any,
      personId: null,
      name: "Emergency Fund",
      targetCents: 20_000_00, // $20,000
      targetDate: null,
      priority: 1,
      kind: "protected",
      isEmergencyFund: true,
      completedAt: null,
      createdAt: "",
      updatedAt: "",
    };

    const houseGoal: GoalRow = {
      id: "HOUSE" as any,
      personId: null,
      name: "House",
      targetCents: 100_000_00,
      targetDate: null,
      priority: 2,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "",
      updatedAt: "",
    };

    const holidayGoal: GoalRow = {
      id: "HOLIDAY" as any,
      personId: null,
      name: "Holiday",
      targetCents: 50_000_00,
      targetDate: null,
      priority: 3,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "",
      updatedAt: "",
    };

    const stage1: AllocationStageRow = {
      id: "S1" as any,
      personId: null,
      name: "Stage 1",
      sort: 1,
      exitGoalId: "EF" as any,
      fallbackThresholdBp: 8000,
      completedSharePolicy: "rescale",
      createdAt: "",
      updatedAt: "",
    };

    const stage2: AllocationStageRow = {
      id: "S2" as any,
      personId: null,
      name: "Stage 2",
      sort: 2,
      exitGoalId: null,
      fallbackThresholdBp: 8000,
      completedSharePolicy: "rescale",
      createdAt: "",
      updatedAt: "",
    };

    const stages = [stage1, stage2];
    const goals = [efGoal, houseGoal, holidayGoal];

    const rulesByStage = new Map<any, GoalRuleRow[]>([
      [
        "S1",
        [
          {
            id: "R1" as any,
            stageId: "S1" as any,
            goalId: "EF" as any,
            shareBp: 8000,
            effectiveFrom: "2026-01-01",
            effectiveUntil: null,
            source: "rule",
            createdAt: "",
            updatedAt: "",
          },
          {
            id: "R2" as any,
            stageId: "S1" as any,
            goalId: "HOUSE" as any,
            shareBp: 1000,
            effectiveFrom: "2026-01-01",
            effectiveUntil: null,
            source: "rule",
            createdAt: "",
            updatedAt: "",
          },
          {
            id: "R3" as any,
            stageId: "S1" as any,
            goalId: "HOLIDAY" as any,
            shareBp: 1000,
            effectiveFrom: "2026-01-01",
            effectiveUntil: null,
            source: "rule",
            createdAt: "",
            updatedAt: "",
          },
        ],
      ],
      [
        "S2",
        [
          {
            id: "R4" as any,
            stageId: "S2" as any,
            goalId: "HOUSE" as any,
            shareBp: 6000,
            effectiveFrom: "2026-01-01",
            effectiveUntil: null,
            source: "rule",
            createdAt: "",
            updatedAt: "",
          },
          {
            id: "R5" as any,
            stageId: "S2" as any,
            goalId: "HOLIDAY" as any,
            shareBp: 4000,
            effectiveFrom: "2026-01-01",
            effectiveUntil: null,
            source: "rule",
            createdAt: "",
            updatedAt: "",
          },
        ],
      ],
    ]);

    // Scenario: EF already has $19,700 (needs $300 to complete).
    // Period savings = $1,000 (100,000 cents).
    // Expected:
    // EF gets $300 (completes Stage 1 exit goal).
    // In Stage 1, spending to get $300 at 80% is $375:
    // EF gets $300 (80%), House gets $37.50, Holiday gets $37.50 -> rounded integer cents.
    // Remaining $625 cascades to Stage 2:
    // House gets 60% of $625 = $375, Holiday gets 40% of $625 = $250.
    // Total allocations sum to $1,000 exactly!
    const initialBalances = calculateGoalBalances([
      {
        id: "A0" as any,
        goalId: "EF" as any,
        periodStart: "2026-01-01",
        allocatedCents: 19_700_00,
        createdAt: "",
      },
    ]);

    const res = allocatePeriodSavings(100_000, stages, rulesByStage, goals, initialBalances);

    expect(res.stageTransitions).toHaveLength(1);
    expect(res.stageTransitions[0]?.fromStageId).toBe("S1");
    expect(res.stageTransitions[0]?.toStageId).toBe("S2");
    expect(res.stageTransitions[0]?.exitGoalId).toBe("EF");

    const efAlloc = res.allocations.find((a) => a.goalId === "EF")?.amountCents ?? 0;
    const houseAlloc = res.allocations.find((a) => a.goalId === "HOUSE")?.amountCents ?? 0;
    const holidayAlloc = res.allocations.find((a) => a.goalId === "HOLIDAY")?.amountCents ?? 0;

    expect(efAlloc).toBe(300_00);
    expect(efAlloc + houseAlloc + holidayAlloc).toBe(100_000);
    expect(res.remainderSavingsCents).toBe(0);
  });

  it("executeSavingsAllocation use case records allocations and audit log", () => {
    const uow = memoryUnitOfWork();
    const personA = "01J0000000000000000000000A" as any;

    uow.state.goals.push({
      id: "EF" as any,
      personId: null,
      name: "Emergency Fund",
      targetCents: 100_000, // $1,000 target
      targetDate: null,
      priority: 1,
      kind: "protected",
      isEmergencyFund: true,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    uow.state.goals.push({
      id: "HOLIDAY" as any,
      personId: null,
      name: "Holiday",
      targetCents: 200_000,
      targetDate: null,
      priority: 2,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    uow.state.stages.push({
      id: "S1" as any,
      personId: null,
      name: "Stage 1",
      sort: 1,
      exitGoalId: "EF" as any,
      fallbackThresholdBp: 8000,
      completedSharePolicy: "rescale",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    uow.state.goalRules.push(
      {
        id: "R1" as any,
        stageId: "S1" as any,
        goalId: "EF" as any,
        shareBp: 8000,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
        source: "rule",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "R2" as any,
        stageId: "S1" as any,
        goalId: "HOLIDAY" as any,
        shareBp: 2000,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
        source: "rule",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    );

    const ctx: UseCaseContext = {
      viewer: personViewer(personA, clock.now()),
      clock,
      newId,
      uow,
    };

    // Execute allocation of $500 (50,000 cents)
    const result = executeSavingsAllocation(ctx, {
      periodStart: "2026-07-01",
      savingsCents: 50_000,
      pool: "shared",
    });

    expect(result.totalAllocatedCents).toBe(50_000);
    expect(result.bufferCents).toBe(0);
    expect(result.allocations).toHaveLength(2);

    const efAlloc = result.allocations.find((a) => a.goalId === "EF");
    const holidayAlloc = result.allocations.find((a) => a.goalId === "HOLIDAY");
    expect(efAlloc?.allocatedCents).toBe(40_000); // 80%
    expect(holidayAlloc?.allocatedCents).toBe(10_000); // 20%

    // Verifying stored goal_allocation rows in uow
    expect(uow.state.goalAllocations).toHaveLength(2);

    // Audit logs recorded
    const allocAudits = uow.state.audit.filter((a) => a.entity === "goal_allocation");
    expect(allocAudits).toHaveLength(2);
  });
});
