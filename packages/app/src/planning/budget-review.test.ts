import type { Id } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { type MemoryUnitOfWork, memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import {
  budgetEntityRef,
  budgetOverBudgetDedupeKey,
  OVER_BUDGET_HOUSEHOLD_REVIEW,
  OVER_BUDGET_PERSONAL_REVIEW,
  syncAllBudgetReviewItems,
} from "./budget-review.ts";
import { createBudget } from "./budgets.ts";

function createTestContext(viewerPersonId: string = "person-a"): {
  ctx: UseCaseContext;
  uow: MemoryUnitOfWork;
} {
  const clock = {
    today: () => parseDate("2026-10-08"),
    now: () => parseDate("2026-10-08").toZonedDateTime("Australia/Sydney").toInstant(),
  };

  let idCounter = 1;
  const newId = <B extends string>() =>
    `01H000000000000000000000${(idCounter++).toString().padStart(2, "0")}` as Id<B>;

  const uow = memoryUnitOfWork();

  uow.state.people = [
    {
      id: "person-a" as Id<"Person">,
      displayName: "Person A",
      colour: "#FF0000",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      userId: "user-a",
      deletedAt: null,
    },
    {
      id: "person-b" as Id<"Person">,
      displayName: "Person B",
      colour: "#00FF00",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      userId: "user-b",
      deletedAt: null,
    },
  ];

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
    },
  ];

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
      lowBalanceThresholdCents: 0,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ];
  uow.state.accountOwners = [
    {
      accountId: "acc-joint" as Id<"Account">,
      personId: "person-a" as Id<"Person">,
      shareBp: 5000,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
    {
      accountId: "acc-joint" as Id<"Account">,
      personId: "person-b" as Id<"Person">,
      shareBp: 5000,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ];

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
    ctx: {
      viewer: personViewer(viewerPersonId as Id<"Person">, clock.now()),
      uow,
      clock,
      newId,
    },
    uow,
  };
}

