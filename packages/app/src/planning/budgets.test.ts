import type { Id } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import {
  createBudget,
  deleteBudget,
  getBudget,
  getBudgetSummary,
  getSuggestedLimit,
  listBudgets,
  updateBudget,
} from "./budgets.ts";

function createTestContext(viewerPersonId: string = "person-a"): UseCaseContext {
  const clock = {
    today: () => parseDate("2026-10-08"),
    now: () => parseDate("2026-10-08").toZonedDateTime("Australia/Sydney").toInstant(),
  };

  let idCounter = 1;
  const newId = <B extends string>() =>
    `01H000000000000000000000${(idCounter++).toString().padStart(2, "0")}` as Id<B>;

  const uow = memoryUnitOfWork();

  // Seed two people
  uow.state.people = [
    {
      id: "person-a" as Id<"Person">,
      displayName: "Person A",
      colour: "#FF0000",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      deletedAt: null,
      userId: "user-a",
    },
    {
      id: "person-b" as Id<"Person">,
      displayName: "Person B",
      colour: "#00FF00",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      deletedAt: null,
      userId: "user-b",
    },
  ];

  // Seed category group and category
  uow.state.categoryGroups = [
    {
      id: "grp-food" as Id<"CategoryGroup">,
      name: "Food",
      kind: "expense",
      sort: 1,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ];
  uow.state.categories = [
    {
      id: "cat-groceries" as Id<"Category">,
      groupId: "grp-food" as Id<"CategoryGroup">,
      name: "Groceries",
      isFixedCost: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      deletedAt: null,
    },
  ];

  // Seed accounts: 1 joint account, 1 personal A account, 1 personal B account
  uow.state.accounts = [
    {
      id: "acc-joint" as Id<"Account">,
      name: "Joint Everyday",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: "inst-1" as Id<"Institution">,
      openedOn: "2026-01-01",
      closedOn: null,
      isSavings: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
    {
      id: "acc-card-b" as Id<"Account">,
      name: "Person B Card",
      type: "credit_card",
      currency: "AUD",
      isPrivate: false,
      institutionId: "inst-1" as Id<"Institution">,
      openedOn: "2026-01-01",
      closedOn: null,
      isSavings: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
    {
      id: "acc-private-a" as Id<"Account">,
      name: "Person A Secret",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      institutionId: "inst-1" as Id<"Institution">,
      openedOn: "2026-01-01",
      closedOn: null,
      isSavings: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ];
  uow.state.accountOwners = [
    {
      accountId: "acc-joint" as Id<"Account">,
      personId: "person-a" as Id<"Person">,
      createdAt: "2026-09-01T00:00:00Z",
    },
    {
      accountId: "acc-joint" as Id<"Account">,
      personId: "person-b" as Id<"Person">,
      createdAt: "2026-09-01T00:00:00Z",
    },
    {
      accountId: "acc-card-b" as Id<"Account">,
      personId: "person-b" as Id<"Person">,
      createdAt: "2026-09-01T00:00:00Z",
    },
    {
      accountId: "acc-private-a" as Id<"Account">,
      personId: "person-a" as Id<"Person">,
      createdAt: "2026-09-01T00:00:00Z",
    },
  ];

  // Seed pay anchor for person A: Fortnightly anchored at 2026-10-01
  uow.state.payAnchors = [
    {
      id: "anchor-a" as Id<"PayAnchor">,
      personId: "person-a" as Id<"Person">,
      accountId: "acc-joint" as Id<"Account">,
      cadence: "fortnightly",
      dayOfMonth: null,
      anchorDate: "2026-10-01",
      alignment: "calendar",
      expectedNetCents: null,
      expectedGrossCents: null,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ];
  uow.state.settings = {
    ...uow.state.settings,
    householdPayAnchorPersonId: "person-a" as Id<"Person">,
  };

  return {
    viewer: {
      kind: "person",
      personId: viewerPersonId as Id<"Person">,
      authAt: "2026-10-08T00:00:00Z",
    },
    uow,
    clock,
    newId,
  };
}

describe("Budgets application use cases", () => {
  it("creates, updates, reads, and lists budgets with person scoping", () => {
    const ctxA = createTestContext("person-a");
    const ctxB = {
      ...ctxA,
      viewer: {
        kind: "person" as const,
        personId: "person-b" as Id<"Person">,
        authAt: "2026-10-08T00:00:00Z",
      },
    };

    // Create shared budget
    const sharedBudget = createBudget(ctxA, {
      categoryId: "cat-groceries",
      cadence: "fortnight",
      limitCents: 60000,
      rollover: true,
    });
    expect(sharedBudget.personId).toBeNull();
    expect(sharedBudget.limitCents).toBe(60000);

    // Create personal budget for person A
    const personalBudgetA = createBudget(ctxA, {
      personId: "person-a",
      categoryId: "cat-groceries",
      cadence: "fortnight",
      limitCents: 20000,
    });
    expect(personalBudgetA.personId).toBe("person-a");

    // Person A lists budgets: sees shared + personal A
    const listA = listBudgets(ctxA);
    expect(listA.map((b) => b.id)).toEqual([sharedBudget.id, personalBudgetA.id]);

    // Person B lists budgets: sees shared only, personal A is omitted (AD-22)
    const listB = listBudgets(ctxB);
    expect(listB.map((b) => b.id)).toEqual([sharedBudget.id]);

    // Person B attempting to get personalBudgetA directly receives NotFound (AD-5, AD-22)
    expect(() => getBudget(ctxB, { id: personalBudgetA.id })).toThrow(AppError);

    // Update shared budget
    const updated = updateBudget(ctxA, {
      id: sharedBudget.id,
      limitCents: 65000,
    });
    expect(updated.limitCents).toBe(65000);

    // Delete budget
    expect(deleteBudget(ctxA, { id: personalBudgetA.id })).toBe(true);
    expect(listBudgets(ctxA).map((b) => b.id)).toEqual([sharedBudget.id]);
  });

  it("calculates spent, pace, and projected for shared budget matching the I/O edge case matrix", () => {
    const ctx = createTestContext("person-a");

    // Create shared budget on Groceries, limit $600 (60000 cents)
    const budget = createBudget(ctx, {
      categoryId: "cat-groceries",
      cadence: "fortnight",
      limitCents: 60000,
      rollover: false,
    });

    // Current period is [2026-10-01, 2026-10-15). Today is 2026-10-08 (day 7).
    // Add 3 splits on 2026-10-05:
    // 1. $50 shared from joint account
    // 2. $30 shared from partner personal card
    // 3. $20 private personal (beneficiary = person-a)
    ctx.uow.state.transactions.push(
      {
        id: "txn-1" as Id<"Transaction">,
        accountId: "acc-joint" as Id<"Account">,
        postedOn: "2026-10-05",
        amountCents: -5000,
        descriptionRaw: "Woolies Joint",
        payeeId: null,
        needsReview: false,
        nameHiddenUntil: null,
        nameHiddenBy: null,
        transferGroupId: null,
        fingerprint: "fp-1",
        fingerprintVersion: 1,
        externalId: null,
        deletedAt: null,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      },
      {
        id: "txn-2" as Id<"Transaction">,
        accountId: "acc-card-b" as Id<"Account">,
        postedOn: "2026-10-05",
        amountCents: -3000,
        descriptionRaw: "Coles B Card",
        payeeId: null,
        needsReview: false,
        nameHiddenUntil: null,
        nameHiddenBy: null,
        transferGroupId: null,
        fingerprint: "fp-2",
        fingerprintVersion: 1,
        externalId: null,
        deletedAt: null,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      },
      {
        id: "txn-3" as Id<"Transaction">,
        accountId: "acc-joint" as Id<"Account">,
        postedOn: "2026-10-05",
        amountCents: -2000,
        descriptionRaw: "Snacks Personal",
        payeeId: null,
        needsReview: false,
        nameHiddenUntil: null,
        nameHiddenBy: null,
        transferGroupId: null,
        fingerprint: "fp-3",
        fingerprintVersion: 1,
        externalId: null,
        deletedAt: null,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      },
    );

    ctx.uow.state.splits.push(
      {
        id: "split-1" as Id<"Split">,
        transactionId: "txn-1" as Id<"Transaction">,
        amountCents: -5000,
        categoryId: "cat-groceries" as Id<"Category">,
        memo: null,
        beneficiary: "shared",
        activityId: null,
        taxCategoryId: null,
        deductibleBp: null,
        categorySource: null,
        activitySource: null,
        taxCategorySource: null,
        beneficiarySource: null,
        deductibleBpSource: null,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      },
      {
        id: "split-2" as Id<"Split">,
        transactionId: "txn-2" as Id<"Transaction">,
        amountCents: -3000,
        categoryId: "cat-groceries" as Id<"Category">,
        memo: null,
        beneficiary: "shared",
        activityId: null,
        taxCategoryId: null,
        deductibleBp: null,
        categorySource: null,
        activitySource: null,
        taxCategorySource: null,
        beneficiarySource: null,
        deductibleBpSource: null,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      },
      {
        id: "split-3" as Id<"Split">,
        transactionId: "txn-3" as Id<"Transaction">,
        amountCents: -2000,
        categoryId: "cat-groceries" as Id<"Category">,
        memo: null,
        beneficiary: "person-a",
        activityId: null,
        taxCategoryId: null,
        deductibleBp: null,
        categorySource: null,
        activitySource: null,
        taxCategorySource: null,
        beneficiarySource: null,
        deductibleBpSource: null,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      },
    );

    const summary = getBudgetSummary(ctx, { id: budget.id });
    // Spent should be $50 + $30 = $80 (8000 cents), ignoring the $20 personal split!
    expect(summary.spentCents).toBe(8000);
    // Period is 14 days, today is day 7 (elapsed 7). Pace is $600 * 0.5 = $300 (30000 cents).
    expect(summary.paceCents).toBe(30000);
    // Projected = 80 + (80/7) * 7 = $160 (16000 cents).
    expect(summary.projectedCents).toBe(16000);
    expect(summary.status).toBe("on-track");
  });

  it("calculates rollover carryover from prior period when rollover is enabled", () => {
    const ctx = createTestContext("person-a");

    const budget = createBudget(ctx, {
      categoryId: "cat-groceries",
      cadence: "fortnight",
      limitCents: 40000, // $400 base
      rollover: true,
    });

    // Prior period is [2026-09-17, 2026-10-01).
    // In prior period, spend $360 (limit 400 - spent 360 = +$40 unspent).
    ctx.uow.state.transactions.push({
      id: "txn-prior" as Id<"Transaction">,
      accountId: "acc-joint" as Id<"Account">,
      postedOn: "2026-09-25",
      amountCents: -36000,
      descriptionRaw: "Prior groceries",
      payeeId: null,
      needsReview: false,
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      fingerprint: "fp-prior",
      fingerprintVersion: 1,
      externalId: null,
      deletedAt: null,
      createdAt: "2026-09-25T00:00:00Z",
      updatedAt: "2026-09-25T00:00:00Z",
    });
    ctx.uow.state.splits.push({
      id: "split-prior" as Id<"Split">,
      transactionId: "txn-prior" as Id<"Transaction">,
      amountCents: -36000,
      categoryId: "cat-groceries" as Id<"Category">,
      memo: null,
      beneficiary: "shared",
      activityId: null,
      taxCategoryId: null,
      deductibleBp: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: "2026-09-25T00:00:00Z",
      updatedAt: "2026-09-25T00:00:00Z",
    });

    const summary = getBudgetSummary(ctx, { id: budget.id });
    expect(summary.rolloverCents).toBe(4000); // +$40
    expect(summary.effectiveLimitCents).toBe(44000); // $400 + $40 = $440
  });

  it("calculates 6-period limit suggestion and returns null when history < 6", () => {
    const ctx = createTestContext("person-a");

    const budget = createBudget(ctx, {
      categoryId: "cat-groceries",
      cadence: "fortnight",
      limitCents: 30000,
    });

    // Currently no transactions in prior periods -> returns null
    expect(getSuggestedLimit(ctx, { id: budget.id })).toBeNull();

    // Populate spending in 6 prior closed fortnights:
    // Period 1 (oldest): 2026-07-09 to 2026-07-23 -> $200 (20000 cents)
    // Period 2: 2026-07-23 to 2026-08-06 -> $220 (22000 cents)
    // Period 3: 2026-08-06 to 2026-08-20 -> $210 (21000 cents)
    // Period 4: 2026-08-20 to 2026-09-03 -> $190 (19000 cents)
    // Period 5: 2026-09-03 to 2026-09-17 -> $200 (20000 cents)
    // Period 6: 2026-09-17 to 2026-10-01 -> $240 (24000 cents)
    const amounts = [20000, 22000, 21000, 19000, 20000, 24000];
    const dates = [
      "2026-07-15",
      "2026-07-29",
      "2026-08-12",
      "2026-08-26",
      "2026-09-09",
      "2026-09-23",
    ];

    for (let i = 0; i < 6; i++) {
      const date = dates[i];
      const amount = amounts[i];
      if (!date || amount === undefined) continue;
      const txnId = `txn-hist-${i}` as Id<"Transaction">;
      ctx.uow.state.transactions.push({
        id: txnId,
        accountId: "acc-joint" as Id<"Account">,
        postedOn: date,
        amountCents: -amount,
        descriptionRaw: `Hist ${i}`,
        payeeId: null,
        needsReview: false,
        nameHiddenUntil: null,
        nameHiddenBy: null,
        transferGroupId: null,
        fingerprint: `fp-hist-${i}`,
        fingerprintVersion: 1,
        externalId: null,
        deletedAt: null,
        createdAt: `${date}T00:00:00Z`,
        updatedAt: `${date}T00:00:00Z`,
      });
      ctx.uow.state.splits.push({
        id: `split-hist-${i}` as Id<"Split">,
        transactionId: txnId,
        amountCents: -amount,
        categoryId: "cat-groceries" as Id<"Category">,
        memo: null,
        beneficiary: "shared",
        activityId: null,
        taxCategoryId: null,
        deductibleBp: null,
        categorySource: null,
        activitySource: null,
        taxCategorySource: null,
        beneficiarySource: null,
        deductibleBpSource: null,
        createdAt: `${date}T00:00:00Z`,
        updatedAt: `${date}T00:00:00Z`,
      });
    }

    // Mean = (200 + 220 + 210 + 190 + 200 + 240) / 6 = 1260 / 6 = $210 (21000 cents)
    const suggested = getSuggestedLimit(ctx, { id: budget.id });
    expect(suggested).toBe(21000);
  });
});
