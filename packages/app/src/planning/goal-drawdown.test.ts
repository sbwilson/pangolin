import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import type { GoalRow } from "../ports/unit-of-work.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { type UseCaseContext, write } from "../write.ts";
import {
  executeDrawdown,
  listDrawdowns,
  proposeDrawdown,
  proposeDrawdownSplit,
  undoDrawdown,
} from "./goal-drawdown.ts";
import { listGoals } from "./goals.ts";

function fakeClock(iso: string) {
  return {
    now: () => new Date(iso),
    today: () => iso.slice(0, 10),
  };
}

function testContext(viewerPersonId: string | null = "person-1"): UseCaseContext {
  const uow = memoryUnitOfWork();
  let idCounter = 1;
  return {
    viewer:
      viewerPersonId === null
        ? { kind: "system", role: "system" }
        : { kind: "person", personId: viewerPersonId as Id<"Person">, role: "owner" },
    uow,
    clock: fakeClock("2026-11-08T10:00:00.000Z"),
    newId: <T extends string>() => `test-id-${idCounter++}` as Id<T>,
  };
}

describe("proposeDrawdownSplit (pure logic)", () => {
  const ef: GoalRow = {
    id: "g-ef" as Id<"Goal">,
    personId: null,
    name: "Emergency Fund",
    targetCents: 500_000,
    targetDate: null,
    priority: 0,
    kind: "flexible",
    isEmergencyFund: true,
    completedAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };

  const flexA: GoalRow = {
    id: "g-flex-a" as Id<"Goal">,
    personId: null,
    name: "Holiday",
    targetCents: 300_000,
    targetDate: null,
    priority: 1,
    kind: "flexible",
    isEmergencyFund: false,
    completedAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };

  const flexB: GoalRow = {
    id: "g-flex-b" as Id<"Goal">,
    personId: null,
    name: "New Car",
    targetCents: 400_000,
    targetDate: null,
    priority: 2,
    kind: "flexible",
    isEmergencyFund: false,
    completedAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };

  const protectedGoal: GoalRow = {
    id: "g-prot" as Id<"Goal">,
    personId: null,
    name: "House Deposit",
    targetCents: 1_000_000,
    targetDate: null,
    priority: 3,
    kind: "protected",
    isEmergencyFund: false,
    completedAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };

  it("proposes large purchase drawdown: Emergency Fund covers all", () => {
    const balances = new Map<Id<"Goal">, number>([
      [ef.id, 500_000],
      [flexA.id, 300_000],
      [protectedGoal.id, 1_000_000],
    ]);

    const res = proposeDrawdownSplit({
      reason: "large_purchase",
      amountCents: 100_000,
      goals: [ef, flexA, protectedGoal],
      balances,
    });

    expect(res.coveredCents).toBe(100_000);
    expect(res.remainingCents).toBe(0);
    expect(res.unlockedProtected).toBe(false);
    expect(res.warnings).toEqual([]);

    const efProp = res.proposals.find((p) => p.goalId === ef.id);
    const flexProp = res.proposals.find((p) => p.goalId === flexA.id);
    const protProp = res.proposals.find((p) => p.goalId === protectedGoal.id);

    expect(efProp?.proposedAmountCents).toBe(100_000);
    expect(flexProp?.proposedAmountCents).toBe(0);
    expect(protProp?.proposedAmountCents).toBe(0);
  });

  it("proposes large purchase drawdown: EF partial, Flexible covers rest proportionally", () => {
    const balances = new Map<Id<"Goal">, number>([
      [ef.id, 100_000],
      [flexA.id, 200_000],
      [flexB.id, 200_000],
      [protectedGoal.id, 500_000],
    ]);

    const res = proposeDrawdownSplit({
      reason: "large_purchase",
      amountCents: 300_000, // needs 100k from EF and 200k from Flexible
      goals: [ef, flexA, flexB, protectedGoal],
      balances,
    });

    expect(res.coveredCents).toBe(300_000);
    expect(res.remainingCents).toBe(0);
    expect(res.unlockedProtected).toBe(false);

    expect(res.proposals.find((p) => p.goalId === ef.id)?.proposedAmountCents).toBe(100_000);
    expect(res.proposals.find((p) => p.goalId === flexA.id)?.proposedAmountCents).toBe(100_000);
    expect(res.proposals.find((p) => p.goalId === flexB.id)?.proposedAmountCents).toBe(100_000);
    expect(res.proposals.find((p) => p.goalId === protectedGoal.id)?.proposedAmountCents).toBe(0);
  });

  it("proposes shortfall drawdown: Flexible covers all in proportion to balance", () => {
    const balances = new Map<Id<"Goal">, number>([
      [ef.id, 500_000],
      [flexA.id, 100_000],
      [flexB.id, 200_000],
    ]);

    const res = proposeDrawdownSplit({
      reason: "shortfall",
      amountCents: 150_000,
      goals: [ef, flexA, flexB],
      balances,
    });

    expect(res.coveredCents).toBe(150_000);
    expect(res.remainingCents).toBe(0);
    expect(res.unlockedProtected).toBe(false);

    // flexA has 100k (1/3), flexB has 200k (2/3) of 300k
    expect(res.proposals.find((p) => p.goalId === flexA.id)?.proposedAmountCents).toBe(50_000);
    expect(res.proposals.find((p) => p.goalId === flexB.id)?.proposedAmountCents).toBe(100_000);
    expect(res.proposals.find((p) => p.goalId === ef.id)?.proposedAmountCents).toBe(0);
  });

  it("proposes shortfall drawdown: Flex + EF exhausted, unlocks Protected with warning", () => {
    const balances = new Map<Id<"Goal">, number>([
      [flexA.id, 100_000],
      [ef.id, 200_000],
      [protectedGoal.id, 500_000],
    ]);

    const res = proposeDrawdownSplit({
      reason: "shortfall",
      amountCents: 400_000,
      goals: [ef, flexA, protectedGoal],
      balances,
    });

    expect(res.coveredCents).toBe(400_000);
    expect(res.remainingCents).toBe(0);
    expect(res.unlockedProtected).toBe(true);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain("House Deposit");

    expect(res.proposals.find((p) => p.goalId === flexA.id)?.proposedAmountCents).toBe(100_000);
    expect(res.proposals.find((p) => p.goalId === ef.id)?.proposedAmountCents).toBe(200_000);
    expect(res.proposals.find((p) => p.goalId === protectedGoal.id)?.proposedAmountCents).toBe(
      100_000,
    );
  });

  it("handles insufficient pool balance (partial cover)", () => {
    const balances = new Map<Id<"Goal">, number>([
      [flexA.id, 100_000],
      [ef.id, 200_000],
      [protectedGoal.id, 300_000],
    ]);

    const res = proposeDrawdownSplit({
      reason: "large_purchase",
      amountCents: 1_000_000,
      goals: [ef, flexA, protectedGoal],
      balances,
    });

    expect(res.coveredCents).toBe(600_000);
    expect(res.remainingCents).toBe(400_000);
    expect(res.unlockedProtected).toBe(true);
  });

  it("rejects non-positive amount", () => {
    expect(() =>
      proposeDrawdownSplit({
        reason: "shortfall",
        amountCents: 0,
        goals: [ef],
        balances: new Map(),
      }),
    ).toThrow();
  });
});