describe("budget-review", () => {
  it("dedupeKey and entityRef helpers match the contract", () => {
    expect(budgetOverBudgetDedupeKey("b1", "2026-10-01")).toBe("budget:over_budget:b1:2026-10-01");
    expect(budgetEntityRef("b1")).toBe("budget:b1");
  });

  it("raises household-scoped item for shared budget when spent > limit", () => {
    const { ctx: ctxA, uow } = createTestContext("person-a");
    const ctxB: UseCaseContext = {
      ...ctxA,
      viewer: personViewer("person-b" as Id<"Person">, ctxA.clock.now()),
    };

    const budget = createBudget(ctxA, {
      categoryId: "cat-groceries",
      cadence: "fortnight",
      limitCents: 40000, // $400
    });

    // Add spending: $460 in current period (2026-10-01 to 2026-10-15)
    uow.state.transactions.push({
      id: "txn-1" as Id<"Transaction">,
      accountId: "acc-joint" as Id<"Account">,
      payeeId: null,
      postedOn: "2026-10-05",
      amountCents: -46000,
      descriptionRaw: "Coles",
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      status: "posted",
      fingerprint: "fp-1",
      fingerprintVersion: 1,
      externalId: null,
      importId: null,
      performedBy: null,
      needsReview: false,
      isHidden: false,
      notes: null,
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    });
    uow.state.splits.push({
      id: "split-1" as Id<"Split">,
      transactionId: "txn-1" as Id<"Transaction">,
      amountCents: -46000,
      categoryId: "cat-groceries" as Id<"Category">,
      beneficiary: "shared",
      activityId: null,
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    });

    syncAllBudgetReviewItems(ctxA);

    // Open items visible to A and B
    const itemsA = ctxA.uow.read((r) => r.reviewItems.listOpenFor(ctxA.viewer));
    const itemsB = ctxB.uow.read((r) => r.reviewItems.listOpenFor(ctxB.viewer));

    expect(itemsA).toHaveLength(1);
    expect(itemsB).toHaveLength(1);
    expect(itemsA[0]?.kind).toBe(OVER_BUDGET_HOUSEHOLD_REVIEW.kind);
    expect(itemsA[0]?.entityRef).toBe(`budget:${budget.id}`);
    expect(itemsA[0]?.dedupeKey).toBe(`budget:over_budget:${budget.id}:2026-10-01`);
  });

  it("raises person-scoped item for personal budget when spent > limit", () => {
    const { ctx: ctxA, uow } = createTestContext("person-a");
    const ctxB: UseCaseContext = {
      ...ctxA,
      viewer: personViewer("person-b" as Id<"Person">, ctxA.clock.now()),
    };

    const _budgetA = createBudget(ctxA, {
      personId: "person-a",
      categoryId: "cat-groceries",
      cadence: "fortnight",
      limitCents: 20000, // $200
    });

    // Add spending: $250 in current period
    uow.state.transactions.push({
      id: "txn-2" as Id<"Transaction">,
      accountId: "acc-joint" as Id<"Account">,
      payeeId: null,
      postedOn: "2026-10-06",
      amountCents: -25000,
      descriptionRaw: "Woolies Personal",
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      status: "posted",
      fingerprint: "fp-1",
      fingerprintVersion: 1,
      externalId: null,
      importId: null,
      performedBy: null,
      needsReview: false,
      isHidden: false,
      notes: null,
      createdAt: "2026-10-06T00:00:00Z",
      updatedAt: "2026-10-06T00:00:00Z",
    });
    uow.state.splits.push({
      id: "split-2" as Id<"Split">,
      transactionId: "txn-2" as Id<"Transaction">,
      amountCents: -25000,
      categoryId: "cat-groceries" as Id<"Category">,
      beneficiary: "person-a",
      activityId: null,
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: "2026-10-06T00:00:00Z",
      updatedAt: "2026-10-06T00:00:00Z",
    });

    syncAllBudgetReviewItems(ctxA);

    // Visible only to person A, NOT person B
    const itemsA = ctxA.uow.read((r) => r.reviewItems.listOpenFor(ctxA.viewer));
    const itemsB = ctxB.uow.read((r) => r.reviewItems.listOpenFor(ctxB.viewer));

    expect(itemsA).toHaveLength(1);
    expect(itemsA[0]?.kind).toBe(OVER_BUDGET_PERSONAL_REVIEW.kind);
    expect(itemsA[0]?.personId).toBe("person-a");
    expect(itemsB).toHaveLength(0);
  });

  it("is idempotent on re-evaluation", () => {
    const { ctx: ctxA, uow } = createTestContext("person-a");
    createBudget(ctxA, {
      categoryId: "cat-groceries",
      cadence: "fortnight",
      limitCents: 10000,
    });
    uow.state.transactions.push({
      id: "txn-1" as Id<"Transaction">,
      accountId: "acc-joint" as Id<"Account">,
      payeeId: null,
      postedOn: "2026-10-05",
      amountCents: -15000,
      descriptionRaw: "Coles",
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      status: "posted",
      fingerprint: "fp-1",
      fingerprintVersion: 1,
      externalId: null,
      importId: null,
      performedBy: null,
      needsReview: false,
      isHidden: false,
      notes: null,
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    });
    uow.state.splits.push({
      id: "split-1" as Id<"Split">,
      transactionId: "txn-1" as Id<"Transaction">,
      amountCents: -15000,
      categoryId: "cat-groceries" as Id<"Category">,
      beneficiary: "shared",
      activityId: null,
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    });

    syncAllBudgetReviewItems(ctxA);
    syncAllBudgetReviewItems(ctxA);

    const items = ctxA.uow.read((r) => r.reviewItems.listOpenFor(ctxA.viewer));
    expect(items).toHaveLength(1);
  });

  it("resolves open review item when spending drops back within limit", () => {
    const { ctx: ctxA, uow } = createTestContext("person-a");
    const budget = createBudget(ctxA, {
      categoryId: "cat-groceries",
      cadence: "fortnight",
      limitCents: 10000,
    });
    uow.state.transactions.push({
      id: "txn-1" as Id<"Transaction">,
      accountId: "acc-joint" as Id<"Account">,
      payeeId: null,
      postedOn: "2026-10-05",
      amountCents: -15000,
      descriptionRaw: "Coles",
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      status: "posted",
      fingerprint: "fp-1",
      fingerprintVersion: 1,
      externalId: null,
      importId: null,
      performedBy: null,
      needsReview: false,
      isHidden: false,
      notes: null,
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    });
    uow.state.splits.push({
      id: "split-1" as Id<"Split">,
      transactionId: "txn-1" as Id<"Transaction">,
      amountCents: -15000,
      categoryId: "cat-groceries" as Id<"Category">,
      beneficiary: "shared",
      activityId: null,
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    });

    syncAllBudgetReviewItems(ctxA);
    expect(ctxA.uow.read((r) => r.reviewItems.listOpenFor(ctxA.viewer))).toHaveLength(1);

    // Now reduce spending or remove transaction
    uow.state.splits[0] = {
      ...uow.state.splits[0]!,
      amountCents: -5000,
    };

    syncAllBudgetReviewItems(ctxA);
    const openItems = ctxA.uow.read((r) => r.reviewItems.listOpenFor(ctxA.viewer));
    expect(openItems).toHaveLength(0);

    // Verify resolution message
    const resolvedItem = uow.state.reviewItems.find(
      (r) => r.dedupeKey === budgetOverBudgetDedupeKey(budget.id, "2026-10-01"),
    );
    expect(resolvedItem?.resolution).toBe("spent is within limit");
    expect(resolvedItem?.resolvedAt).not.toBeNull();
  });
});
