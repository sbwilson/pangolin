// The savings reconciliation engine: per-pool period new savings from the balance snapshots
// (interest excluded), the invariant `goals + buffer = pool savings`, and the reuse of
// `executeSavingsAllocation` for positive months (Option A: deficits write nothing).
import type { Id } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock.ts";
import { AppError } from "../errors.ts";
import type {
  AccountOwnerRow,
  AccountRow,
  AllocationStageRow,
  BalanceSnapshotRow,
  CategoryGroupRow,
  CategoryRow,
  GoalAllocationRow,
  GoalRow,
  GoalRuleRow,
  PersonRow,
  SplitRow,
  TransactionRow,
} from "../ports/unit-of-work.ts";
import { type MemoryUnitOfWork, memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import type { UseCaseContext } from "../write.ts";
import {
  derivePoolNewSavingsCents,
  getSavingsReconciliation,
  reconcilePool,
  runSavingsReconciliation,
} from "./savings-reconciliation.ts";

const clock = fixedClock(parseDate("2026-07-15"));
const NOW = "2026-07-15T00:00:00.000Z";
const PERIOD = { periodStart: "2026-07-01", periodEnd: "2026-07-15" };

let idCounter = 0;
function nextId<B extends string>(): Id<B> {
  return `01J00000000000000000R${String(++idCounter).padStart(5, "0")}` as Id<B>;
}

function ctx(uow: MemoryUnitOfWork, viewer: Viewer): UseCaseContext {
  return { viewer, clock, newId: nextId, uow };
}

function personRow(id: Id<"Person">, name: string): PersonRow {
  return {
    id,
    userId: `user-${name}`,
    displayName: name,
    colour: "#111111",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function accountRow(
  id: Id<"Account">,
  { isPrivate = false, closedOn = null }: { isPrivate?: boolean; closedOn?: string | null } = {},
): AccountRow {
  return {
    id,
    name: `acct ${id}`,
    type: "savings",
    currency: "AUD",
    isPrivate,
    institutionId: null,
    openedOn: null,
    closedOn,
    isSavings: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function ownerRow(
  accountId: Id<"Account">,
  personId: Id<"Person">,
  shareBp = 10000,
): AccountOwnerRow {
  return { accountId, personId, shareBp, createdAt: NOW, updatedAt: NOW };
}

function snapshotRow(
  accountId: Id<"Account">,
  asOf: string,
  balanceCents: number,
): BalanceSnapshotRow {
  return {
    id: nextId<"BalanceSnapshot">(),
    accountId,
    asOf,
    balanceCents,
    source: "manual",
    importBatchId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** A line on an account moving its balance between the two snapshot boundaries. */
function txnRow(
  accountId: Id<"Account">,
  postedOn: string,
  amountCents: number,
  description = "line",
): TransactionRow {
  return {
    id: nextId<"Transaction">(),
    accountId,
    postedOn,
    amountCents,
    descriptionRaw: description,
    payeeId: null,
    status: "posted",
    externalId: null,
    fingerprint: `fp-${idCounter}`,
    fingerprintVersion: 1,
    importId: null,
    performedBy: null,
    transferGroupId: null,
    needsReview: false,
    isHidden: false,
    nameHiddenBy: null,
    nameHiddenUntil: null,
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** A split of `txn` on `categoryId`: what `sumSplitCents` reads. */
function splitRow(txn: TransactionRow, categoryId: Id<"Category">, amountCents: number): SplitRow {
  return {
    id: nextId<"Split">(),
    transactionId: txn.id,
    amountCents,
    categoryId,
    activityId: null,
    beneficiary: "shared",
    propertyId: null,
    taxCategoryId: null,
    deductibleBp: null,
    memo: null,
    categorySource: "rule",
    activitySource: null,
    taxCategorySource: null,
    beneficiarySource: null,
    deductibleBpSource: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** An income-kind group holding a category called `name`; returns the category id. */
function withCategory(uow: MemoryUnitOfWork, name: string): Id<"Category"> {
  const groupId = nextId<"CategoryGroup">();
  const group: CategoryGroupRow = {
    id: groupId,
    name: "Income",
    kind: "income",
    sort: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const categoryId = nextId<"Category">();
  const category: CategoryRow = {
    id: categoryId,
    groupId,
    name,
    isFixedCost: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
  uow.state.categoryGroups.push(group);
  uow.state.categories.push(category);
  return categoryId;
}

function goalRow(
  id: Id<"Goal">,
  personId: Id<"Person"> | null,
  name: string,
  targetCents: number,
  priority = 1,
): GoalRow {
  return {
    id,
    personId,
    name,
    targetCents,
    targetDate: null,
    priority,
    kind: "flexible",
    isEmergencyFund: false,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function stageRow(id: Id<"AllocationStage">, personId: Id<"Person"> | null): AllocationStageRow {
  return {
    id,
    personId,
    name: `stage ${id}`,
    sort: 1,
    exitGoalId: null,
    fallbackThresholdBp: 8000,
    completedSharePolicy: "rescale",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function ruleRow(
  id: Id<"GoalRule">,
  stageId: Id<"AllocationStage">,
  goalId: Id<"Goal">,
  shareBp: number,
): GoalRuleRow {
  return {
    id,
    stageId,
    goalId,
    shareBp,
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    source: "rule",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function allocationRow(
  goalId: Id<"Goal">,
  periodStart: string,
  allocatedCents: number,
): GoalAllocationRow {
  return {
    id: nextId<"GoalAllocation">(),
    goalId,
    periodStart,
    allocatedCents,
    createdAt: NOW,
  };
}

function catchAppError(fn: () => unknown): AppError | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof AppError ? e : undefined;
  }
}

describe("planning/savings-reconciliation", () => {
  /** Two people and a joint savings account (`shared` pool, AD-26: two owners). */
  function fixture(): {
    uow: MemoryUnitOfWork;
    a: Id<"Person">;
    b: Id<"Person">;
    shared: Id<"Account">;
    ctxA: UseCaseContext;
    ctxB: UseCaseContext;
  } {
    const uow = memoryUnitOfWork();
    const a = nextId<"Person">();
    const b = nextId<"Person">();
    const shared = nextId<"Account">();
    uow.state.people.push(personRow(a, "Alex"), personRow(b, "Bea"));
    uow.state.accounts.push(accountRow(shared));
    uow.state.accountOwners.push(ownerRow(shared, a, 5000), ownerRow(shared, b, 5000));
    return {
      uow,
      a,
      b,
      shared,
      ctxA: ctx(uow, personViewer(a, clock.now())),
      ctxB: ctx(uow, personViewer(b, clock.now())),
    };
  }

  it("derives pool new savings: end minus start minus interest", () => {
    expect(
      derivePoolNewSavingsCents({
        startTotalCents: 100_00,
        endTotalCents: 200_00,
        interestCents: 20_00,
      }),
    ).toBe(80_00);
    expect(
      derivePoolNewSavingsCents({
        startTotalCents: 100_00,
        endTotalCents: 90_00,
        interestCents: 0,
      }),
    ).toBe(-10_00);
    // The AD-24 extension point: goal money that left the pool is added back.
    expect(
      derivePoolNewSavingsCents({
        startTotalCents: 100_00,
        endTotalCents: 210_00,
        interestCents: 20_00,
        excludedGoalWithdrawalCents: 10_00,
      }),
    ).toBe(100_00);
  });

  it("reconciles the invariant: goals + buffer = pool savings", () => {
    expect(reconcilePool("shared", 100_00, 60_00)).toEqual({
      pool: "shared",
      actualSavingsCents: 100_00,
      goalTotalCents: 60_00,
      bufferCents: 40_00,
      shortfallCents: 0,
      status: "ok",
    });
    expect(reconcilePool("shared", 50_00, 120_00)).toEqual({
      pool: "shared",
      actualSavingsCents: 50_00,
      goalTotalCents: 120_00,
      bufferCents: 0,
      shortfallCents: 70_00,
      status: "over-committed",
    });
    expect(reconcilePool("p1", 60_00, 60_00).status).toBe("ok");
  });

  it("allocates a positive period: the derived new savings land in the goals, the rest is buffer", () => {
    const { uow, ctxA, shared } = fixture();
    uow.state.balanceSnapshots.push(snapshotRow(shared, "2026-06-30", 100_000));
    uow.state.transactions.push(txnRow(shared, "2026-07-05", 100_000, "payday"));
    const ef = nextId<"Goal">();
    const home = nextId<"Goal">();
    uow.state.goals.push(
      goalRow(ef, null, "Emergency fund", 200_000),
      goalRow(home, null, "House deposit", 500_000, 2),
    );
    const stage = nextId<"AllocationStage">();
    uow.state.stages.push(stageRow(stage, null));
    uow.state.goalRules.push(
      ruleRow(nextId<"GoalRule">(), stage, ef, 8000),
      ruleRow(nextId<"GoalRule">(), stage, home, 2000),
    );

    const [row] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    expect(row?.newSavingsCents).toBe(100_000);
    expect(row?.allocatedCents).toBe(100_000);
    expect(row?.alreadyAllocated).toBe(false);
    expect(row?.actualSavingsCents).toBe(200_000);
    expect(row?.goalTotalCents).toBe(100_000);
    expect(row?.bufferCents).toBe(100_000);
    expect(row?.shortfallCents).toBe(0);
    expect(row?.status).toBe("ok");

    // The allocation is exactly the existing engine's: two rows at the stage's 80/20 shares.
    const stored = uow.state.goalAllocations.slice().sort((x, y) => (x.goalId < y.goalId ? -1 : 1));
    expect(stored.map((a) => [a.goalId, a.periodStart, a.allocatedCents])).toEqual([
      [ef, "2026-07-01", 80_000],
      [home, "2026-07-01", 20_000],
    ]);
  });

  it("a deficit writes nothing: goals and allocation rows untouched", () => {
    const { uow, ctxA, shared } = fixture();
    uow.state.balanceSnapshots.push(snapshotRow(shared, "2026-06-30", 200_000));
    uow.state.transactions.push(txnRow(shared, "2026-07-05", -50_000, "car repair"));
    const ef = nextId<"Goal">();
    uow.state.goals.push(goalRow(ef, null, "Emergency fund", 300_000));
    // A prior period put 100_000 into the goal: the goal balance is 100_000.
    uow.state.goalAllocations.push(allocationRow(ef, "2026-06-01", 100_000));
    const stage = nextId<"AllocationStage">();
    uow.state.stages.push(stageRow(stage, null));
    uow.state.goalRules.push(ruleRow(nextId<"GoalRule">(), stage, ef, 10000));

    const goalsBefore = JSON.stringify(uow.state.goals);
    const allocsBefore = JSON.stringify(uow.state.goalAllocations);

    const [row] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    expect(row?.newSavingsCents).toBe(-50_000);
    expect(row?.allocatedCents).toBe(0);
    expect(row?.alreadyAllocated).toBe(false);
    expect(row?.actualSavingsCents).toBe(150_000);
    expect(row?.goalTotalCents).toBe(100_000);
    expect(row?.bufferCents).toBe(50_000);
    expect(row?.shortfallCents).toBe(0);
    expect(row?.status).toBe("ok");

    expect(JSON.stringify(uow.state.goalAllocations)).toBe(allocsBefore);
    expect(JSON.stringify(uow.state.goals)).toBe(goalsBefore);
    expect(uow.state.audit).toHaveLength(0);
  });

  it("a deficit that exhausts the buffer is over-committed", () => {
    const { uow, ctxA, shared } = fixture();
    uow.state.balanceSnapshots.push(snapshotRow(shared, "2026-06-30", 100_000));
    uow.state.transactions.push(txnRow(shared, "2026-07-05", -50_000, "car repair"));
    const ef = nextId<"Goal">();
    uow.state.goals.push(goalRow(ef, null, "Emergency fund", 200_000));
    // The goal already holds 200_000 while the pool fell to 50_000: over-committed by 150_000.
    uow.state.goalAllocations.push(allocationRow(ef, "2026-06-01", 200_000));

    const [row] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    expect(row?.newSavingsCents).toBe(-50_000);
    expect(row?.allocatedCents).toBe(0);
    expect(row?.actualSavingsCents).toBe(50_000);
    expect(row?.goalTotalCents).toBe(200_000);
    expect(row?.bufferCents).toBe(0);
    expect(row?.shortfallCents).toBe(150_000);
    expect(row?.status).toBe("over-committed");
    // The read-only report flags the same pool over-committed too (AC2).
    const reported = getSavingsReconciliation(ctxA).find((r) => r.pool === "shared");
    expect(reported?.status).toBe("over-committed");
    expect(reported?.bufferCents).toBe(0);
    expect(reported?.shortfallCents).toBe(150_000);
    expect(uow.state.goalAllocations).toHaveLength(1);
  });

  it("re-running the same period does not double-allocate", () => {
    const { uow, ctxA, shared } = fixture();
    uow.state.balanceSnapshots.push(snapshotRow(shared, "2026-06-30", 100_000));
    uow.state.transactions.push(txnRow(shared, "2026-07-05", 100_000, "payday"));
    const ef = nextId<"Goal">();
    uow.state.goals.push(goalRow(ef, null, "Emergency fund", 500_000));
    const stage = nextId<"AllocationStage">();
    uow.state.stages.push(stageRow(stage, null));
    uow.state.goalRules.push(ruleRow(nextId<"GoalRule">(), stage, ef, 10000));

    const [first] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    expect(first?.alreadyAllocated).toBe(false);
    expect(first?.allocatedCents).toBe(100_000);

    const [second] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    expect(second?.alreadyAllocated).toBe(true);
    expect(second?.allocatedCents).toBe(0);
    expect(second?.newSavingsCents).toBe(100_000);
    expect(uow.state.goalAllocations).toHaveLength(1);

    // The report still balances after the skipped run.
    expect(second?.actualSavingsCents).toBe(200_000);
    expect(second?.goalTotalCents).toBe(100_000);
    expect(second?.bufferCents).toBe(100_000);
    expect(second?.status).toBe("ok");
  });

  it("interest income is not new savings", () => {
    const { uow, ctxA, shared } = fixture();
    const interest = withCategory(uow, "Interest");
    uow.state.balanceSnapshots.push(snapshotRow(shared, "2026-06-30", 100_000));
    const credit = txnRow(shared, "2026-07-10", 10_000, "interest credit");
    uow.state.transactions.push(credit);
    uow.state.splits.push(splitRow(credit, interest, 10_000));

    const [row] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    expect(row?.newSavingsCents).toBe(0);
    expect(row?.allocatedCents).toBe(0);
    expect(row?.alreadyAllocated).toBe(false);
    expect(row?.actualSavingsCents).toBe(110_000);
    expect(row?.goalTotalCents).toBe(0);
    expect(row?.bufferCents).toBe(110_000);
    expect(row?.shortfallCents).toBe(0);
    expect(row?.status).toBe("ok");
    expect(uow.state.goalAllocations).toHaveLength(0);
  });

  it("a split on another income category is not excluded: the month allocates", () => {
    const { uow, ctxA, shared } = fixture();
    const other = withCategory(uow, "Gifts");
    uow.state.balanceSnapshots.push(snapshotRow(shared, "2026-06-30", 100_000));
    const credit = txnRow(shared, "2026-07-10", 10_000, "gift in");
    uow.state.transactions.push(credit);
    uow.state.splits.push(splitRow(credit, other, 10_000));
    const ef = nextId<"Goal">();
    uow.state.goals.push(goalRow(ef, null, "Emergency fund", 500_000));
    const stage = nextId<"AllocationStage">();
    uow.state.stages.push(stageRow(stage, null));
    uow.state.goalRules.push(ruleRow(nextId<"GoalRule">(), stage, ef, 10000));

    const [row] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    expect(row?.newSavingsCents).toBe(10_000);
    expect(row?.allocatedCents).toBe(10_000);
    expect(uow.state.goalAllocations).toHaveLength(1);
  });

  it("without an Interest category nothing is excluded", () => {
    const { uow, ctxA, shared } = fixture();
    uow.state.balanceSnapshots.push(snapshotRow(shared, "2026-06-30", 100_000));
    uow.state.transactions.push(txnRow(shared, "2026-07-10", 10_000, "credit"));

    const [row] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    expect(row?.newSavingsCents).toBe(10_000);
    expect(row?.allocatedCents).toBe(0); // no goals: there is nothing to allocate to
    expect(uow.state.goalAllocations).toHaveLength(0);
  });

  it("a transfer between two accounts of the same pool is not new savings", () => {
    const { uow, ctxA, shared, a, b } = fixture();
    const extra = nextId<"Account">();
    uow.state.accounts.push(accountRow(extra));
    uow.state.accountOwners.push(ownerRow(extra, a, 5000));
    uow.state.accountOwners.push(ownerRow(extra, b, 5000));
    uow.state.balanceSnapshots.push(
      snapshotRow(shared, "2026-06-30", 100_000),
      snapshotRow(extra, "2026-06-30", 0),
    );
    uow.state.transactions.push(
      txnRow(shared, "2026-07-05", -20_000, "move out"),
      txnRow(extra, "2026-07-05", 20_000, "move in"),
    );

    const [row] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    expect(row?.newSavingsCents).toBe(0);
    expect(row?.allocatedCents).toBe(0);
    expect(row?.actualSavingsCents).toBe(100_000);
  });

  it("personal pool: the owner allocates, the partner sees only shared and own", () => {
    const { uow, a, b, ctxA, ctxB, shared } = fixture();
    const aOnly = nextId<"Account">();
    const bOnly = nextId<"Account">();
    uow.state.accounts.push(
      accountRow(aOnly, { isPrivate: true }),
      accountRow(bOnly, { isPrivate: true }),
    );
    uow.state.accountOwners.push(ownerRow(aOnly, a), ownerRow(bOnly, b));
    uow.state.balanceSnapshots.push(
      snapshotRow(shared, "2026-06-30", 100_000),
      snapshotRow(aOnly, "2026-06-30", 50_000),
      snapshotRow(bOnly, "2026-06-30", 70_000),
    );
    uow.state.transactions.push(
      txnRow(shared, "2026-07-05", 40_000, "payday"),
      txnRow(aOnly, "2026-07-06", 30_000, "side gig"),
      txnRow(bOnly, "2026-07-06", 10_000, "gift"),
    );
    const motor = nextId<"Goal">();
    uow.state.goals.push(goalRow(motor, a, "A motorbike", 50_000));
    const stage = nextId<"AllocationStage">();
    uow.state.stages.push(stageRow(stage, a));
    uow.state.goalRules.push(ruleRow(nextId<"GoalRule">(), stage, motor, 10000));

    // A's personal pool: its own accounts only.
    const [personal] = runSavingsReconciliation(ctxA, { pool: a, ...PERIOD });
    expect(personal?.newSavingsCents).toBe(30_000);
    expect(personal?.allocatedCents).toBe(30_000);
    expect(personal?.actualSavingsCents).toBe(80_000);
    expect(personal?.goalTotalCents).toBe(30_000);
    expect(personal?.bufferCents).toBe(50_000);
    expect(personal?.status).toBe("ok");

    // B cannot run A's pool.
    expect(catchAppError(() => runSavingsReconciliation(ctxB, { pool: a, ...PERIOD }))?.code).toBe(
      "NotFound",
    );

    // B's report holds the shared pool and B's own pool; A's pool is absent.
    const asB = getSavingsReconciliation(ctxB, { asOf: PERIOD.periodEnd });
    expect(asB.map((r) => r.pool).sort()).toEqual(["shared", b].sort());
    expect(asB.find((r) => r.pool === a)).toBeUndefined();
    const sharedRow = asB.find((r) => r.pool === "shared");
    expect(sharedRow?.actualSavingsCents).toBe(140_000);
    expect(sharedRow?.goalTotalCents).toBe(0);
    expect(sharedRow?.status).toBe("ok");

    // A sees shared and own.
    const asA = getSavingsReconciliation(ctxA, { asOf: PERIOD.periodEnd });
    expect(asA.map((r) => r.pool).sort()).toEqual(["shared", a].sort());
    const own = asA.find((r) => r.pool === a);
    expect(own?.goalTotalCents).toBe(30_000);
    expect(own?.bufferCents).toBe(50_000);
  });

  it("a savings account closed mid-period counts as a deficit", () => {
    const { uow, ctxA, a, b } = fixture();
    const interest = withCategory(uow, "Interest");
    const kept = nextId<"Account">();
    const closing = nextId<"Account">();
    uow.state.accounts.push(accountRow(kept), accountRow(closing, { closedOn: "2026-07-10" }));
    uow.state.accountOwners.push(
      ownerRow(kept, a, 5000),
      ownerRow(kept, b, 5000),
      ownerRow(closing, a, 5000),
      ownerRow(closing, b, 5000),
    );
    uow.state.balanceSnapshots.push(
      snapshotRow(kept, "2026-06-30", 100_000),
      snapshotRow(closing, "2026-06-30", 50_000),
    );
    // The closing account earns interest mid-period, then leaves the pool at close.
    const earned = txnRow(closing, "2026-07-08", 10_000, "interest");
    uow.state.transactions.push(earned);
    uow.state.splits.push(splitRow(earned, interest, 10_000));

    const [row] = runSavingsReconciliation(ctxA, { pool: "shared", ...PERIOD });
    // start 150_000; end 100_000 (the closed account holds nothing and is not listed);
    // interest 10_000 on the union still weighs: new savings 100_000 - 150_000 - 10_000.
    expect(row?.newSavingsCents).toBe(-60_000);
    expect(row?.allocatedCents).toBe(0);
    expect(row?.actualSavingsCents).toBe(100_000);
    expect(row?.goalTotalCents).toBe(0);
    expect(row?.bufferCents).toBe(100_000);
    expect(row?.status).toBe("ok");
    expect(uow.state.goalAllocations).toHaveLength(0);
  });

  it("invalid dates are Validation errors; unknown pools are NotFound", () => {
    const { ctxA, ctxB, b } = fixture();
    expect(() => getSavingsReconciliation(ctxA)).not.toThrow();
    const cases: { pool: string; periodStart: string; periodEnd: string }[] = [
      { pool: "shared", periodStart: "2026-07-15", periodEnd: "2026-07-15" },
      { pool: "shared", periodStart: "2026-07-15", periodEnd: "2026-07-01" },
      { pool: "shared", periodStart: "not-a-day", periodEnd: "2026-07-15" },
      { pool: "shared", periodStart: "2026-07-01", periodEnd: "2026-13-01" },
    ];
    for (const bad of cases) {
      expect(catchAppError(() => runSavingsReconciliation(ctxA, bad))?.code).toBe("Validation");
    }
    // Another person's pool key is NotFound for a person viewer; a stranger key too.
    expect(
      catchAppError(() => runSavingsReconciliation(ctxB, { pool: "01NOBODY", ...PERIOD }))?.code,
    ).toBe("NotFound");
    expect(b).toBeTruthy();
  });
});
