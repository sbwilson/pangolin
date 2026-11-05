import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock.ts";
import { AppError } from "../errors.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import type { UseCaseContext } from "../write.ts";
import {
  createGoal,
  getGoalsSummary,
  getSavingsPoolBalances,
  listGoals,
  updateGoal,
} from "./goals.ts";

describe("planning/goals", () => {
  const clock = fixedClock(parseDate("2026-07-15"));
  const newId = () => "01J00000000000000000000001" as any;

  it("calculates pool balances scoping correctly for viewer", () => {
    const uow = memoryUnitOfWork();
    const personA = "01J0000000000000000000000A" as any;
    const personB = "01J0000000000000000000000B" as any;

    uow.state.people.push(
      {
        id: personA,
        userId: "userA",
        displayName: "Person A",
        colour: "#111111",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      },
      {
        id: personB,
        userId: "userB",
        displayName: "Person B",
        colour: "#222222",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      },
    );

    // 1. Joint savings account ($63,080 = 6,308,000 cents)
    const jointSavingsId = "01J000000000000000000ACCT1" as any;
    uow.state.accounts.push({
      id: jointSavingsId,
      name: "Joint Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: "2026-01-01",
      closedOn: null,
      isSavings: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    uow.state.accountOwners.push(
      {
        accountId: jointSavingsId,
        personId: personA,
        shareBp: 5000,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        accountId: jointSavingsId,
        personId: personB,
        shareBp: 5000,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    );
    uow.state.balanceSnapshots.push({
      id: "01J000000000000000000SNAP1" as any,
      accountId: jointSavingsId,
      asOf: "2026-07-15",
      balanceCents: 6_308_000,
      source: "manual",
      importBatchId: null,
      createdAt: "2026-07-15T00:00:00Z",
    });

    // 2. Person A private savings ($1,200 = 120,000 cents)
    const privSavingsAId = "01J000000000000000000ACCT2" as any;
    uow.state.accounts.push({
      id: privSavingsAId,
      name: "A Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: true,
      institutionId: null,
      openedOn: "2026-01-01",
      closedOn: null,
      isSavings: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    uow.state.accountOwners.push({
      accountId: privSavingsAId,
      personId: personA,
      shareBp: 10000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    uow.state.balanceSnapshots.push({
      id: "01J000000000000000000SNAP2" as any,
      accountId: privSavingsAId,
      asOf: "2026-07-15",
      balanceCents: 120_000,
      source: "manual",
      importBatchId: null,
      createdAt: "2026-07-15T00:00:00Z",
    });

    // 3. Person B private savings ($5,000 = 500,000 cents)
    const privSavingsBId = "01J000000000000000000ACCT3" as any;
    uow.state.accounts.push({
      id: privSavingsBId,
      name: "B Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: true,
      institutionId: null,
      openedOn: "2026-01-01",
      closedOn: null,
      isSavings: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    uow.state.accountOwners.push({
      accountId: privSavingsBId,
      personId: personB,
      shareBp: 10000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    uow.state.balanceSnapshots.push({
      id: "01J000000000000000000SNAP3" as any,
      accountId: privSavingsBId,
      asOf: "2026-07-15",
      balanceCents: 500_000,
      source: "manual",
      importBatchId: null,
      createdAt: "2026-07-15T00:00:00Z",
    });

    // Query as Person A
    const ctxA: UseCaseContext = {
      viewer: personViewer(personA, clock.now()),
      clock,
      newId,
      uow,
    };
    const resA = getSavingsPoolBalances(ctxA);

    // Person A sees shared ($63,080) and Person A pool ($1,200), NOT Person B pool!
    expect(resA.asOf).toBe("2026-07-15");
    const sharedPoolA = resA.pools.find((p) => p.pool === "shared");
    expect(sharedPoolA?.totalCents).toBe(6_308_000);
    const personalPoolA = resA.pools.find((p) => p.pool === personA);
    expect(personalPoolA?.totalCents).toBe(120_000);
    const personalPoolBSeenByA = resA.pools.find((p) => p.pool === personB);
    expect(personalPoolBSeenByA).toBeUndefined();

    // Query as Person B
    const ctxB: UseCaseContext = {
      viewer: personViewer(personB, clock.now()),
      clock,
      newId,
      uow,
    };
    const resB = getSavingsPoolBalances(ctxB);

    // Person B sees shared ($63,080) and Person B pool ($5,000), NOT Person A pool!
    const sharedPoolB = resB.pools.find((p) => p.pool === "shared");
    expect(sharedPoolB?.totalCents).toBe(6_308_000);
    const personalPoolB = resB.pools.find((p) => p.pool === personB);
    expect(personalPoolB?.totalCents).toBe(500_000);
    const personalPoolASeenByB = resB.pools.find((p) => p.pool === personA);
    expect(personalPoolASeenByB).toBeUndefined();
  });

  it("lists goals with privacy scoping and returns summary", () => {
    const uow = memoryUnitOfWork();
    const personA = "01J0000000000000000000000A" as any;
    const personB = "01J0000000000000000000000B" as any;

    // Shared goal: Rainy day (Emergency fund)
    uow.state.goals.push({
      id: "01J000000000000000000GOAL1" as any,
      personId: null,
      name: "Rainy day emergency fund",
      targetCents: 2_000_000,
      targetDate: null,
      priority: 1,
      kind: "protected",
      isEmergencyFund: true,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // Personal goal for A: New laptop
    uow.state.goals.push({
      id: "01J000000000000000000GOAL2" as any,
      personId: personA,
      name: "New laptop",
      targetCents: 300_000,
      targetDate: "2026-12-31",
      priority: 1,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // Personal goal for B: Secret surprise
    uow.state.goals.push({
      id: "01J000000000000000000GOAL3" as any,
      personId: personB,
      name: "Secret surprise",
      targetCents: 150_000,
      targetDate: "2026-11-01",
      priority: 1,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // Stage 1
    uow.state.stages.push({
      id: "01J00000000000000000STAGE1" as any,
      personId: null,
      name: "Stage 1: Emergency fund first",
      sort: 1,
      exitGoalId: "01J000000000000000000GOAL1" as any,
      fallbackThresholdBp: 8000,
      completedSharePolicy: "rescale",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const ctxA: UseCaseContext = {
      viewer: personViewer(personA, clock.now()),
      clock,
      newId: () => "01J00000000000000000000001" as any,
      uow,
    };

    const goalsA = listGoals(ctxA);
    expect(goalsA).toHaveLength(2);
    expect(goalsA.map((g) => g.name)).toEqual(["Rainy day emergency fund", "New laptop"]);

    const summaryA = getGoalsSummary(ctxA);
    expect(summaryA.goals).toHaveLength(2);
    expect(summaryA.stages).toHaveLength(1);
    expect(summaryA.activeStage?.name).toBe("Stage 1: Emergency fund first");
  });

  it("createGoal rejects duplicate emergency fund in the same pool", () => {
    const uow = memoryUnitOfWork();
    const personA = "01J0000000000000000000000A" as any;
    let idSeq = 1;
    const ctx: UseCaseContext = {
      viewer: personViewer(personA, clock.now()),
      clock,
      newId: () => `01J0000000000000000000000${idSeq++}` as any,
      uow,
    };

    // Create initial emergency fund in shared pool
    const ef1 = createGoal(ctx, {
      name: "Emergency Fund",
      targetCents: 1000000,
      isEmergencyFund: true,
      pool: "shared",
    });
    expect(ef1.id).toBeDefined();

    // Attempt to create second emergency fund in shared pool -> rejected with Conflict
    expect(() => {
      createGoal(ctx, {
        name: "Second Emergency Fund",
        targetCents: 500000,
        isEmergencyFund: true,
        pool: "shared",
      });
    }).toThrow(AppError);

    try {
      createGoal(ctx, {
        name: "Second Emergency Fund",
        targetCents: 500000,
        isEmergencyFund: true,
        pool: "shared",
      });
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError);
      expect(e.code).toBe("Conflict");
      expect(e.message).toBe("Pool already has an emergency fund");
    }

    // Creating non-emergency fund in shared pool succeeds
    const nonEf = createGoal(ctx, {
      name: "Holiday",
      targetCents: 300000,
      isEmergencyFund: false,
      pool: "shared",
    });
    expect(nonEf.id).toBeDefined();

    // Creating emergency fund in personal pool succeeds (separate pool)
    const personalEf = createGoal(ctx, {
      name: "A's Emergency Fund",
      targetCents: 200000,
      isEmergencyFund: true,
      pool: personA,
    });
    expect(personalEf.id).toBeDefined();

    // But creating a second one in A's personal pool fails
    expect(() => {
      createGoal(ctx, {
        name: "A's Second Emergency Fund",
        targetCents: 200000,
        isEmergencyFund: true,
        pool: personA,
      });
    }).toThrow(AppError);

    // Updating nonEf to isEmergencyFund = true fails when pool already has one
    expect(() => {
      updateGoal(ctx, {
        id: nonEf.id,
        isEmergencyFund: true,
      });
    }).toThrow(AppError);

    // Updating nonEf's name or target succeeds
    const updatedNonEf = updateGoal(ctx, {
      id: nonEf.id,
      name: "Holiday Updated",
      targetCents: 350000,
    });
    expect(updatedNonEf.name).toBe("Holiday Updated");
    expect(updatedNonEf.targetCents).toBe(350000);
  });
});