describe("executeDrawdown & undoDrawdown use cases", () => {
  it("executes drawdown, updates goal balances and audit log, and undo restores them", () => {
    const ctx = testContext("person-1");

    // Setup person, account, goals & allocations
    write(ctx, (tx) => {
      tx.person.insert({
        id: "person-1" as Id<"Person">,
        userId: "user-1",
        displayName: "Alex",
        role: "owner",
        email: "alex@example.com",
        deletedAt: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      });

      tx.goals.insert({
        id: "g-ef" as Id<"Goal">,
        personId: null,
        name: "Emergency Fund",
        targetCents: 500_000,
        targetDate: null,
        priority: 0,
        kind: "flexible",
        isEmergencyFund: true,
        completedAt: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      });

      tx.goals.insert({
        id: "g-flex" as Id<"Goal">,
        personId: null,
        name: "Holiday",
        targetCents: 300_000,
        targetDate: null,
        priority: 1,
        kind: "flexible",
        isEmergencyFund: false,
        completedAt: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      });

      tx.goalAllocations.insertMany([
        {
          id: "alloc-1" as Id<"GoalAllocation">,
          goalId: "g-ef" as Id<"Goal">,
          periodStart: "2026-01-01",
          allocatedCents: 200_000,
          createdAt: "2026-01-01",
        },
        {
          id: "alloc-2" as Id<"GoalAllocation">,
          goalId: "g-flex" as Id<"Goal">,
          periodStart: "2026-01-01",
          allocatedCents: 150_000,
          createdAt: "2026-01-01",
        },
      ]);
    });

    // 1. Check initial balances
    const initialGoals = listGoals(ctx);
    expect(initialGoals.find((g) => g.id === "g-ef")?.currentBalance).toBe(200_000);
    expect(initialGoals.find((g) => g.id === "g-flex")?.currentBalance).toBe(150_000);

    // 2. Propose drawdown
    const proposal = proposeDrawdown(ctx, {
      pool: "shared",
      reason: "large_purchase",
      amountCents: 250_000,
    });
    expect(proposal.coveredCents).toBe(250_000);
    expect(proposal.proposals.find((p) => p.goalId === "g-ef")?.proposedAmountCents).toBe(200_000);
    expect(proposal.proposals.find((p) => p.goalId === "g-flex")?.proposedAmountCents).toBe(50_000);

    // 3. Execute drawdown
    const executed = executeDrawdown(ctx, {
      pool: "shared",
      reason: "large_purchase",
      label: "Big Couch",
      amountCents: 250_000,
      adjustments: [
        { goalId: "g-ef", amountCents: 200_000 },
        { goalId: "g-flex", amountCents: 50_000 },
      ],
    });

    expect(executed.drawdown.id).toBeDefined();
    expect(executed.adjustments).toHaveLength(2);

    // 4. Balances immediately reflect drawdown
    const postGoals = listGoals(ctx);
    expect(postGoals.find((g) => g.id === "g-ef")?.currentBalance).toBe(0);
    expect(postGoals.find((g) => g.id === "g-flex")?.currentBalance).toBe(100_000);

    // Verify audit rows
    const auditRows = ctx.uow.read((r) => r.audit.listVisible(ctx.viewer, "2026-11-08"));
    const drawdownAudit = auditRows.find((a) => a.action === "drawdown");
    expect(drawdownAudit).toBeDefined();
    expect(drawdownAudit?.entity).toBe("goal_drawdown");

    // 5. List drawdowns
    const drawdowns = listDrawdowns(ctx, { pool: "shared" });
    expect(drawdowns).toHaveLength(1);
    expect(drawdowns[0]?.id).toBe(executed.drawdown.id);
    expect(drawdowns[0]?.adjustments).toHaveLength(2);

    // 6. Undo drawdown
    const undone = undoDrawdown(ctx, { drawdownId: executed.drawdown.id });
    expect(undone.drawdown.undoneAt).not.toBeNull();

    // 7. Balances restored and listDrawdowns still includes undone drawdown in history
    const restoredGoals = listGoals(ctx);
    expect(restoredGoals.find((g) => g.id === "g-ef")?.currentBalance).toBe(200_000);
    expect(restoredGoals.find((g) => g.id === "g-flex")?.currentBalance).toBe(150_000);

    const historyDrawdowns = listDrawdowns(ctx, { pool: "shared" });
    expect(historyDrawdowns).toHaveLength(1);
    expect(historyDrawdowns[0]?.undoneAt).not.toBeNull();

    // Audit for undo
    const undoAuditRows = ctx.uow.read((r) => r.audit.listVisible(ctx.viewer, "2026-11-08"));
    const undoAudit = undoAuditRows.find((a) => a.action === "drawdown-undo");
    expect(undoAudit).toBeDefined();

    // 8. Attempting to undo again fails
    expect(() => undoDrawdown(ctx, { drawdownId: executed.drawdown.id })).toThrow(/already undone/);
  });

  it("prevents cross-pool drawdown access", () => {
    const ctx = testContext("person-1");
    // Partner's personal goal
    write(ctx, (tx) => {
      tx.goals.insert({
        id: "g-partner" as Id<"Goal">,
        personId: "person-2" as Id<"Person">,
        name: "Partner Secret Goal",
        targetCents: 100_000,
        targetDate: null,
        priority: 0,
        kind: "flexible",
        isEmergencyFund: false,
        completedAt: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      });
    });

    expect(() =>
      proposeDrawdown(ctx, {
        pool: "person-2",
        reason: "shortfall",
        amountCents: 10_000,
      }),
    ).toThrow("Pool not found");

    expect(() =>
      executeDrawdown(ctx, {
        pool: "person-2",
        reason: "shortfall",
        label: "Should Fail",
        amountCents: 10_000,
        adjustments: [{ goalId: "g-partner", amountCents: 10_000 }],
      }),
    ).toThrow("Pool not found");
  });
});
