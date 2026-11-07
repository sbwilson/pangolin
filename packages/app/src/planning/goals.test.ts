import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock.ts";
import { AppError } from "../errors.ts";
import { systemViewer } from "../system-viewer.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import type { UseCaseContext } from "../write.ts";
import { executeSavingsAllocation } from "./goal-allocation.ts";
import {
  applyBufferDivert,
  clearBufferDivert,
  createGoal,
  createStage,
  deleteGoal,
  deleteStage,
  getGoalsSummary,
  getSavingsPoolBalances,
  listGoals,
  setStageRules,
  updateGoal,
  updateStage,
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
      updatedAt: "2026-07-15T00:00:00Z",
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
      updatedAt: "2026-07-15T00:00:00Z",
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
      updatedAt: "2026-07-15T00:00:00Z",
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

  // ---- story 7.4: deleteGoal, stage & rule CRUD, summary projections ----

  const anaId = "01J000000000000000000000A1" as any;
  const benId = "01J000000000000000000000B3" as any;

  function makeCtx(uow: ReturnType<typeof memoryUnitOfWork>, personId: string | null = anaId) {
    let n = 0;
    const newId = (() =>
      `01J000000000000000000ID${String(++n).padStart(3, "0")}`) as unknown as UseCaseContext["newId"];
    return {
      viewer:
        personId === null ? systemViewer("cli:test") : personViewer(personId as any, clock.now()),
      clock,
      newId,
      uow,
    } as UseCaseContext;
  }

  const sharedGoal = (id: string, name: string, over: Record<string, unknown> = {}) =>
    ({
      id,
      personId: null,
      name,
      targetCents: 100_000,
      targetDate: null,
      priority: 0,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      ...over,
    }) as any;

  describe("deleteGoal", () => {
    it("deletes a goal with no references and records a delete audit", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(sharedGoal("G1", "Kayak"));
      const ctx = makeCtx(uow);

      deleteGoal(ctx, { id: "G1" });

      expect(uow.state.goals).toHaveLength(0);
      const auditRow = uow.state.audit.find((a) => a.action === "delete");
      expect(auditRow?.entity).toBe("goal");
      expect(auditRow?.entityId).toBe("G1");
    });

    it("deletes the goal's rules with it", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(sharedGoal("G1", "Kayak"));
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 0,
        exitGoalId: null,
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      uow.state.goalRules.push({
        id: "R1",
        stageId: "S1",
        goalId: "G1",
        shareBp: 5000,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
        source: "rule",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      const ctx = makeCtx(uow);

      deleteGoal(ctx, { id: "G1" });

      expect(uow.state.goals).toHaveLength(0);
      expect(uow.state.goalRules).toHaveLength(0);
      expect(uow.state.stages).toHaveLength(1);
    });

    it("blocks deletion while a stage ends with the goal, naming the stage", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(sharedGoal("G1", "Rainy day", { isEmergencyFund: true }));
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Emergency fund first",
        sort: 0,
        exitGoalId: "G1",
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      const ctx = makeCtx(uow);

      const error = capture(() => deleteGoal(ctx, { id: "G1" }));
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("Conflict");
      expect((error as Error).message).toContain("Emergency fund first");
      expect(uow.state.goals).toHaveLength(1);
    });

    it("blocks deletion once the goal has savings history", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(sharedGoal("G1", "Kayak"));
      uow.state.goalAllocations.push({
        id: "A1",
        goalId: "G1",
        periodStart: "2026-07-01",
        allocatedCents: 5000,
        createdAt: "2026-07-01T00:00:00Z",
      } as any);
      const ctx = makeCtx(uow);

      const error = capture(() => deleteGoal(ctx, { id: "G1" }));
      expect((error as AppError).code).toBe("Conflict");
      expect((error as Error).message).toMatch(/savings history/);
      expect(uow.state.goals).toHaveLength(1);
    });

    it("answers NotFound for an unknown goal or one in another pool", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(sharedGoal("G-BEN", "Ben's goal", { personId: benId }));
      const ctx = makeCtx(uow);

      expect((capture(() => deleteGoal(ctx, { id: "nope" })) as AppError).code).toBe("NotFound");
      expect((capture(() => deleteGoal(ctx, { id: "G-BEN" })) as AppError).code).toBe("NotFound");
    });
  });

  describe("stage CRUD", () => {
    it("creates a stage at the end of the pool ladder with defaults", () => {
      const uow = memoryUnitOfWork();
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 3,
        exitGoalId: null,
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      const ctx = makeCtx(uow);

      const created = createStage(ctx, { name: "Stage 2" });

      expect(created.sort).toBe(4);
      expect(created.personId).toBeNull();
      expect(created.exitGoalId).toBeNull();
      expect(created.fallbackThresholdBp).toBe(8000);
      expect(created.completedSharePolicy).toBe("rescale");
      const auditRow = uow.state.audit.find((a) => a.entity === "allocation_stage");
      expect(auditRow?.action).toBe("stage-change");
    });

    it("rejects an exit goal from another pool, or an unknown one", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(sharedGoal("G-BEN", "Ben's goal", { personId: benId }));
      const ctx = makeCtx(uow);
      const asSystem = makeCtx(uow, null);

      // A person viewer never sees Ben's goal; the system viewer sees it in the wrong pool.
      expect(
        (capture(() => createStage(ctx, { name: "S", exitGoalId: "G-BEN" })) as AppError).code,
      ).toBe("NotFound");
      expect(
        (capture(() => createStage(asSystem, { name: "S", exitGoalId: "G-BEN" })) as AppError).code,
      ).toBe("Conflict");
      expect(
        (capture(() => createStage(ctx, { name: "S", exitGoalId: "nope" })) as AppError).code,
      ).toBe("NotFound");
      expect(uow.state.stages).toHaveLength(0);
    });

    it("updates a stage partially and audits before and after", () => {
      const uow = memoryUnitOfWork();
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 0,
        exitGoalId: null,
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      uow.state.goals.push(sharedGoal("G1", "Rainy day"));
      const ctx = makeCtx(uow);

      const updated = updateStage(ctx, { id: "S1", fallbackThresholdBp: 9000, exitGoalId: "G1" });

      expect(updated.name).toBe("Stage 1");
      expect(updated.fallbackThresholdBp).toBe(9000);
      expect(updated.exitGoalId).toBe("G1");
      const auditRow = uow.state.audit.filter((a) => a.entity === "allocation_stage").at(-1);
      expect(JSON.parse(String(auditRow?.before)).name as string).toBe("Stage 1");
      expect(JSON.parse(String(auditRow?.after)).fallbackThresholdBp as number).toBe(9000);
    });

    it("answers NotFound when updating an unknown stage", () => {
      const uow = memoryUnitOfWork();
      const ctx = makeCtx(uow);
      expect((capture(() => updateStage(ctx, { id: "nope", name: "X" })) as AppError).code).toBe(
        "NotFound",
      );
    });

    it("deletes a stage with its rules, keeping allocation history", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(sharedGoal("G1", "Kayak"));
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 0,
        exitGoalId: null,
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      uow.state.goalRules.push({
        id: "R1",
        stageId: "S1",
        goalId: "G1",
        shareBp: 5000,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
        source: "rule",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      uow.state.goalAllocations.push({
        id: "A1",
        goalId: "G1",
        periodStart: "2026-07-01",
        allocatedCents: 5000,
        createdAt: "2026-07-01T00:00:00Z",
      } as any);
      const ctx = makeCtx(uow);

      deleteStage(ctx, { id: "S1" });

      expect(uow.state.stages).toHaveLength(0);
      expect(uow.state.goalRules).toHaveLength(0);
      expect(uow.state.goalAllocations).toHaveLength(1);
    });
  });

  describe("setStageRules", () => {
    function seeded() {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(sharedGoal("G1", "Kayak"), sharedGoal("G2", "Holiday"));
      uow.state.goals.push(sharedGoal("G-BEN", "Ben's goal", { personId: benId }));
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 0,
        exitGoalId: null,
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      uow.state.goalRules.push(
        {
          id: "R-RULE",
          stageId: "S1",
          goalId: "G1",
          shareBp: 7000,
          effectiveFrom: "2026-01-01",
          effectiveUntil: null,
          source: "rule",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        } as any,
        {
          id: "R-OVERRIDE",
          stageId: "S1",
          goalId: "G2",
          shareBp: 500,
          effectiveFrom: "2026-06-01",
          effectiveUntil: null,
          source: "shortfall_override",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        } as any,
      );
      return { uow, ctx: makeCtx(uow) };
    }

    it("replaces the rule rows with today's effectiveFrom", () => {
      const { uow, ctx } = seeded();

      const rows = setStageRules(ctx, {
        stageId: "S1",
        rules: [
          { goalId: "G1", shareBp: 4000 },
          { goalId: "G2", shareBp: 1000 },
        ],
      });

      expect(rows).toHaveLength(2);
      const rules = uow.state.goalRules.filter((r) => r.source === "rule");
      expect(rules).toHaveLength(2);
      expect(rules.every((r) => r.effectiveFrom === "2026-07-15")).toBe(true);
      expect(rules.map((r) => [r.goalId, r.shareBp]).sort()).toEqual([
        ["G1", 4000],
        ["G2", 1000],
      ]);
    });

    it("leaves shortfall_override rows untouched", () => {
      const { uow, ctx } = seeded();

      setStageRules(ctx, { stageId: "S1", rules: [{ goalId: "G1", shareBp: 2000 }] });

      const overrides = uow.state.goalRules.filter((r) => r.source === "shortfall_override");
      expect(overrides).toHaveLength(1);
      expect(overrides[0]?.id).toBe("R-OVERRIDE");
    });

    it("rejects shares that sum over 100% or repeat a goal, writing nothing", () => {
      const { uow, ctx } = seeded();

      const over = capture(() =>
        setStageRules(ctx, {
          stageId: "S1",
          rules: [
            { goalId: "G1", shareBp: 6000 },
            { goalId: "G2", shareBp: 5000 },
          ],
        }),
      );
      expect((over as AppError).code).toBe("Validation");
      const dupe = capture(() =>
        setStageRules(ctx, {
          stageId: "S1",
          rules: [
            { goalId: "G1", shareBp: 1000 },
            { goalId: "G1", shareBp: 2000 },
          ],
        }),
      );
      expect((dupe as AppError).code).toBe("Validation");
      expect(uow.state.goalRules.map((r) => r.id)).toEqual(["R-RULE", "R-OVERRIDE"]);
    });

    it("answers NotFound for an unknown goal, Conflict for another pool's goal", () => {
      const { ctx, uow } = seeded();
      const asSystem = makeCtx(uow, null);

      expect(
        (
          capture(() =>
            setStageRules(ctx, { stageId: "S1", rules: [{ goalId: "nope", shareBp: 100 }] }),
          ) as AppError
        ).code,
      ).toBe("NotFound");
      expect(
        (
          capture(() =>
            setStageRules(ctx, { stageId: "S1", rules: [{ goalId: "G-BEN", shareBp: 100 }] }),
          ) as AppError
        ).code,
      ).toBe("NotFound");
      expect(
        (
          capture(() =>
            setStageRules(asSystem, { stageId: "S1", rules: [{ goalId: "G-BEN", shareBp: 100 }] }),
          ) as AppError
        ).code,
      ).toBe("Conflict");
    });

    it("feeds executeSavingsAllocation unchanged", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(
        sharedGoal("EF", "Emergency Fund", { targetCents: 100_000, isEmergencyFund: true }),
        sharedGoal("HOLIDAY", "Holiday", { targetCents: 200_000 }),
      );
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 1,
        exitGoalId: "EF",
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      const ctx = makeCtx(uow);

      setStageRules(ctx, {
        stageId: "S1",
        rules: [
          { goalId: "EF", shareBp: 6000 },
          { goalId: "HOLIDAY", shareBp: 4000 },
        ],
      });
      const result = executeSavingsAllocation(ctx, {
        periodStart: "2026-07-01",
        savingsCents: 50_000,
        pool: "shared",
      });

      expect(
        result.allocations
          .map((a) => [a.goalId, a.allocatedCents])
          .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
      ).toEqual([
        ["EF", 30_000],
        ["HOLIDAY", 20_000],
      ]);
    });
  });

  describe("buffer divert override (D8)", () => {
    function seeded() {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(
        sharedGoal("G1", "House", { targetCents: 500_000 }),
        sharedGoal("G2", "Holiday", { targetCents: 300_000 }),
      );
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 1,
        exitGoalId: "G1",
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      uow.state.goalRules.push({
        id: "R-RULE",
        stageId: "S1",
        goalId: "G1",
        shareBp: 9000,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
        source: "rule",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      return { uow, ctx: makeCtx(uow) };
    }

    it("applies a shortfall_override rule on the active stage and clears it on undo", () => {
      const { uow, ctx } = seeded();

      const result = applyBufferDivert(ctx, {
        pool: "shared",
        shareBp: 0,
        effectiveUntil: "2027-01-15",
      });

      expect(result.rule.source).toBe("shortfall_override");
      expect(result.rule.effectiveUntil).toBe("2027-01-15");
      expect(result.activeStageId).toBe("S1");

      const inDb = uow.state.goalRules.find((r) => r.source === "shortfall_override");
      expect(inDb).toBeDefined();
      expect(inDb?.id).toBe(result.rule.id);

      // Re-applying updates existing override
      const updated = applyBufferDivert(ctx, {
        pool: "shared",
        shareBp: 500,
        effectiveUntil: "2027-02-15",
      });
      expect(updated.rule.id).toBe(result.rule.id);
      expect(updated.rule.shareBp).toBe(500);
      expect(updated.rule.effectiveUntil).toBe("2027-02-15");

      // Clear / undo
      const cleared = clearBufferDivert(ctx, { pool: "shared" });
      expect(cleared.cleared).toBe(true);

      const remaining = uow.state.goalRules.filter((r) => r.source === "shortfall_override");
      expect(remaining).toHaveLength(0);
      // Standard rule remains intact
      expect(uow.state.goalRules.filter((r) => r.source === "rule")).toHaveLength(1);
    });

    it("projects shortfall clearance date from shortfallCents when effectiveUntil is omitted", () => {
      const { ctx } = seeded();

      // Today is 2026-07-15. Shortfall of $320 (32_000 cents).
      // $320 / $50 per fortnight = ceil(6.4) = 7 fortnights = 98 days.
      // 2026-07-15 + 98 days = 2026-10-21.
      const result = applyBufferDivert(ctx, {
        pool: "shared",
        shortfallCents: 32_000,
      });

      expect(result.rule.source).toBe("shortfall_override");
      expect(result.effectiveUntil).toBe("2026-10-21");
    });
  });

  describe("summary projections", () => {
    it("projects each goal and names the next stage change", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(
        sharedGoal("EF", "Emergency Fund", { targetCents: 100_000, isEmergencyFund: true }),
        sharedGoal("NEWBIKE", "New bike"),
      );
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 0,
        exitGoalId: "EF",
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      uow.state.goalAllocations.push(
        {
          id: "A1",
          goalId: "EF",
          periodStart: "2026-05-01",
          allocatedCents: 25_000,
          createdAt: "2026-05-01T00:00:00Z",
        } as any,
        {
          id: "A2",
          goalId: "EF",
          periodStart: "2026-06-01",
          allocatedCents: 25_000,
          createdAt: "2026-06-01T00:00:00Z",
        } as any,
        {
          id: "A3",
          goalId: "EF",
          periodStart: "2026-07-01",
          allocatedCents: 0,
          createdAt: "2026-07-01T00:00:00Z",
        } as any,
      );
      const ctx = makeCtx(uow);

      const summary = getGoalsSummary(ctx);
      const ef = summary.goals.find((g) => g.id === "EF");
      const bike = summary.goals.find((g) => g.id === "NEWBIKE");

      expect(ef?.currentBalance).toBe(50_000);
      expect(ef?.projection).toMatchObject({
        averagePerPeriodCents: 25_000,
        pace: "monthly",
        // Zero-net July is dropped, so the latest funded period is June.
        periodsRemaining: 2,
      });
      expect(ef?.projection?.projectedCompletion).toBe("2026-08-01");
      expect(bike?.projection).toBeNull();
      expect(summary.nextStageChangeDate).toBe("2026-08-01");
    });

    it("honours a future asOf in summary projections", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(
        sharedGoal("EF", "Emergency Fund", { targetCents: 100_000, isEmergencyFund: true }),
      );
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 0,
        exitGoalId: "EF",
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      uow.state.goalAllocations.push(
        {
          id: "A1",
          goalId: "EF",
          periodStart: "2026-05-01",
          allocatedCents: 25_000,
          createdAt: "2026-05-01T00:00:00Z",
        } as any,
        {
          id: "A2",
          goalId: "EF",
          periodStart: "2026-06-01",
          allocatedCents: 25_000,
          createdAt: "2026-06-01T00:00:00Z",
        } as any,
        // In the future relative to the clock's today, but in scope for the asOf.
        {
          id: "A3",
          goalId: "EF",
          periodStart: "2026-08-01",
          allocatedCents: 25_000,
          createdAt: "2026-08-01T00:00:00Z",
        } as any,
      );
      const ctx = makeCtx(uow);

      const summary = getGoalsSummary(ctx, { asOf: "2026-08-15" });
      const ef = summary.goals.find((g) => g.id === "EF");

      // The August period is in scope for the requested asOf, moving the projection
      // (default asOf would stop at the June period and project 2026-07-01).
      expect(ef?.projection?.projectedCompletion).toBe("2026-09-01");
      expect(summary.nextStageChangeDate).toBe("2026-09-01");
    });

    it("has no next stage change when the exit goal has no projection", () => {
      const uow = memoryUnitOfWork();
      uow.state.goals.push(sharedGoal("EF", "Emergency Fund", { isEmergencyFund: true }));
      uow.state.stages.push({
        id: "S1",
        personId: null,
        name: "Stage 1",
        sort: 0,
        exitGoalId: "EF",
        fallbackThresholdBp: 8000,
        completedSharePolicy: "rescale",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as any);
      const ctx = makeCtx(uow);

      expect(getGoalsSummary(ctx).nextStageChangeDate).toBeNull();
    });
  });
});

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw");
}
