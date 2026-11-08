import type { Id } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { type MemoryUnitOfWork, memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import { adjustBudgetLimitFromReview, dismissBudgetReviewItem } from "./budget-actions.ts";
import { syncAllBudgetReviewItems } from "./budget-review.ts";
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

describe("budget-actions", () => {
  it("dismisses an over-budget review item with resolution 'acknowledged'", () => {
    const { ctx, uow } = createTestContext("person-a");
    const _budget = createBudget(ctx, {
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

    syncAllBudgetReviewItems(ctx);
    const [item] = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(item).toBeDefined();

    dismissBudgetReviewItem(ctx, { id: item?.id });

    const openItems = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(openItems).toHaveLength(0);

    const resolved = uow.state.reviewItems.find((r) => r.id === item?.id);
    expect(resolved?.resolution).toBe("acknowledged");
  });

  it("adjusts budget limit from review item and resolves with 'limit adjusted'", () => {
    const { ctx, uow } = createTestContext("person-a");
    const _budget = createBudget(ctx, {
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

    syncAllBudgetReviewItems(ctx);
    const [item] = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(item).toBeDefined();

    const updatedBudget = adjustBudgetLimitFromReview(ctx, {
      id: item?.id,
      limitCents: 20000,
    });

    expect(updatedBudget.limitCents).toBe(20000);

    const openItems = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(openItems).toHaveLength(0);

    const resolved = uow.state.reviewItems.find((r) => r.id === item?.id);
    expect(resolved?.resolution).toBe("limit adjusted");
  });

  it("throws NotFound for unknown item id", () => {
    const { ctx, uow } = createTestContext("person-a");
    expect(() => dismissBudgetReviewItem(ctx, { id: "non-existent" })).toThrow(AppError);
    expect(() =>
      adjustBudgetLimitFromReview(ctx, { id: "non-existent", limitCents: 5000 }),
    ).toThrow(AppError);
  });
});
