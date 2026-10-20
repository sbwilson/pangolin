import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import { setSplitField } from "../ledger/set-split-field.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import {
  acceptRuleOffer,
  createRule,
  deleteRule,
  dismissRuleOffer,
  getRule,
  listRules,
  updateRule,
} from "./rules.ts";

const now = Temporal.Instant.from("2026-10-20T12:00:00.000Z");
const clock = manualClock("2026-10-20T12:00:00.000Z");

function setup() {
  registerTransactionNeedsReviewSync();

  let ms = 1792400000000;
  const newId = createIdGenerator({
    now: () => ++ms,
    random: () => 0.5,
  });
  const uow = memoryUnitOfWork();

  const alexPersonId = newId<"Person">();
  const samPersonId = newId<"Person">();

  const alexViewer: Viewer = {
    kind: "person",
    personId: alexPersonId,
    authAt: now,
  };

  const samViewer: Viewer = {
    kind: "person",
    personId: samPersonId,
    authAt: now,
  };

  const sharedAccountId = newId<"Account">();
  const alexPrivateAccountId = newId<"Account">();

  uow.state.people.push(
    {
      id: alexPersonId,
      userId: "user-alex",
      displayName: "Alex",
      colour: "#ff0000",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
    {
      id: samPersonId,
      userId: "user-sam",
      displayName: "Sam",
      colour: "#0000ff",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
  );

  uow.state.accounts.push(
    {
      id: sharedAccountId,
      name: "Joint Everyday",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: "2024-01-01",
      closedOn: null,
      isSavings: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
    {
      id: alexPrivateAccountId,
      name: "Alex Private",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      institutionId: null,
      openedOn: "2024-01-01",
      closedOn: null,
      isSavings: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
  );

  uow.state.accountOwners.push(
    { accountId: sharedAccountId, personId: alexPersonId },
    { accountId: sharedAccountId, personId: samPersonId },
    { accountId: alexPrivateAccountId, personId: alexPersonId },
  );

  const groceriesCatId = newId<"Category">();
  const snacksCatId = newId<"Category">();
  const catGroupId = newId<"CategoryGroup">();

  uow.state.categoryGroups.push({
    id: catGroupId,
    name: "Food",
    kind: "expense",
    sort: 1,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });

  uow.state.categories.push(
    {
      id: groceriesCatId,
      groupId: catGroupId,
      name: "Groceries",
      isFixedCost: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
    {
      id: snacksCatId,
      groupId: catGroupId,
      name: "Snacks",
      isFixedCost: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
  );

  return {
    uow,
    newId,
    alexPersonId,
    samPersonId,
    alexViewer,
    samViewer,
    sharedAccountId,
    alexPrivateAccountId,
    groceriesCatId,
    snacksCatId,
    ctx: { uow, viewer: alexViewer, clock, newId },
    samCtx: { uow, viewer: samViewer, clock, newId },
  };
}

describe("Rule CRUD use cases", () => {
  it("creates a rule and lists in priority order", () => {
    const { ctx, groceriesCatId, snacksCatId } = setup();

    const rule2 = createRule(ctx, {
      name: "Snacks Rule",
      priority: 20,
      conditions: { descriptionPattern: "SNACKS" },
      actions: { categoryId: snacksCatId },
      originAccountId: null,
    });

    const rule1 = createRule(ctx, {
      name: "Groceries Rule",
      priority: 10,
      conditions: { descriptionPattern: "WOOLWORTHS" },
      actions: { categoryId: groceriesCatId },
      originAccountId: null,
    });

    const rules = listRules(ctx);
    expect(rules).toHaveLength(2);
    expect(rules[0]?.id).toBe(rule1.id);
    expect(rules[1]?.id).toBe(rule2.id);

    const fetched = getRule(ctx, { id: rule1.id });
    expect(fetched.name).toBe("Groceries Rule");
    expect(fetched.priority).toBe(10);
  });

  it("enforces name uniqueness per scope", () => {
    const { ctx, groceriesCatId } = setup();

    createRule(ctx, {
      name: "Duplicate Name",
      priority: 10,
      conditions: {},
      actions: { categoryId: groceriesCatId },
      originAccountId: null,
    });

    expect(() =>
      createRule(ctx, {
        name: "Duplicate Name",
        priority: 20,
        conditions: {},
        actions: { categoryId: groceriesCatId },
        originAccountId: null,
      }),
    ).toThrowError(AppError);
  });

  it("updates mutable fields of a rule", () => {
    const { ctx, groceriesCatId, snacksCatId } = setup();

    const rule = createRule(ctx, {
      name: "Original Name",
      priority: 50,
      conditions: { descriptionPattern: "ORIGINAL" },
      actions: { categoryId: groceriesCatId },
      originAccountId: null,
    });

    const updated = updateRule(ctx, {
      id: rule.id,
      name: "Updated Name",
      priority: 5,
      conditions: { descriptionPattern: "UPDATED" },
      actions: { categoryId: snacksCatId },
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.priority).toBe(5);
    expect(JSON.parse(updated.conditions)).toEqual({ descriptionPattern: "UPDATED" });
    expect(JSON.parse(updated.actions)).toEqual({ categoryId: snacksCatId });
  });

  it("soft-deletes a rule", () => {
    const { ctx, groceriesCatId } = setup();

    const rule = createRule(ctx, {
      name: "To Delete",
      priority: 10,
      conditions: {},
      actions: { categoryId: groceriesCatId },
      originAccountId: null,
    });

    deleteRule(ctx, { id: rule.id });

    expect(listRules(ctx)).toHaveLength(0);
    expect(() => getRule(ctx, { id: rule.id })).toThrowError(AppError);
  });
});

describe("AD-18 Scope isolation for rules", () => {
  it("isolates private rules: Person A's private rule is invisible to Person B", () => {
    const { ctx, samCtx, alexPrivateAccountId, groceriesCatId } = setup();

    const privateRule = createRule(ctx, {
      name: "Alex Private Clinic",
      priority: 1,
      conditions: { descriptionPattern: "CLINIC" },
      actions: { categoryId: groceriesCatId },
      originAccountId: alexPrivateAccountId,
    });

    // Alex sees the private rule
    const alexRules = listRules(ctx);
    expect(alexRules.some((r) => r.id === privateRule.id)).toBe(true);

    // Sam does NOT see Alex's private rule
    const samRules = listRules(samCtx);
    expect(samRules.some((r) => r.id === privateRule.id)).toBe(false);

    expect(() => getRule(samCtx, { id: privateRule.id })).toThrowError(AppError);
  });
});

describe("Rule offer lifecycle: setSplitField -> acceptRuleOffer / dismissRuleOffer", () => {
  it("resolves unclassified review item and creates rule offer when user categorises split", () => {
    const { ctx, uow, newId, sharedAccountId, groceriesCatId } = setup();

    const txnId = newId<"Transaction">();
    const splitId = newId<"Split">();
    const at = now.toString();

    // Insert transaction with unclassified review item
    uow.state.transactions.push({
      id: txnId,
      accountId: sharedAccountId,
      postedOn: "2026-10-20",
      amountCents: -3500,
      descriptionRaw: "LOCAL BAKERY",
      payeeId: null,
      status: "posted",
      externalId: null,
      fingerprint: "fp1",
      fingerprintVersion: 1,
      importId: null,
      performedBy: null,
      transferGroupId: null,
      needsReview: true,
      isHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      notes: null,
      createdAt: at,
      updatedAt: at,
    });

    uow.state.splits.push({
      id: splitId,
      transactionId: txnId,
      amountCents: -3500,
      categoryId: null,
      activityId: null,
      beneficiary: "shared",
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: at,
      updatedAt: at,
    });

    uow.state.reviewItems.push({
      id: newId<"ReviewItem">(),
      kind: "classify.unclassified",
      accountId: sharedAccountId,
      personId: null,
      entityRef: `transaction:${txnId}`,
      dedupeKey: `classify.unclassified:${txnId}`,
      createdAt: at,
      resolvedAt: null,
      resolution: null,
    });

    // User categorises split
    setSplitField(ctx, {
      transactionId: txnId,
      splitId,
      field: "category",
      value: groceriesCatId,
      source: "user",
    });

    // Verify unclassified item was resolved
    const unclassifiedItem = uow.state.reviewItems.find(
      (r) => r.dedupeKey === `classify.unclassified:${txnId}`,
    );
    expect(unclassifiedItem?.resolvedAt).not.toBeNull();

    // Verify classify.rule_offer review item was raised
    const offerItem = uow.state.reviewItems.find(
      (r) => r.dedupeKey === `classify.rule_offer:${txnId}`,
    );
    expect(offerItem).toBeDefined();
    expect(offerItem?.resolvedAt).toBeNull();
    expect(offerItem?.kind).toBe("classify.rule_offer");

    // Accept rule offer
    const createdRule = acceptRuleOffer(ctx, {
      transactionId: txnId,
      name: "Always Local Bakery",
    });

    expect(createdRule.origin).toBe("correction");
    expect(createdRule.name).toBe("Always Local Bakery");
    expect(JSON.parse(createdRule.actions)).toEqual({ categoryId: groceriesCatId });

    // Verify rule offer was resolved
    const resolvedOfferItem = uow.state.reviewItems.find(
      (r) => r.dedupeKey === `classify.rule_offer:${txnId}`,
    );
    expect(resolvedOfferItem?.resolvedAt).not.toBeNull();
    expect(resolvedOfferItem?.resolution).toBe("accepted");

    // Transaction no longer needs review
    const updatedTxn = uow.state.transactions.find((t) => t.id === txnId);
    expect(updatedTxn?.needsReview).toBe(false);
  });

  it("dismisses rule offer cleanly", () => {
    const { ctx, uow, newId, sharedAccountId, groceriesCatId } = setup();

    const txnId = newId<"Transaction">();
    const splitId = newId<"Split">();
    const at = now.toString();

    uow.state.transactions.push({
      id: txnId,
      accountId: sharedAccountId,
      postedOn: "2026-10-20",
      amountCents: -1200,
      descriptionRaw: "RANDOM CAFE",
      payeeId: null,
      status: "posted",
      externalId: null,
      fingerprint: "fp2",
      fingerprintVersion: 1,
      importId: null,
      performedBy: null,
      transferGroupId: null,
      needsReview: false,
      isHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      notes: null,
      createdAt: at,
      updatedAt: at,
    });

    uow.state.splits.push({
      id: splitId,
      transactionId: txnId,
      amountCents: -1200,
      categoryId: null,
      activityId: null,
      beneficiary: "shared",
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: at,
      updatedAt: at,
    });

    setSplitField(ctx, {
      transactionId: txnId,
      splitId,
      field: "category",
      value: groceriesCatId,
      source: "user",
    });

    const offerItem = uow.state.reviewItems.find(
      (r) => r.dedupeKey === `classify.rule_offer:${txnId}`,
    );
    expect(offerItem?.resolvedAt).toBeNull();

    // Dismiss rule offer
    dismissRuleOffer(ctx, { transactionId: txnId });

    const dismissedOfferItem = uow.state.reviewItems.find(
      (r) => r.dedupeKey === `classify.rule_offer:${txnId}`,
    );
    expect(dismissedOfferItem?.resolvedAt).not.toBeNull();
    expect(dismissedOfferItem?.resolution).toBe("dismissed");

    const updatedTxn = uow.state.transactions.find((t) => t.id === txnId);
    expect(updatedTxn?.needsReview).toBe(false);
  });

  describe("validation refinements", () => {
    it("rejects invalid regex in conditions", () => {
      const { ctx, groceriesCatId } = setup();
      expect(() =>
        createRule(ctx, {
          name: "Invalid Regex Rule",
          conditions: {
            descriptionPattern: "[open-bracket",
            descriptionMatchKind: "regex",
          },
          actions: { categoryId: groceriesCatId },
        }),
      ).toThrowError(AppError);
    });

    it("rejects minAmountCents > maxAmountCents", () => {
      const { ctx, groceriesCatId } = setup();
      expect(() =>
        createRule(ctx, {
          name: "Bad Amount Range",
          conditions: {
            minAmountCents: 5000,
            maxAmountCents: 2000,
          },
          actions: { categoryId: groceriesCatId },
        }),
      ).toThrowError(AppError);
    });

    it("rejects empty actions", () => {
      const { ctx } = setup();
      expect(() =>
        createRule(ctx, {
          name: "No Actions Rule",
          conditions: {},
          actions: {},
        }),
      ).toThrowError(AppError);
    });

    it("acceptRuleOffer handles null descriptionRaw and overlong descriptions", () => {
      const { ctx, uow, newId, sharedAccountId, groceriesCatId } = setup();
      const at = now.toString();
      const longDesc = "A".repeat(150);

      const txn1Id = newId<"Transaction">();
      const split1Id = newId<"Split">();
      uow.state.transactions.push({
        id: txn1Id,
        accountId: sharedAccountId,
        postedOn: "2026-10-20",
        amountCents: -500,
        descriptionRaw: longDesc,
        payeeId: null,
        status: "posted",
        externalId: null,
        fingerprint: "fp-long",
        fingerprintVersion: 1,
        importId: null,
        performedBy: null,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: at,
        updatedAt: at,
      });
      uow.state.splits.push({
        id: split1Id,
        transactionId: txn1Id,
        amountCents: -500,
        categoryId: groceriesCatId,
        activityId: null,
        beneficiary: "shared",
        propertyId: null,
        taxCategoryId: null,
        deductibleBp: null,
        memo: null,
        categorySource: "user",
        activitySource: null,
        taxCategorySource: null,
        beneficiarySource: null,
        deductibleBpSource: null,
        createdAt: at,
        updatedAt: at,
      });

      const rule1 = acceptRuleOffer(ctx, { transactionId: txn1Id });
      expect(rule1.name.length).toBeLessThanOrEqual(100);
      expect(rule1.name).toBe("A".repeat(100));

      // Name-hidden transaction where descriptionRaw is null
      const txn2Id = newId<"Transaction">();
      const split2Id = newId<"Split">();
      uow.state.transactions.push({
        id: txn2Id,
        accountId: sharedAccountId,
        postedOn: "2026-10-20",
        amountCents: -500,
        descriptionRaw: null as unknown as string,
        payeeId: null,
        status: "posted",
        externalId: null,
        fingerprint: "fp-null",
        fingerprintVersion: 1,
        importId: null,
        performedBy: null,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: at,
        updatedAt: at,
      });
      uow.state.splits.push({
        id: split2Id,
        transactionId: txn2Id,
        amountCents: -500,
        categoryId: groceriesCatId,
        activityId: null,
        beneficiary: "shared",
        propertyId: null,
        taxCategoryId: null,
        deductibleBp: null,
        memo: null,
        categorySource: "user",
        activitySource: null,
        taxCategorySource: null,
        beneficiarySource: null,
        deductibleBpSource: null,
        createdAt: at,
        updatedAt: at,
      });

      const rule2 = acceptRuleOffer(ctx, { transactionId: txn2Id });
      expect(rule2.name).toBe("Rule");
    });
  });
});
